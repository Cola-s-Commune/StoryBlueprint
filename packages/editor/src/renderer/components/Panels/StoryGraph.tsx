import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type OnConnectEnd,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  StoryNodeType,
  nodeRegistry,
  NodeFactory,
  createStableId,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
  type NodeInstance,
} from '@story-blueprint/common';
import { nodeTypes } from '../Nodes';
import {
  createGraphClipboard,
  pasteGraphClipboard,
  toEditorGraphNode,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
  type GraphClipboard,
} from '../../graph/editorGraph';
import { useGraphHistory } from '../../graph/useGraphHistory';
import styles from './StoryGraph.module.css';

nodeRegistry.registerBuiltins();

function buildInitialNodes(): EditorGraphNode[] {
  const specs = [
    { type: StoryNodeType.Start, position: { x: 250, y: 50 } },
    { type: StoryNodeType.Dialogue, position: { x: 250, y: 220 } },
    { type: StoryNodeType.Choice, position: { x: 200, y: 400 } },
    { type: StoryNodeType.Branch, position: { x: 500, y: 400 } },
    { type: StoryNodeType.End, position: { x: 200, y: 600 } },
    { type: StoryNodeType.End, position: { x: 500, y: 600 } },
  ];

  return specs
    .map(({ type, position }) => NodeFactory.create(NodeFactory.generateId(type), type, position))
    .filter((node): node is NodeInstance => node !== null)
    .map(toEditorGraphNode);
}

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
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorGraphNode>(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorGraphEdge>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const clipboard = useRef<GraphClipboard | null>(null);
  const history = useGraphHistory();
  const graph = useMemo<EditorGraphState>(() => ({ nodes, edges }), [edges, nodes]);

  const restoreGraph = useCallback(
    (next: EditorGraphState) => {
      setNodes(next.nodes);
      setEdges(next.edges);
      setConnectionError(null);
    },
    [setEdges, setNodes],
  );

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

      history.checkpoint(graph);
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
    },
    [graph, history, setEdges, validateConnection],
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

    history.checkpoint(graph);
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !edge.selected && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
      ),
    );
  }, [edges, graph, history, nodes, setEdges, setNodes]);

  const copySelection = useCallback(() => {
    clipboard.current = createGraphClipboard(graph);
  }, [graph]);

  const paste = useCallback(() => {
    if (!clipboard.current) return;
    history.checkpoint(graph);
    restoreGraph(pasteGraphClipboard(graph, clipboard.current));
  }, [graph, history, restoreGraph]);

  const duplicateSelection = useCallback(() => {
    const selected = createGraphClipboard(graph);
    if (!selected) return;
    history.checkpoint(graph);
    restoreGraph(pasteGraphClipboard(graph, selected));
  }, [graph, history, restoreGraph]);

  const undo = useCallback(() => {
    const previous = history.undo(graph);
    if (previous) restoreGraph(previous);
  }, [graph, history, restoreGraph]);

  const redo = useCallback(() => {
    const next = history.redo(graph);
    if (next) restoreGraph(next);
  }, [graph, history, restoreGraph]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelection, deleteSelection, duplicateSelection, paste, redo, undo]);

  const onNodeDragStart = useCallback(() => history.checkpoint(graph), [graph, history]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Story Graph</span>
        <span className={styles.shortcutHint}>Ctrl+C / V / D · Ctrl+Z / Shift+Z</span>
      </div>
      <div className={styles.canvas}>
        <ReactFlow<EditorGraphNode, EditorGraphEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
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
        {connectionError && <div className={styles.connectionError}>{connectionError}</div>}
      </div>
    </div>
  );
}
