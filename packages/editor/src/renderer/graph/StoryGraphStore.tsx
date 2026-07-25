import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
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
  parseStorySource,
  serializeStorySource,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStableId,
  nodeRegistry,
  type NodeId,
  type StoryNodeDataMap,
  type StoryId,
  type StorySourceDocument,
} from '@story-blueprint/common';
import {
  fromSourceGraph,
  toEditorGraphNode,
  toSourceGraph,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
} from './editorGraph';
import { useGraphHistory } from './useGraphHistory';

nodeRegistry.registerBuiltins();

function createNewGraph(): EditorGraphState {
  const instance = NodeFactory.create(
    NodeFactory.generateId(StoryNodeType.Start),
    StoryNodeType.Start,
    {
      x: 160,
      y: 120,
    },
  );
  return { nodes: instance ? [{ ...toEditorGraphNode(instance), selected: true }] : [], edges: [] };
}

interface StoryDocumentInfo {
  id: StoryId;
  name: string;
  displayName: string;
  filePath?: string;
  fileToken?: string;
  dirty: boolean;
  error?: string;
}

interface StoryGraphStoreValue {
  graph: EditorGraphState;
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
  onNodesChange: OnNodesChange<EditorGraphNode>;
  onEdgesChange: OnEdgesChange<EditorGraphEdge>;
  setNodes: Dispatch<SetStateAction<EditorGraphNode[]>>;
  setEdges: Dispatch<SetStateAction<EditorGraphEdge[]>>;
  checkpoint: (snapshot?: EditorGraphState) => void;
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
  document: StoryDocumentInfo;
  markDirty: () => void;
  newStory: () => void;
  openStory: () => Promise<void>;
  saveStory: (saveAs?: boolean) => Promise<void>;
}

const StoryGraphStoreContext = createContext<StoryGraphStoreValue | null>(null);

export function StoryGraphStoreProvider({ children }: PropsWithChildren) {
  const initialGraph = useMemo(createNewGraph, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorGraphNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorGraphEdge>(initialGraph.edges);
  const graph = useMemo<EditorGraphState>(() => ({ nodes, edges }), [edges, nodes]);
  const history = useGraphHistory();
  const revisionRef = useRef(0);
  const [document, setDocument] = useState<StoryDocumentInfo>(() => ({
    id: createStableId('story'),
    name: 'untitled',
    displayName: 'Untitled Story',
    dirty: false,
  }));

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    window.electronAPI?.setStoryDirty(true);
    setDocument((current) => ({ ...current, dirty: true, error: undefined }));
  }, []);

  useEffect(() => {
    window.electronAPI?.setStoryDirty(document.dirty);
  }, [document.dirty]);

  const checkpoint = useCallback(
    (snapshot?: EditorGraphState) => history.checkpoint(snapshot ?? graph),
    [graph, history],
  );

  const restoreGraph = useCallback(
    (next: EditorGraphState) => {
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [setEdges, setNodes],
  );

  const undo = useCallback(() => {
    const previous = history.undo(graph);
    if (previous) {
      restoreGraph(previous);
      markDirty();
    }
  }, [graph, history, markDirty, restoreGraph]);

  const redo = useCallback(() => {
    const next = history.redo(graph);
    if (next) {
      restoreGraph(next);
      markDirty();
    }
  }, [graph, history, markDirty, restoreGraph]);

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
      markDirty();
      return node.id;
    },
    [checkpoint, markDirty, nodes, setEdges, setNodes],
  );

  const updateNode = useCallback(
    (id: NodeId, update: { name?: string }) => {
      setNodes((current) =>
        current.map((node) => (node.id === id ? { ...node, ...update } : node)),
      );
      markDirty();
    },
    [markDirty, setNodes],
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
      markDirty();
    },
    [markDirty, setNodes],
  );

  const confirmDiscardChanges = useCallback(
    () => !document.dirty || window.confirm('Discard unsaved story changes?'),
    [document.dirty],
  );

  const newStory = useCallback(() => {
    if (!confirmDiscardChanges()) return;
    restoreGraph(createNewGraph());
    history.clear();
    revisionRef.current = 0;
    setDocument({
      id: createStableId('story'),
      name: 'untitled',
      displayName: 'Untitled Story',
      dirty: false,
    });
  }, [confirmDiscardChanges, history, restoreGraph]);

  const openStory = useCallback(async () => {
    if (!confirmDiscardChanges() || !window.electronAPI) return;
    try {
      const result = await window.electronAPI.openStory();
      if (result.canceled) return;
      const source = parseStorySource(result.content);
      restoreGraph(fromSourceGraph(source.root));
      history.clear();
      revisionRef.current = 0;
      setDocument({
        id: source.id,
        name: source.name,
        displayName: source.displayName,
        filePath: result.filePath,
        fileToken: result.fileToken,
        dirty: false,
      });
    } catch (error) {
      setDocument((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [confirmDiscardChanges, history, restoreGraph]);

  const saveStory = useCallback(
    async (saveAs = false) => {
      if (!window.electronAPI) return;
      try {
        const savingDocumentId = document.id;
        const savingRevision = revisionRef.current;
        const source: StorySourceDocument = {
          format: STORY_SOURCE_FORMAT,
          version: STORY_SOURCE_VERSION,
          id: document.id,
          name: document.name,
          displayName: document.displayName,
          root: toSourceGraph(graph),
          chapters: [],
          variables: [],
          characters: [],
          assets: [],
          events: [],
        };
        const result = await window.electronAPI.saveStory({
          filePath: document.filePath,
          fileToken: document.fileToken,
          content: serializeStorySource(source),
          saveAs,
        });
        if (result.canceled) return;
        setDocument((current) => {
          if (current.id !== savingDocumentId) return current;
          return {
            ...current,
            filePath: result.filePath,
            fileToken: result.fileToken,
            dirty: revisionRef.current !== savingRevision,
            error: undefined,
          };
        });
      } catch (error) {
        setDocument((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [document, graph],
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
      document,
      markDirty,
      newStory,
      openStory,
      saveStory,
    }),
    [
      addNode,
      checkpoint,
      document,
      edges,
      graph,
      nodes,
      markDirty,
      newStory,
      onEdgesChange,
      onNodesChange,
      redo,
      restoreGraph,
      setEdges,
      setNodes,
      openStory,
      saveStory,
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
