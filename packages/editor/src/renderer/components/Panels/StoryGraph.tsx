import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type ReactFlowInstance,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  StoryNodeType,
  nodeRegistry,
  createStableId,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
} from '@story-blueprint/common';
import { nodeTypes } from '../Nodes';
import {
  createGraphClipboard,
  pasteGraphClipboard,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
  type GraphClipboard,
} from '../../graph/editorGraph';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './StoryGraph.module.css';

function toGraphNodes(nodes: readonly EditorGraphNode[]): GraphNodeLike[] {
  return nodes.map((node) => ({ id: node.id, type: node.type, data: node.data }));
}

function toGraphEdges(edges: readonly EditorGraphEdge[]): GraphEdgeLike[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourcePortId: edge.sourceHandle,
    target: edge.target,
    targetPortId: edge.targetHandle,
  }));
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function StoryGraph() {
  const {
    graph,
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    checkpoint,
    markDirty,
    restoreGraph,
    undo,
    redo,
    addNode,
  } = useStoryGraphStore();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<EditorGraphNode, EditorGraphEdge> | undefined
  >();
  const [contextMenu, setContextMenu] = useState<{
    left: number;
    top: number;
    flowPosition: { x: number; y: number };
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<GraphClipboard | null>(null);
  const dragSnapshot = useRef<EditorGraphState | null>(null);

  const validateConnection = useCallback(
    (connection: Connection | Edge) =>
      validateGraphConnection(
        {
          source: connection.source,
          sourcePortId: connection.sourceHandle ?? null,
          target: connection.target,
          targetPortId: connection.targetHandle ?? null,
        },
        toGraphNodes(nodes),
        toGraphEdges(edges),
      ),
    [edges, nodes],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => validateConnection(connection).valid,
    [validateConnection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnection(connection);
      if (!result.valid || !connection.sourceHandle || !connection.targetHandle) {
        setConnectionError(
          result.valid ? 'Connection requires source and target ports' : result.diagnostic.message,
        );
        return;
      }

      checkpoint();
      setConnectionError(null);
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: createStableId('edge'),
            source: connection.source as EditorGraphEdge['source'],
            target: connection.target as EditorGraphEdge['target'],
            sourceHandle: connection.sourceHandle as string,
            targetHandle: connection.targetHandle as string,
          },
          currentEdges,
        ),
      );
      markDirty();
    },
    [checkpoint, markDirty, setEdges, validateConnection],
  );

  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, connectionState) => {
      const { fromHandle, toHandle } = connectionState;
      if (!fromHandle || !toHandle) return;

      const sourceHandle = fromHandle.type === 'source' ? fromHandle : toHandle;
      const targetHandle = fromHandle.type === 'target' ? fromHandle : toHandle;
      const result = validateConnection({
        source: sourceHandle.nodeId,
        sourceHandle: sourceHandle.id ?? null,
        target: targetHandle.nodeId,
        targetHandle: targetHandle.id ?? null,
      });
      if (!result.valid) setConnectionError(result.diagnostic.message);
    },
    [validateConnection],
  );

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const hasSelectedEdge = edges.some((edge) => edge.selected);
    if (selectedNodeIds.size === 0 && !hasSelectedEdge) return;

    checkpoint();
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !edge.selected && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
      ),
    );
    markDirty();
  }, [checkpoint, edges, markDirty, nodes, setEdges, setNodes]);

  const copySelection = useCallback(() => {
    clipboard.current = createGraphClipboard(graph);
  }, [graph]);

  const paste = useCallback(() => {
    if (!clipboard.current) return;
    checkpoint();
    restoreGraph(pasteGraphClipboard(graph, clipboard.current));
    markDirty();
  }, [checkpoint, graph, markDirty, restoreGraph]);

  const duplicateSelection = useCallback(() => {
    const selected = createGraphClipboard(graph);
    if (!selected) return;
    checkpoint();
    restoreGraph(pasteGraphClipboard(graph, selected));
    markDirty();
  }, [checkpoint, graph, markDirty, restoreGraph]);

  const openContextMenu = useCallback(
    (event: globalThis.MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      if (!flowInstance || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      setContextMenu({
        left: Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - 200)),
        top: Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - 260)),
        flowPosition: flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [flowInstance],
  );

  const createNode = useCallback(
    (type: StoryNodeType) => {
      if (!contextMenu) return;
      addNode(type, contextMenu.flowPosition);
      setContextMenu(null);
    },
    [addNode, contextMenu],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editingText = isTextEditingTarget(event.target);
      const isHistoryShortcut = modifier && (key === 'z' || key === 'y');
      if (editingText && !isHistoryShortcut) return;

      if (modifier && key === 'c') {
        event.preventDefault();
        copySelection();
      } else if (modifier && key === 'v') {
        event.preventDefault();
        paste();
      } else if (modifier && key === 'd') {
        event.preventDefault();
        duplicateSelection();
      } else if (modifier && key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (modifier && key === 'z') {
        event.preventDefault();
        undo();
      } else if (modifier && key === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelection, deleteSelection, duplicateSelection, paste, redo, undo]);

  const onNodeDragStart = useCallback(() => {
    dragSnapshot.current = structuredClone(graph);
  }, [graph]);
  const onNodeDragStop = useCallback(
    (_event: unknown, node: EditorGraphNode) => {
      const snapshot = dragSnapshot.current;
      dragSnapshot.current = null;
      const original = snapshot?.nodes.find((candidate) => candidate.id === node.id);
      if (
        !snapshot ||
        !original ||
        (original.position.x === node.position.x && original.position.y === node.position.y)
      ) {
        return;
      }
      checkpoint(snapshot);
      markDirty();
    },
    [checkpoint, markDirty],
  );
  const hasStoryEntry = nodes.some((node) => node.type === StoryNodeType.Start);

  return (
    <div className={styles.panel}>
      <div className={styles.canvas} ref={canvasRef}>
        <ReactFlow<EditorGraphNode, EditorGraphEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onInit={setFlowInstance}
          onPaneClick={() => setContextMenu(null)}
          onPaneContextMenu={openContextMenu}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          deleteKeyCode={null}
          multiSelectionKeyCode="Control"
          selectionKeyCode="Shift"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3d3d3d" />
          <MiniMap nodeStrokeColor="#555" nodeColor="#333" maskColor="rgba(0,0,0,0.6)" />
          <Controls />
        </ReactFlow>
        {contextMenu && (
          <div
            className={styles.contextMenu}
            style={{ left: contextMenu.left, top: contextMenu.top }}
          >
            <div className={styles.contextMenuTitle}>Create Node</div>
            {nodeRegistry.list().map((definition) => (
              <button
                key={definition.type}
                type="button"
                disabled={definition.type === StoryNodeType.Start && hasStoryEntry}
                onClick={() => createNode(definition.type)}
              >
                <span
                  className={styles.contextMenuColor}
                  style={{ background: definition.color }}
                />
                {definition.label}
              </button>
            ))}
          </div>
        )}
        {connectionError && <div className={styles.connectionError}>{connectionError}</div>}
      </div>
    </div>
  );
}
