import {
  useCallback,
  useEffect,
  useMemo,
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
  ConnectionLineType,
  SelectionMode,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type ReactFlowInstance,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  StoryNodeType,
  NodeFactory,
  nodeRegistry,
  createStableId,
  resolveNodePorts,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
  type EdgeId,
  type NodeId,
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
} from '@story-blueprint/common';
import { nodeTypes } from '../Nodes';
import {
  autoLayoutGraph,
  createGraphClipboard,
  disconnectGraphPinConnections,
  moveGraphPinConnections,
  pasteGraphClipboard,
  toEditorGraphNode,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
  type GraphClipboard,
  type GraphPinReference,
} from '../../graph/editorGraph';
import { useStoryGraphStore, type ActiveGraphId } from '../../graph/StoryGraphStore';
import { readStoryDataDrag, storyDataMime } from '../../graph/storyDataDrag';
import {
  buildStorySearchIndex,
  searchStoryIndex,
  type StorySearchEntry,
} from '../../graph/storySearch';
import { CopyButton } from './CopyButton';
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

function mergeValueText(value: unknown, present: boolean): string {
  if (!present) return '(deleted)';
  if (typeof value === 'string') return value || '(empty string)';
  return JSON.stringify(value, null, 2);
}

function isExecutionEdge(edge: EditorGraphEdge, nodes: readonly EditorGraphNode[]): boolean {
  const source = nodes.find((node) => node.id === edge.source);
  if (!source) return false;
  const sourcePort = resolveNodePorts({
    id: source.id,
    type: source.type,
    data: source.data,
  }).ports.find((port) => port.id === edge.sourceHandle);
  return sourcePort?.direction === 'output' && sourcePort.kind === 'execution';
}

