import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from 'react';
import {
  useEdgesState,
  useNodesState,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';
import {
  NodeFactory,
  StoryNodeType,
  nodeRegistry,
  type NodeId,
  type NodeInstance,
  type StoryNodeDataMap,
} from '@story-blueprint/common';
import {
  toEditorGraphNode,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
} from './editorGraph';
import { useGraphHistory } from './useGraphHistory';

nodeRegistry.registerBuiltins();

function createInitialNodes(): EditorGraphNode[] {
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

interface StoryGraphStoreValue {
  graph: EditorGraphState;
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
  onNodesChange: OnNodesChange<EditorGraphNode>;
  onEdgesChange: OnEdgesChange<EditorGraphEdge>;
  setNodes: Dispatch<SetStateAction<EditorGraphNode[]>>;
  setEdges: Dispatch<SetStateAction<EditorGraphEdge[]>>;
  checkpoint: () => void;
  restoreGraph: (graph: EditorGraphState) => void;
  undo: () => void;
  redo: () => void;
  addNode: (type: StoryNodeType, position: XYPosition) => NodeId | null;
  updateNode: (id: NodeId, update: { name?: string }) => void;
  updateNodeData: <T extends StoryNodeType>(
    id: NodeId,
    type: T,
    update: Partial<StoryNodeDataMap[T]>,
  ) => void;
}

const StoryGraphStoreContext = createContext<StoryGraphStoreValue | null>(null);

export function StoryGraphStoreProvider({ children }: PropsWithChildren) {
  const initialNodes = useMemo(createInitialNodes, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorGraphNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorGraphEdge>([]);
  const graph = useMemo<EditorGraphState>(() => ({ nodes, edges }), [edges, nodes]);
  const history = useGraphHistory();

  const checkpoint = useCallback(() => history.checkpoint(graph), [graph, history]);

  const restoreGraph = useCallback(
    (next: EditorGraphState) => {
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [setEdges, setNodes],
  );

  const undo = useCallback(() => {
    const previous = history.undo(graph);
    if (previous) restoreGraph(previous);
  }, [graph, history, restoreGraph]);

  const redo = useCallback(() => {
    const next = history.redo(graph);
    if (next) restoreGraph(next);
  }, [graph, history, restoreGraph]);

  const addNode = useCallback(
    (type: StoryNodeType, position: XYPosition): NodeId | null => {
      if (type === StoryNodeType.Start && nodes.some((node) => node.type === type)) return null;
      const instance = NodeFactory.create(NodeFactory.generateId(type), type, position);
      if (!instance) return null;

      checkpoint();
      const node = { ...toEditorGraphNode(instance), selected: true };
      setNodes((current) => [
        ...current.map((existing) => ({ ...existing, selected: false })),
        node,
      ]);
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
      return node.id;
    },
    [checkpoint, nodes, setEdges, setNodes],
  );

  const updateNode = useCallback(
    (id: NodeId, update: { name?: string }) => {
      setNodes((current) =>
        current.map((node) => (node.id === id ? { ...node, ...update } : node)),
      );
    },
    [setNodes],
  );

  const updateNodeData = useCallback(
    <T extends StoryNodeType>(id: NodeId, type: T, update: Partial<StoryNodeDataMap[T]>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id && node.type === type
            ? { ...node, data: { ...node.data, ...update } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const value = useMemo<StoryGraphStoreValue>(
    () => ({
      graph,
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      checkpoint,
      restoreGraph,
      undo,
      redo,
      addNode,
      updateNode,
      updateNodeData,
    }),
    [
      addNode,
      checkpoint,
      edges,
      graph,
      nodes,
      onEdgesChange,
      onNodesChange,
      redo,
      restoreGraph,
      setEdges,
      setNodes,
      undo,
      updateNode,
      updateNodeData,
    ],
  );

  return (
    <StoryGraphStoreContext.Provider value={value}>{children}</StoryGraphStoreContext.Provider>
  );
}

export function useStoryGraphStore(): StoryGraphStoreValue {
  const store = useContext(StoryGraphStoreContext);
  if (!store) throw new Error('useStoryGraphStore must be used inside StoryGraphStoreProvider');
  return store;
}