function replacesExistingExecutionEdge(
  result: ReturnType<typeof validateGraphConnection>,
): boolean {
  return !result.valid && result.diagnostic.code === 'OUTPUT_ALREADY_CONNECTED';
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

function graphPinFromTarget(target: EventTarget | null): GraphPinReference | undefined {
  if (!(target instanceof Element)) return undefined;
  const handle = target.closest<HTMLElement>('.react-flow__handle');
  const nodeId = handle?.dataset.nodeid;
  const handleId = handle?.dataset.handleid;
  if (!handle || !nodeId || !handleId) return undefined;
  return {
    nodeId,
    handleId,
    direction: handle.classList.contains('source') ? 'source' : 'target',
  };
}

type GraphControlMode = 'blueprint' | 'standard';
const graphControlModeStorageKey = 'story-blueprint.graph-control-mode';

function initialGraphControlMode(): GraphControlMode {
  const saved = window.localStorage.getItem(graphControlModeStorageKey);
  return saved === 'standard' ? 'standard' : 'blueprint';
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
    activeGraphId,
    chapters,
    events,
    extractSelectionToSubstory,
    hasActiveStory,
    workspace,
    workspaceError,
    recentProjects,
    newProject,
    openProject,
    openRecentProject,
    removeRecentProject,
    openStory,
    problemFocus,
    aiChanges,
    clearAIChanges,
    aiProposal,
    updateAIProposalNodes,
    applyAIProposal,
    discardAIProposal,
    storyMergePreview,
    storyMergePreviewGraphId,
    clearStoryMergePreview,
    setStoryMergePreviewGraph,
    chooseStoryMergePreviewConflict,
    semanticSnapshot,
    focusGraphNode,
    selectStoryData,
  } = useStoryGraphStore();
  const activeMergePreview = storyMergePreview?.graphs.find(
    (candidate) => candidate.id === (storyMergePreviewGraphId ?? activeGraphId),
  );
  const mergePreviewActive = Boolean(storyMergePreview);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<GraphControlMode>(initialGraphControlMode);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [transferPreview, setTransferPreview] = useState<{
    fixedPoints: readonly { x: number; y: number }[];
    pointer: { x: number; y: number };
  }>();
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<EditorGraphNode, EditorGraphEdge> | undefined
  >();
  const [contextMenu, setContextMenu] = useState<{
    left: number;
    top: number;
    flowPosition: { x: number; y: number };
    edge?: EditorGraphEdge;
  } | null>(null);
  const [mergeConflictSelection, setMergeConflictSelection] = useState<{
    graphId: ActiveGraphId;
    nodeId?: NodeId;
    edgeId?: EdgeId;
    conflictIds: readonly string[];
  }>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<GraphClipboard | null>(null);
  const rightDragRef = useRef<{
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    manualPan: boolean;
  }>();
  const additiveSelectionRef = useRef<{
    nodeIds: ReadonlySet<string>;
    edgeIds: ReadonlySet<string>;
  }>();
  const connectionTransferRef = useRef<{
    origin: GraphPinReference;
    fixedPoints: readonly { x: number; y: number }[];
  }>();
  const graphRef = useRef(graph);
  graphRef.current = graph;
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
    (connection: Connection | Edge) => {
      const result = validateConnection(connection);
      return result.valid || replacesExistingExecutionEdge(result);
    },
    [validateConnection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnection(connection);
      const replacesExisting = replacesExistingExecutionEdge(result);
      if (
        (!result.valid && !replacesExisting) ||
        !connection.sourceHandle ||
        !connection.targetHandle
      ) {
        setConnectionError(
          result.valid ? 'Connection requires source and target ports' : result.diagnostic.message,
        );
        return;
      }

      checkpoint();
      setConnectionError(null);
      setEdges((currentEdges) => {
        const availableEdges = replacesExisting
          ? currentEdges.filter(
              (edge) =>
                edge.source !== connection.source || edge.sourceHandle !== connection.sourceHandle,
            )
          : currentEdges;
        return addEdge(
          {
            ...connection,
            id: createStableId('edge'),
            source: connection.source as EditorGraphEdge['source'],
            target: connection.target as EditorGraphEdge['target'],
            sourceHandle: connection.sourceHandle as string,
            targetHandle: connection.targetHandle as string,
          },
          availableEdges,
        );
      });
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
      if (!result.valid && !replacesExistingExecutionEdge(result)) {
        setConnectionError(result.diagnostic.message);
      }
    },
    [validateConnection],
  );

  const onEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: EditorGraphEdge) => {
      if (activeMergePreview) {
        const conflictIds = activeMergePreview.edgeConflictIds[edge.id] ?? [];
        if (conflictIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          setMergeConflictSelection({
            graphId: activeMergePreview.id,
            edgeId: edge.id as EdgeId,
            conflictIds,
          });
        }
        return;
      }
      if (!event.altKey) return;
      if (!edges.some((candidate) => candidate.id === edge.id)) return;
      event.preventDefault();
      event.stopPropagation();
      checkpoint();
      setEdges((current) => current.filter((candidate) => candidate.id !== edge.id));
      setConnectionError(null);
      markDirty();
    },
    [activeMergePreview, checkpoint, edges, markDirty, setEdges],
  );

  const openEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: EditorGraphEdge) => {
      event.preventDefault();
      if (mergePreviewActive) return;
      if (!flowInstance || !canvasRef.current) return;
      const actualEdge = edges.find((candidate) => candidate.id === edge.id);
      if (!actualEdge || !isExecutionEdge(actualEdge, nodes)) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      setContextMenu({
        left: Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - 200)),
        top: Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - 150)),
        flowPosition: flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        edge: actualEdge,
      });
    },
    [edges, flowInstance, mergePreviewActive, nodes],
  );

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const hasSelectedEdge = edges.some((edge) => edge.selected);
    if (selectedNodeIds.size === 0 && !hasSelectedEdge) return;

    checkpoint();
    setNodes((current) =>
      current
        .filter((node) => !selectedNodeIds.has(node.id))
        .map((node) => {
          if (node.type !== StoryNodeType.FlowJump) return node;
          const data = node.data as FlowJumpNodeData;
          return data.targetNodeId && selectedNodeIds.has(data.targetNodeId)
            ? { ...node, data: { ...node.data, targetNodeId: undefined } }
            : node;
        }),
    );
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
      if (mergePreviewActive) return;
      if (controlMode === 'blueprint' && rightDragRef.current?.moved) {
        rightDragRef.current = undefined;
        return;
      }
      rightDragRef.current = undefined;
      if (!flowInstance || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      setContextMenu({
        left: Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - 200)),
        top: Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - 390)),
        flowPosition: flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [controlMode, flowInstance, mergePreviewActive],
  );

  useEffect(() => {
    window.localStorage.setItem(graphControlModeStorageKey, controlMode);
    rightDragRef.current = undefined;
    setContextMenu(null);
  }, [controlMode]);

  useEffect(() => {
    const cancelTransfer = () => {
      connectionTransferRef.current = undefined;
      setTransferPreview(undefined);
    };
    const handleMouseMove = (event: MouseEvent) => {
      const transfer = connectionTransferRef.current;
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!transfer || !bounds) return;
      setTransferPreview({
        fixedPoints: transfer.fixedPoints,
        pointer: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      });
    };
    const handleMouseUp = (event: MouseEvent) => {
      const transfer = connectionTransferRef.current;
      if (!transfer) return;
      const destination = graphPinFromTarget(
        document.elementFromPoint(event.clientX, event.clientY),
      );
      cancelTransfer();
      if (!destination) return;
      const result = moveGraphPinConnections(graphRef.current, transfer.origin, destination);
      if (!result.ok) {
        setConnectionError(result.message);
        return;
      }
      checkpoint();
      setEdges(result.graph.edges);
      setConnectionError(null);
      markDirty();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', cancelTransfer);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', cancelTransfer);
    };
  }, [checkpoint, markDirty, setEdges]);

  const handleCanvasMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (event.button === 0 && event.ctrlKey && target?.closest('.react-flow__nodesselection')) {
        const nodeElement = document
          .elementsFromPoint(event.clientX, event.clientY)
          .map((element) => element.closest<HTMLElement>('.react-flow__node[data-id]'))
          .find((element): element is HTMLElement => Boolean(element));
        const nodeId = nodeElement?.dataset.id;
        const targetNode = nodes.find((node) => node.id === nodeId);
        if (nodeId && targetNode) {
          event.preventDefault();
          event.stopPropagation();
          const shouldSelect = !targetNode.selected;
          const selectedNodeIds = new Set(
            nodes
              .filter((node) => (node.id === nodeId ? shouldSelect : node.selected))
              .map((node) => node.id),
          );
          setNodes((current) =>
            current.map((node) =>
              node.id === nodeId ? { ...node, selected: shouldSelect } : node,
            ),
          );
          setEdges((current) =>
            current.map((edge) =>
              edge.source === nodeId || edge.target === nodeId
                ? {
                    ...edge,
                    selected:
                      shouldSelect &&
                      selectedNodeIds.has(edge.source) &&
                      selectedNodeIds.has(edge.target),
                  }
                : edge,
            ),
          );
          additiveSelectionRef.current = undefined;
          return;
        }
      }
      if (event.button === 0) {
        additiveSelectionRef.current = event.shiftKey
          ? {
              nodeIds: new Set(nodes.filter((node) => node.selected).map((node) => node.id)),
              edgeIds: new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id)),
            }
          : undefined;
      }
      const pin = graphPinFromTarget(event.target);
      if (pin && event.button === 0 && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const result = disconnectGraphPinConnections(graphRef.current, pin);
        if (result.removedEdgeIds.length === 0) return;
        checkpoint();
        setEdges(result.graph.edges);
        setConnectionError(null);
        markDirty();
        return;
      }

      if (pin && event.button === 0 && event.ctrlKey) {
        const connectedEdges = edges.filter((edge) =>
          pin.direction === 'source'
            ? edge.source === pin.nodeId && edge.sourceHandle === pin.handleId
            : edge.target === pin.nodeId && edge.targetHandle === pin.handleId,
        );
        if (connectedEdges.length > 0 && canvasRef.current) {
          event.preventDefault();
          event.stopPropagation();
          const bounds = canvasRef.current.getBoundingClientRect();
          const handles = Array.from(
            canvasRef.current.querySelectorAll<HTMLElement>('.react-flow__handle'),
          );
          const fixedPoints = connectedEdges.flatMap((edge) => {
            const nodeId = pin.direction === 'source' ? edge.target : edge.source;
            const handleId = pin.direction === 'source' ? edge.targetHandle : edge.sourceHandle;
            const handle = handles.find(
              (candidate) =>
                candidate.dataset.nodeid === nodeId && candidate.dataset.handleid === handleId,
            );
            if (!handle) return [];
            const handleBounds = handle.getBoundingClientRect();
            return [
              {
                x: handleBounds.left + handleBounds.width / 2 - bounds.left,
                y: handleBounds.top + handleBounds.height / 2 - bounds.top,
              },
            ];
          });
          connectionTransferRef.current = { origin: pin, fixedPoints };
          setTransferPreview({
            fixedPoints,
            pointer: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          });
          return;
        }
      }

      if (controlMode === 'blueprint' && event.button === 2) {
        rightDragRef.current = {
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
          manualPan: Boolean(target?.closest('.react-flow__nodesselection')),
        };
      }
    },
    [checkpoint, controlMode, edges, markDirty, nodes, setEdges, setNodes],
  );

  const mergeAdditiveSelection = useCallback(() => {
    const previous = additiveSelectionRef.current;
    additiveSelectionRef.current = undefined;
    if (!previous) return;
    setNodes((current) =>
      current.map((node) =>
        previous.nodeIds.has(node.id) && !node.selected ? { ...node, selected: true } : node,
      ),
    );
    setEdges((current) =>
      current.map((edge) =>
        previous.edgeIds.has(edge.id) && !edge.selected ? { ...edge, selected: true } : edge,
      ),
    );
  }, [setEdges, setNodes]);

  const createNode = useCallback(
    (type: StoryNodeType) => {
      if (!contextMenu) return;
      if (type === StoryNodeType.FlowAnchor) {
        const usedLabels = new Set(
          nodes
            .filter((node) => node.type === StoryNodeType.FlowAnchor)
            .map((node) => (node.data as FlowAnchorNodeData).label),
        );
        let index = usedLabels.size + 1;
        let label = `Portal ${index}`;
        while (usedLabels.has(label)) label = `Portal ${++index}`;
        addNode(type, contextMenu.flowPosition, { label });
      } else if (type === StoryNodeType.FlowJump) {
        const anchors = nodes.filter((node) => node.type === StoryNodeType.FlowAnchor);
        addNode(type, contextMenu.flowPosition, {
          targetNodeId: anchors.length === 1 ? anchors[0].id : undefined,
        });
      } else {
        addNode(type, contextMenu.flowPosition);
      }
      setContextMenu(null);
    },
    [addNode, contextMenu, nodes],
  );

  const insertReroute = useCallback(
    (edge: EditorGraphEdge, position: { x: number; y: number }) => {
      if (!isExecutionEdge(edge, nodes)) return;
      const instance = NodeFactory.create(
        NodeFactory.generateId(StoryNodeType.Reroute),
        StoryNodeType.Reroute,
        { x: Math.round(position.x - 7), y: Math.round(position.y - 7) },
      );
      if (!instance) return;
      const reroute = { ...toEditorGraphNode(instance), selected: true };
      checkpoint();
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), reroute]);
      setEdges((current) => [
        ...current.filter((candidate) => candidate.id !== edge.id),
        {
          id: createStableId('edge'),
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: reroute.id,
          targetHandle: 'in',
        },
        {
          id: createStableId('edge'),
          source: reroute.id,
          sourceHandle: 'out',
          target: edge.target,
          targetHandle: edge.targetHandle,
        },
      ]);
      setContextMenu(null);
      markDirty();
    },
    [checkpoint, markDirty, nodes, setEdges, setNodes],
  );

  const convertEdgeToPortal = useCallback(
    (edge: EditorGraphEdge) => {
      if (!isExecutionEdge(edge, nodes)) return;
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      if (!sourceNode || !targetNode) return;
      const usedLabels = new Set(
        nodes
          .filter((node) => node.type === StoryNodeType.FlowAnchor)
          .map((node) => (node.data as FlowAnchorNodeData).label),
      );
      let index = usedLabels.size + 1;
      let label = `Portal ${index}`;
      while (usedLabels.has(label)) label = `Portal ${++index}`;
      const anchorInstance = NodeFactory.create(
        NodeFactory.generateId(StoryNodeType.FlowAnchor),
        StoryNodeType.FlowAnchor,
        {
          x: Math.round(targetNode.position.x - 210),
          y: Math.round(targetNode.position.y),
        },
      );
      const jumpInstance = NodeFactory.create(
        NodeFactory.generateId(StoryNodeType.FlowJump),
        StoryNodeType.FlowJump,
        {
          x: Math.round(sourceNode.position.x + 250),
          y: Math.round(sourceNode.position.y),
        },
      );
      if (!anchorInstance || !jumpInstance) return;
      const anchor = {
        ...toEditorGraphNode(anchorInstance),
        data: { label },
        selected: false,
      };
      const jump = {
        ...toEditorGraphNode(jumpInstance),
        data: { targetNodeId: anchor.id },
        selected: true,
      };
      checkpoint();
      setNodes((current) => [
        ...current.map((node) => ({ ...node, selected: false })),
        jump,
        anchor,
      ]);
      setEdges((current) => [
        ...current.filter((candidate) => candidate.id !== edge.id),
        {
          id: createStableId('edge'),
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: jump.id,
          targetHandle: 'in',
        },
        {
          id: createStableId('edge'),
          source: anchor.id,
          sourceHandle: 'out',
          target: edge.target,
          targetHandle: edge.targetHandle,
        },
      ]);
      setContextMenu(null);
      markDirty();
    },
    [checkpoint, markDirty, nodes, setEdges, setNodes],
  );

  const searchEntries = useMemo(() => buildStorySearchIndex(semanticSnapshot), [semanticSnapshot]);
  const searchResults = useMemo(
    () => searchStoryIndex(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  );
  useEffect(() => {
    setActiveSearchIndex((current) => Math.min(current, Math.max(0, searchResults.length - 1)));
  }, [searchResults.length]);
  useEffect(() => {
    if (!showSearch) return;
    searchResultsRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSearchIndex, showSearch]);
  useEffect(() => {
    if (!showSearch) return;
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [showSearch]);
  const activateSearchResult = useCallback(
    (result: StorySearchEntry) => {
      if (aiProposal) {
        setConnectionError('Apply or discard the AI proposal before navigating search results.');
        return;
      }
      if (result.kind === 'node' && result.graphId && result.nodeId) {
        focusGraphNode(result.graphId, result.nodeId);
      } else if (result.selection) {
        selectStoryData(result.selection);
      }
    },
    [aiProposal, focusGraphNode, selectStoryData],
  );
  const moveSearchResult = useCallback(
    (offset: number, activate = false) => {
      if (searchResults.length === 0) return;
      const next = (activeSearchIndex + offset + searchResults.length) % searchResults.length;
      setActiveSearchIndex(next);
      if (activate) activateSearchResult(searchResults[next]);
    },
    [activateSearchResult, activeSearchIndex, searchResults],
  );
  const openSearch = useCallback(() => {
    setShowSearch(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasActiveStory) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'f') {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === 'Escape' && showSearch) {
        event.preventDefault();
        setShowSearch(false);
        return;
      }
      const editingText = isTextEditingTarget(event.target);
      const isHistoryShortcut = modifier && (key === 'z' || key === 'y');
      if (editingText && !isHistoryShortcut) return;
      if (modifier && key === 'c' && window.getSelection()?.toString()) return;
      if (mergePreviewActive && (modifier || event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        return;
      }

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
        connectionTransferRef.current = undefined;
        setTransferPreview(undefined);
        setShowShortcuts(false);
        setShowSearch(false);
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    copySelection,
    deleteSelection,
    duplicateSelection,
    hasActiveStory,
    mergePreviewActive,
    paste,
    redo,
    openSearch,
    showSearch,
    undo,
  ]);

  useEffect(() => {
    if (!flowInstance) return;
    const frame = requestAnimationFrame(() => {
      void flowInstance.fitView({ padding: 0.2, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeGraphId, flowInstance]);

  useEffect(() => {
    if (!flowInstance || !problemFocus) return;
    const frame = requestAnimationFrame(() => {
      void flowInstance.fitView({
        nodes: [{ id: problemFocus.nodeId }],
        padding: 0.45,
        duration: 220,
        maxZoom: 1.25,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [flowInstance, problemFocus]);

  useEffect(() => {
    if (!flowInstance || !activeMergePreview) return;
    const highlightedIds = [
      ...activeMergePreview.addedNodeIds,
      ...activeMergePreview.changedNodeIds,
      ...activeMergePreview.removedNodeIds,
      ...activeMergePreview.conflictNodeIds,
    ].filter((id, index, all) => all.indexOf(id) === index);
    if (highlightedIds.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void flowInstance.fitView({
        nodes: highlightedIds.map((id) => ({ id })),
        padding: 0.6,
        duration: 260,
        maxZoom: 1.15,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeMergePreview, flowInstance, storyMergePreview?.nonce]);

  useEffect(() => {
    if (!aiChanges) return;
    const highlightedIds = [...aiChanges.addedNodeIds, ...aiChanges.changedNodeIds];
    const frame = requestAnimationFrame(() => {
      if (!flowInstance || highlightedIds.length === 0) return;
      void flowInstance.fitView({
        nodes: highlightedIds.map((id) => ({ id })),
        padding: 0.75,
        duration: 320,
        maxZoom: 1.2,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [aiChanges, flowInstance]);

  useEffect(() => {
    if (!aiProposal || !flowInstance || aiProposal.addedNodeIds.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void flowInstance.fitView({
        nodes: aiProposal.addedNodeIds.map((id) => ({ id })),
        padding: 0.75,
        duration: 320,
        maxZoom: 1.2,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [aiProposal?.nonce, flowInstance]);

  const onNodeDragStart = useCallback(() => {
    if (aiProposal) return;
    dragSnapshot.current = structuredClone(graph);
  }, [aiProposal, graph]);
  const onNodeDragStop = useCallback(
    (_event: unknown, node: EditorGraphNode) => {
      if (aiProposal) {
        updateAIProposalNodes([
          {
            type: 'position',
            id: node.id,
            position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
            dragging: false,
          },
        ]);
        return;
      }
      const snapshot = dragSnapshot.current;
      dragSnapshot.current = null;
      const original = snapshot?.nodes.find((candidate) => candidate.id === node.id);
      const roundedPosition = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
      setNodes((current) =>
        current.map((candidate) =>
          candidate.id === node.id ? { ...candidate, position: roundedPosition } : candidate,
        ),
      );
      if (
        !snapshot ||
        !original ||
        (original.position.x === roundedPosition.x && original.position.y === roundedPosition.y)
      ) {
        return;
      }
      checkpoint(snapshot);
      markDirty();
    },
    [aiProposal, checkpoint, markDirty, setNodes, updateAIProposalNodes],
  );
  const hasStoryEntry = nodes.some((node) => node.type === StoryNodeType.Start);
  const activeName =
    activeMergePreview?.displayName ??
    (activeGraphId === 'root'
      ? 'Main Story'
      : (chapters.find((chapter) => chapter.id === activeGraphId)?.displayName ?? 'Substory'));
  const selectedCount = nodes.filter((node) => node.selected).length;
  const canvasNodes = aiProposal?.graph.nodes ?? activeMergePreview?.graph.nodes ?? nodes;
  const canvasEdges = aiProposal?.graph.edges ?? activeMergePreview?.graph.edges ?? edges;
  const arrangeGraph = useCallback(
    (scope: 'selected' | 'all') => {
      const targetIds: NodeId[] = aiProposal
        ? [...aiProposal.addedNodeIds]
        : scope === 'selected'
          ? nodes.filter((node) => node.selected).map((node) => node.id)
          : nodes.map((node) => node.id);
      if (targetIds.length < 2) return;
      const sourceGraph = aiProposal?.graph ?? graph;
      const arranged = autoLayoutGraph(sourceGraph, targetIds);
      const beforeById = new Map(
        sourceGraph.nodes.map((node) => [node.id, node.position] as const),
      );
      const movedNodes = arranged.nodes.filter((node) => {
        if (!targetIds.includes(node.id)) return false;
        const before = beforeById.get(node.id);
        return before?.x !== node.position.x || before.y !== node.position.y;
      });
      if (movedNodes.length === 0) return;
      if (aiProposal) {
        updateAIProposalNodes(
          movedNodes.map((node) => ({
            type: 'position' as const,
            id: node.id,
            position: node.position,
            dragging: false,
          })),
        );
      } else {
        checkpoint();
        restoreGraph(arranged);
        markDirty();
      }
      requestAnimationFrame(() => {
        void flowInstance?.fitView({
          nodes: targetIds.map((id) => ({ id })),
          padding: 0.35,
          duration: 280,
          maxZoom: 1.2,
        });
      });
    },
    [
      aiProposal,
      checkpoint,
      flowInstance,
      graph,
      markDirty,
      nodes,
      restoreGraph,
      updateAIProposalNodes,
    ],
  );
  const renderedNodes = useMemo<EditorGraphNode[]>(() => {
    const added = new Set(aiProposal?.addedNodeIds ?? aiChanges?.addedNodeIds ?? []);
    const changed = new Set(aiProposal?.changedNodeIds ?? aiChanges?.changedNodeIds ?? []);
    const mergeAdded = new Set(activeMergePreview?.addedNodeIds ?? []);
    const mergeChanged = new Set(activeMergePreview?.changedNodeIds ?? []);
    const mergeRemoved = new Set(activeMergePreview?.removedNodeIds ?? []);
    const mergeConflicts = new Set(activeMergePreview?.conflictNodeIds ?? []);
    return canvasNodes.map((node) => ({
      ...node,
      draggable: activeMergePreview ? false : aiProposal ? added.has(node.id) : node.draggable,
      className: [
        node.className,
        mergeConflicts.has(node.id)
          ? 'merge-preview-conflict'
          : mergeRemoved.has(node.id)
            ? 'merge-preview-removed'
            : mergeAdded.has(node.id)
              ? 'merge-preview-added'
              : mergeChanged.has(node.id)
                ? 'merge-preview-modified'
                : '',
        added.has(node.id)
          ? aiProposal
            ? 'ai-proposal-added'
            : 'ai-change-added'
          : changed.has(node.id)
            ? aiProposal
              ? 'ai-proposal-modified'
              : 'ai-change-modified'
            : '',
      ]
        .filter(Boolean)
        .join(' '),
    }));
  }, [activeMergePreview, aiChanges, aiProposal, canvasNodes]);
  const renderedEdges = useMemo<EditorGraphEdge[]>(() => {
    const virtualEdges = canvasNodes.flatMap((node): EditorGraphEdge[] => {
      if (node.type !== StoryNodeType.FlowJump) return [];
      const targetNodeId = (node.data as FlowJumpNodeData).targetNodeId;
      const target = targetNodeId
        ? canvasNodes.find((candidate) => candidate.id === targetNodeId)
        : undefined;
      if (!target || (!node.selected && !target.selected)) return [];
      return [
        {
          id: `e_portal_${node.id}` as EdgeId,
          source: node.id,
          sourceHandle: 'portal-out',
          target: target.id,
          targetHandle: 'portal-in',
          selectable: false,
          deletable: false,
          animated: true,
          style: { stroke: '#55c9c6', strokeWidth: 2, strokeDasharray: '7 5' },
        },
      ];
    });
    const mergeAdded = new Set(activeMergePreview?.addedEdgeIds ?? []);
    const mergeRemoved = new Set(activeMergePreview?.removedEdgeIds ?? []);
    const mergeConflicts = new Set(activeMergePreview?.conflictEdgeIds ?? []);
    return [...canvasEdges, ...virtualEdges].map((edge) => ({
      ...edge,
      className: [
        edge.className,
        mergeConflicts.has(edge.id)
          ? 'merge-preview-edge-conflict'
          : mergeRemoved.has(edge.id)
            ? 'merge-preview-edge-removed'
            : mergeAdded.has(edge.id)
              ? 'merge-preview-edge-added'
              : '',
      ]
        .filter(Boolean)
        .join(' '),
    }));
  }, [activeMergePreview, canvasEdges, canvasNodes]);
  const selectedMergeConflicts = useMemo(() => {
    if (!storyMergePreview || !mergeConflictSelection) return [];
    const selected = new Set(mergeConflictSelection.conflictIds);
    return storyMergePreview.conflicts.filter((conflict) => selected.has(conflict.id));
  }, [mergeConflictSelection, storyMergePreview]);
  const mergeConflictTargets = useMemo(() => {
    if (!storyMergePreview) return [];
    return storyMergePreview.conflicts
      .filter((conflict) => storyMergePreview.decisions[conflict.id] === undefined)
      .flatMap((conflict) => {
        for (const previewGraph of storyMergePreview.graphs) {
          const nodeEntry = Object.entries(previewGraph.nodeConflictIds).find(([, ids]) =>
            ids.includes(conflict.id),
          );
          if (nodeEntry) {
            return [
              {
                conflictId: conflict.id,
                graphId: previewGraph.id,
                nodeId: nodeEntry[0] as NodeId,
                conflictIds: previewGraph.nodeConflictIds[nodeEntry[0]],
              },
            ];
          }
          const edgeEntry = Object.entries(previewGraph.edgeConflictIds).find(([, ids]) =>
            ids.includes(conflict.id),
          );
          if (edgeEntry) {
            const edge = previewGraph.graph.edges.find(
              (candidate) => candidate.id === edgeEntry[0],
            );
            if (edge) {
              return [
                {
                  conflictId: conflict.id,
                  graphId: previewGraph.id,
                  nodeId: edge.source,
                  edgeId: edge.id,
                  conflictIds: previewGraph.edgeConflictIds[edgeEntry[0]],
                },
              ];
            }
          }
        }
        return [];
      });
  }, [storyMergePreview]);

  const navigateMergeConflict = useCallback(
    (direction: -1 | 1) => {
      if (mergeConflictTargets.length === 0) return;
      const currentId = mergeConflictSelection?.conflictIds[0];
      const currentIndex = mergeConflictTargets.findIndex(
        (target) => target.conflictId === currentId,
      );
      const nextIndex =
        (currentIndex + direction + mergeConflictTargets.length) % mergeConflictTargets.length;
      const target = mergeConflictTargets[nextIndex];
      const edgeId = ('edgeId' in target ? target.edgeId : undefined) as EdgeId | undefined;
      setStoryMergePreviewGraph(target.graphId);
      setMergeConflictSelection({
        graphId: target.graphId,
        nodeId: edgeId ? undefined : target.nodeId,
        edgeId,
        conflictIds: target.conflictIds,
      });
      requestAnimationFrame(() => {
        void flowInstance?.fitView({
          nodes: [{ id: target.nodeId }],
          padding: 0.55,
          duration: 220,
          maxZoom: 1.2,
        });
      });
    },
    [
      flowInstance,
      mergeConflictSelection?.conflictIds,
      mergeConflictTargets,
      setStoryMergePreviewGraph,
    ],
  );

  useEffect(() => {
    if (!storyMergePreview) setMergeConflictSelection(undefined);
  }, [storyMergePreview]);

  if (!hasActiveStory) {
    return (
      <div className={styles.welcome}>
        <div className={styles.welcomeCard}>
          <div className={styles.welcomeMark}>SB</div>
          <h1>Story Blueprint</h1>
          <p>
            {workspace
              ? `${workspace.project?.displayName ?? workspace.name} is open. Choose a Story from Explorer or create one there.`
              : 'Open a project or a Story file to begin.'}
          </p>
          <div className={styles.welcomeActions}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => void newProject()}
            >
              New Project
            </button>
            <button type="button" onClick={() => void openProject()}>
              Open Project…
            </button>
            <button type="button" onClick={() => void openStory()}>
              Open Story…
            </button>
          </div>
          {workspaceError && (
            <div className={styles.welcomeError}>
              <span>{workspaceError}</span>
              <CopyButton text={workspaceError} />
            </div>
          )}
          {!workspace && recentProjects.length > 0 && (
            <div className={styles.recentProjects}>
              <h2>Recent Projects</h2>
              {recentProjects.map((project) => (
                <div className={styles.recentProject} key={project.filePath}>
                  <button
                    type="button"
                    className={styles.recentProjectOpen}
                    title={project.filePath}
                    onClick={() => void openRecentProject(project.filePath)}
                  >
                    <strong>{project.name}</strong>
                    <span>{project.filePath}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.recentProjectRemove}
                    title="Remove from Recent Projects"
                    aria-label={`Remove ${project.name} from recent projects`}
                    onClick={() => void removeRecentProject(project.filePath)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <small>
            Projects use a .storyproject file. Individual Stories remain separate .story files.
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div
        className={styles.canvas}
        ref={canvasRef}
        onMouseDownCapture={handleCanvasMouseDown}
        onMouseMoveCapture={(event) => {
          const drag = rightDragRef.current;
          if (!drag || !(event.buttons & 2)) return;
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 4) {
            drag.moved = true;
          }
          if (drag.manualPan && flowInstance) {
            event.preventDefault();
            event.stopPropagation();
            const viewport = flowInstance.getViewport();
            void flowInstance.setViewport({
              ...viewport,
              x: viewport.x + event.clientX - drag.lastX,
              y: viewport.y + event.clientY - drag.lastY,
            });
          }
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
        }}
        onContextMenuCapture={(event) => {
          const target = event.target instanceof Element ? event.target : undefined;
          if (!target?.closest('.react-flow__nodesselection')) return;
          event.stopPropagation();
          openContextMenu(event);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(storyDataMime)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          if (mergePreviewActive) return;
          const payload = readStoryDataDrag(event.dataTransfer);
          if (!payload || !flowInstance) return;
          event.preventDefault();
          const position = flowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          if (payload.kind === 'character') {
            addNode(StoryNodeType.Dialogue, position, {
              lines: [
                {
                  id: createStableId('line'),
                  textId: createStableId('text'),
                  text: { source: '' },
                  speakerId: payload.id,
                },
              ],
            });
          } else if (payload.kind === 'variable' && payload.action === 'set') {
            addNode(StoryNodeType.SetVariable, position, {
              variableId: payload.id,
              value: { source: '', bindings: {} },
            });
          } else if (payload.kind === 'variable') {
            addNode(StoryNodeType.GetVariable, position, { variableId: payload.id });
          } else if (payload.kind === 'event') {
            const definition = events.find((candidate) => candidate.id === payload.id);
            addNode(StoryNodeType.CallEvent, position, {
              eventId: payload.id,
              arguments: Object.fromEntries(
                (definition?.parameters ?? []).map((parameter) => [
                  parameter.name,
                  {
                    source:
                      parameter.valueType.kind === 'string'
                        ? '""'
                        : parameter.valueType.kind === 'boolean'
                          ? 'false'
                          : '0',
                    bindings: {},
                  },
                ]),
              ),
            });
          } else if (payload.kind === 'signal') {
            addNode(StoryNodeType.WaitSignal, position, { signalId: payload.id, matches: {} });
          }
        }}
      >
        <div className={styles.graphBadge}>
          <div className={styles.graphIdentity}>
            <span>{activeGraphId === 'root' ? 'Root Blueprint' : 'Substory'}</span>
            {activeName}
          </div>
          <label className={styles.controlMode}>
            <span>Controls</span>
            <select
              value={controlMode}
              title={
                controlMode === 'blueprint'
                  ? 'Left drag selects; right drag pans'
                  : 'Left drag pans; Shift + left drag selects'
              }
              onChange={(event) => setControlMode(event.target.value as GraphControlMode)}
            >
              <option value="blueprint">Blueprint</option>
              <option value="standard">Standard</option>
            </select>
          </label>
          <div className={styles.layoutActions}>
            {!aiProposal && (
              <button
                type="button"
                disabled={mergePreviewActive || selectedCount < 2}
                title="Arrange only the selected nodes from left to right"
                onClick={() => arrangeGraph('selected')}
              >
                Layout Selected
              </button>
            )}
            <button
              type="button"
              disabled={
                mergePreviewActive ||
                (aiProposal ? aiProposal.addedNodeIds.length < 2 : nodes.length < 2)
              }
              title={
                aiProposal
                  ? 'Arrange the AI-added preview nodes without applying them'
                  : 'Arrange every node in the active story from left to right'
              }
              onClick={() => arrangeGraph('all')}
            >
              {aiProposal ? 'Layout Proposal' : 'Layout All'}
            </button>
          </div>
          <button
            type="button"
            className={styles.shortcutsButton}
            title="Search this Story (Ctrl+F)"
            onClick={openSearch}
          >
            Search
          </button>
          <button
            type="button"
            className={styles.shortcutsButton}
            onClick={() => setShowShortcuts((current) => !current)}
          >
            Shortcuts
          </button>
        </div>
        <ReactFlow<EditorGraphNode, EditorGraphEdge>
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={
            mergePreviewActive
              ? () => undefined
              : aiProposal
                ? updateAIProposalNodes
                : onNodesChange
          }
          onEdgesChange={mergePreviewActive || aiProposal ? () => undefined : onEdgesChange}
          onEdgeClick={onEdgeClick}
          onEdgeContextMenu={openEdgeContextMenu}
          onEdgeDoubleClick={(event, edge) => {
            const actualEdge = edges.find((candidate) => candidate.id === edge.id);
            if (!actualEdge || !flowInstance || !isExecutionEdge(actualEdge, nodes)) return;
            event.preventDefault();
            insertReroute(
              actualEdge,
              flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
          }}
          onNodeClick={(event, node) => {
            if (!activeMergePreview) return;
            const conflictIds = activeMergePreview.nodeConflictIds[node.id] ?? [];
            if (conflictIds.length === 0) return;
            event.preventDefault();
            setMergeConflictSelection({
              graphId: activeMergePreview.id,
              nodeId: node.id,
              conflictIds,
            });
          }}
          onNodeDoubleClick={(_event, node) => {
            if (mergePreviewActive) return;
            if (node.type !== StoryNodeType.FlowJump || !flowInstance) return;
            const targetNodeId = (node.data as FlowJumpNodeData).targetNodeId;
            const target = targetNodeId
              ? nodes.find(
                  (candidate) =>
                    candidate.id === targetNodeId && candidate.type === StoryNodeType.FlowAnchor,
                )
              : undefined;
            if (!target) return;
            setNodes((current) =>
              current.map((candidate) => ({ ...candidate, selected: candidate.id === target.id })),
            );
            void flowInstance.fitView({ nodes: [target], padding: 1.2, duration: 250 });
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onInit={setFlowInstance}
          onPaneClick={() => setContextMenu(null)}
          onPaneContextMenu={openContextMenu}
          onSelectionEnd={mergeAdditiveSelection}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          nodesConnectable={!aiProposal && !mergePreviewActive}
          elementsSelectable={!aiProposal && !mergePreviewActive}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { stroke: '#aeb7c4', strokeWidth: 2.25 },
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={{ stroke: '#dbe2eb', strokeWidth: 2.25 }}
          colorMode="dark"
          fitView
          deleteKeyCode={null}
          multiSelectionKeyCode={['Shift', 'Control']}
          selectionKeyCode={controlMode === 'blueprint' ? null : 'Shift'}
          selectionOnDrag={controlMode === 'blueprint'}
          selectionMode={SelectionMode.Partial}
          panOnDrag={controlMode === 'blueprint' ? [2] : [0, 1]}
          panActivationKeyCode={controlMode === 'blueprint' ? null : 'Space'}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3d3d3d" />
          <MiniMap nodeStrokeColor="#555" nodeColor="#333" maskColor="rgba(0,0,0,0.6)" />
          <Controls />
        </ReactFlow>
        {showSearch && (
          <aside className={styles.searchPanel}>
            <div className={styles.searchBar}>
              <input
                ref={searchInputRef}
                value={searchQuery}
                placeholder="Search this Story…"
                aria-label="Search this Story"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setActiveSearchIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowSearch(false);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveSearchResult(1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveSearchResult(-1);
                  } else if (event.key === 'Enter' && searchResults[activeSearchIndex]) {
                    event.preventDefault();
                    activateSearchResult(searchResults[activeSearchIndex]);
                  }
                }}
              />
              <span className={styles.searchCount}>
                {searchResults.length > 0
                  ? `${activeSearchIndex + 1}/${searchResults.length}`
                  : '0/0'}
              </span>
              <button
                type="button"
                title="Previous result"
                disabled={searchResults.length === 0}
                onClick={() => moveSearchResult(-1, true)}
              >
                ↑
              </button>
              <button
                type="button"
                title="Next result"
                disabled={searchResults.length === 0}
                onClick={() => moveSearchResult(1, true)}
              >
                ↓
              </button>
              <button type="button" title="Close search" onClick={() => setShowSearch(false)}>
                ×
              </button>
            </div>
            {searchQuery.trim() ? (
              searchResults.length > 0 ? (
                <div className={styles.searchResults} ref={searchResultsRef}>
                  {searchResults.map((result, index) => (
                    <button
                      type="button"
                      key={result.id}
                      data-active={index === activeSearchIndex}
                      className={
                        index === activeSearchIndex ? styles.activeSearchResult : undefined
                      }
                      onMouseEnter={() => setActiveSearchIndex(index)}
                      onClick={() => {
                        setActiveSearchIndex(index);
                        activateSearchResult(result);
                      }}
                    >
                      <span className={styles.searchResultCategory}>{result.category}</span>
                      <strong>{result.title}</strong>
                      <small>{result.detail}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.searchEmpty}>No matching nodes or Story Data.</div>
              )
            ) : (
              <div className={styles.searchEmpty}>
                Search Dialogue, Choice, nodes, variables, characters, events, signals, and assets.
              </div>
            )}
          </aside>
        )}
        {aiProposal && (
          <aside className={styles.aiChangeBanner}>
            <div>
              <strong>AI proposal preview</strong>
              <span>Move the green nodes, then Apply or Discard. Story is unchanged.</span>
            </div>
            <button type="button" onClick={() => void applyAIProposal()}>
              Apply
            </button>
            <button type="button" className={styles.aiUndoButton} onClick={discardAIProposal}>
              Discard
            </button>
          </aside>
        )}
        {activeMergePreview && !aiProposal && (
          <aside className={`${styles.aiChangeBanner} ${styles.mergePreviewBanner}`}>
            <div>
              <strong>Story merge preview · {activeMergePreview.displayName}</strong>
              <span>
                +{activeMergePreview.addedNodeIds.length} · ~
                {activeMergePreview.changedNodeIds.length} · −
                {activeMergePreview.removedNodeIds.length} · !
                {activeMergePreview.conflictNodeIds.length} nodes
              </span>
            </div>
            <div className={styles.mergeLegend} aria-label="Merge preview legend">
              <span className={styles.legendAdded}>Added</span>
              <span className={styles.legendModified}>Modified</span>
              <span className={styles.legendRemoved}>Removed</span>
              <span className={styles.legendConflict}>Conflict</span>
            </div>
            <label className={styles.mergeGraphSelect}>
              <span>Graph</span>
              <select
                value={activeMergePreview.id}
                onChange={(event) => setStoryMergePreviewGraph(event.target.value as ActiveGraphId)}
              >
                {storyMergePreview?.graphs.map((previewGraph) => (
                  <option key={previewGraph.id} value={previewGraph.id}>
                    {previewGraph.displayName}
                    {!chapters.some((chapter) => chapter.id === previewGraph.id) &&
                    previewGraph.id !== 'root'
                      ? ' · Remote only'
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={mergeConflictTargets.length === 0}
              onClick={() => navigateMergeConflict(-1)}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={mergeConflictTargets.length === 0}
              onClick={() => navigateMergeConflict(1)}
            >
              Next
            </button>
            <button type="button" className={styles.aiUndoButton} onClick={clearStoryMergePreview}>
              Exit Preview
            </button>
          </aside>
        )}
        {activeMergePreview && selectedMergeConflicts.length > 0 && (
          <aside className={styles.mergeConflictCard}>
            <header>
              <div>
                <strong>
                  {mergeConflictSelection?.nodeId
                    ? `Node ${mergeConflictSelection.nodeId}`
                    : 'Connection conflict'}
                </strong>
                <span>{selectedMergeConflicts.length} field conflict(s)</span>
              </div>
              <button type="button" onClick={() => setMergeConflictSelection(undefined)}>
                ×
              </button>
            </header>
            <div className={styles.mergeConflictFields}>
              {selectedMergeConflicts.map((conflict) => {
                const choice = storyMergePreview?.decisions[conflict.id];
                return (
                  <section key={conflict.id}>
                    <code>{conflict.path}</code>
                    <div>
                      <button
                        type="button"
                        className={choice === 'local' ? styles.mergeChoiceSelected : undefined}
                        onClick={() => chooseStoryMergePreviewConflict(conflict.id, 'local')}
                      >
                        <strong>Local</strong>
                        <pre>
                          {mergeValueText(conflict.localValue, conflict.kind !== 'remote-only')}
                        </pre>
                      </button>
                      <button
                        type="button"
                        className={choice === 'remote' ? styles.mergeChoiceSelected : undefined}
                        onClick={() => chooseStoryMergePreviewConflict(conflict.id, 'remote')}
                      >
                        <strong>Remote</strong>
                        <pre>
                          {mergeValueText(conflict.remoteValue, conflict.kind !== 'local-only')}
                        </pre>
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        )}
        {!aiProposal && aiChanges && (
          <aside className={styles.aiChangeBanner}>
            <div>
              <strong>AI changes awaiting confirmation</strong>
              <span>
                +{aiChanges.addedNodeIds.length} nodes · ~{aiChanges.changedNodeIds.length} nodes ·
                −{aiChanges.removedNodeIds.length} nodes · ~{aiChanges.variableChangeCount}{' '}
                variables
              </span>
            </div>
            <button type="button" onClick={clearAIChanges}>
              Accept
            </button>
            <button type="button" className={styles.aiUndoButton} onClick={undo}>
              Undo AI Changes
            </button>
          </aside>
        )}
        {transferPreview && (
          <svg className={styles.transferPreview} aria-hidden="true">
            {transferPreview.fixedPoints.map((point, index) => {
              const middle = (point.x + transferPreview.pointer.x) / 2;
              return (
                <path
                  key={index}
                  d={`M ${point.x} ${point.y} C ${middle} ${point.y}, ${middle} ${transferPreview.pointer.y}, ${transferPreview.pointer.x} ${transferPreview.pointer.y}`}
                />
              );
            })}
          </svg>
        )}
        {showShortcuts && (
          <aside className={styles.shortcutsPanel}>
            <header>
              <strong>Graph Shortcuts</strong>
              <button type="button" onClick={() => setShowShortcuts(false)}>
                ×
              </button>
            </header>
            <dl>
              <dt>Alt + Left-click Pin</dt>
              <dd>Break every connection on the pin</dd>
              <dt>Alt + Left-click Wire</dt>
              <dd>Break only the clicked connection</dd>
              <dt>Ctrl + Left-drag Pin</dt>
              <dd>Move all wires to a compatible pin in the same direction</dd>
              <dt>Double-click Wire</dt>
              <dd>Insert a visual Reroute point</dd>
              <dt>Right-click Wire</dt>
              <dd>Insert Reroute or convert the wire to a Flow Portal</dd>
              <dt>Right-click</dt>
              <dd>Open the graph action menu</dd>
              <dt>Delete</dt>
              <dd>Delete selected nodes and wires</dd>
              <dt>Ctrl + C / V / D</dt>
              <dd>Copy, paste, or duplicate selected nodes</dd>
              <dt>Ctrl + Z / Y</dt>
              <dd>Undo or redo</dd>
              <dt>Ctrl + F</dt>
              <dd>Search nodes, dialogue, choices, and Story Data across this Story</dd>
              <dt>Layout Selected / All</dt>
              <dd>Arrange nodes from left to right; the result can be undone</dd>
              <dt>Shift + Left-drag</dt>
              <dd>Add another marquee selection without clearing selected nodes</dd>
              <dt>Ctrl + Left-click Selected Node</dt>
              <dd>Toggle one node in or out of the current multi-selection</dd>
              <dt>Right-drag Selection Frame</dt>
              <dd>Pan the graph without losing the current selection</dd>
              <dt>
                {controlMode === 'blueprint'
                  ? 'Left-drag / Right-drag'
                  : 'Left-drag / Shift + Left-drag'}
              </dt>
              <dd>
                {controlMode === 'blueprint'
                  ? 'Marquee select / pan the graph'
                  : 'Pan the graph / marquee select'}
              </dd>
            </dl>
            <small>Pin gestures follow Unreal Engine Blueprint conventions.</small>
          </aside>
        )}
        {contextMenu && (
          <div
            className={styles.contextMenu}
            style={{ left: contextMenu.left, top: contextMenu.top }}
          >
            <div className={styles.contextMenuTitle}>
              {contextMenu.edge ? 'Wire Actions' : 'Create Node'}
            </div>
            {contextMenu.edge ? (
              <>
                <button
                  type="button"
                  onClick={() => insertReroute(contextMenu.edge!, contextMenu.flowPosition)}
                >
                  <span className={styles.contextMenuColor} style={{ background: '#8d99a8' }} />
                  Insert Reroute
                </button>
                <button type="button" onClick={() => convertEdgeToPortal(contextMenu.edge!)}>
                  <span className={styles.contextMenuColor} style={{ background: '#38a6a5' }} />
                  Convert to Flow Portal
                </button>
              </>
            ) : (
              <>
                {nodeRegistry.list().map((definition) => (
                  <button
                    key={definition.type}
                    type="button"
                    disabled={
                      (definition.type === StoryNodeType.Start && hasStoryEntry) ||
                      (definition.type === StoryNodeType.Return && activeGraphId === 'root')
                    }
                    onClick={() => createNode(definition.type)}
                  >
                    <span
                      className={styles.contextMenuColor}
                      style={{ background: definition.color }}
                    />
                    {definition.label}
                  </button>
                ))}
                {selectedCount > 0 && (
                  <>
                    <div className={styles.contextMenuDivider} />
                    <button
                      type="button"
                      onClick={() => {
                        const result = extractSelectionToSubstory();
                        if (!result.ok) setConnectionError(result.message);
                        setContextMenu(null);
                      }}
                    >
                      <span className={styles.contextMenuColor} style={{ background: '#6d96df' }} />
                      Extract to Substory
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {connectionError && (
          <div className={styles.connectionError}>
            <span>{connectionError}</span>
            <CopyButton text={connectionError} />
          </div>
        )}
      </div>
    </div>
  );
}
