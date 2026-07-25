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
  type VariableId,
  type VariableDefinition,
  type CharacterId,
  type CharacterSource,
  type AssetSource,
  type AssetId,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renameExpressionIdentifier(source: string, oldName: string, newName: string): string {
  return source.replace(new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'g'), newName);
}

function renameTemplateIdentifier(source: string, oldName: string, newName: string): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('{{', index) || source.startsWith('}}', index)) {
      result += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (source[index] !== '{') {
      result += source[index++];
      continue;
    }
    const end = source.indexOf('}', index + 1);
    if (end < 0) return result + source.slice(index);
    const expression = source.slice(index + 1, end);
    result += `{${renameExpressionIdentifier(expression, oldName, newName)}}`;
    index = end + 1;
  }
  return result;
}

function renameVariableInNode(
  node: EditorGraphNode,
  oldName: string,
  newName: string,
): EditorGraphNode {
  switch (node.type) {
    case StoryNodeType.Dialogue:
      return {
        ...node,
        data: {
          ...node.data,
          text: {
            source: renameTemplateIdentifier(
              (node.data as StoryNodeDataMap[StoryNodeType.Dialogue]).text.source,
              oldName,
              newName,
            ),
          },
        },
      };
    case StoryNodeType.Choice: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      return {
        ...node,
        data: {
          ...node.data,
          prompt: {
            source: renameTemplateIdentifier(data.prompt.source, oldName, newName),
          },
          options: data.options.map((option) => ({
            ...option,
            text: {
              source: renameTemplateIdentifier(option.text.source, oldName, newName),
            },
            visibleIf: option.visibleIf
              ? {
                  ...option.visibleIf,
                  source: renameExpressionIdentifier(option.visibleIf.source, oldName, newName),
                }
              : undefined,
            enabledIf: option.enabledIf
              ? {
                  ...option.enabledIf,
                  source: renameExpressionIdentifier(option.enabledIf.source, oldName, newName),
                }
              : undefined,
          })),
        },
      };
    }
    case StoryNodeType.Branch: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Branch];
      return {
        ...node,
        data: {
          ...node.data,
          condition: {
            ...data.condition,
            source: renameExpressionIdentifier(data.condition.source, oldName, newName),
          },
        },
      };
    }
    case StoryNodeType.SetVariable: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
      return {
        ...node,
        data: {
          ...node.data,
          value: {
            ...data.value,
            source: renameExpressionIdentifier(data.value.source, oldName, newName),
          },
        },
      };
    }
    default:
      return node;
  }
}

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
  source: StorySourceDocument;
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
  addNode: (
    type: StoryNodeType,
    position: XYPosition,
    initialData?: Partial<StoryNodeDataMap[StoryNodeType]>,
  ) => NodeId | null;
  updateNode: (id: NodeId, update: { name?: string }) => void;
  updateNodeData: <T extends StoryNodeType>(
    id: NodeId,
    type: T,
    update: Partial<StoryNodeDataMap[T]>,
  ) => void;
  document: StoryDocumentInfo;
  variables: VariableDefinition[];
  characters: CharacterSource[];
  assets: AssetSource[];
  addVariable: () => VariableId;
  updateVariable: (id: VariableId, update: Partial<VariableDefinition>) => void;
  removeVariable: (id: VariableId) => void;
  addCharacter: () => CharacterId;
  updateCharacter: (id: CharacterId, update: Partial<CharacterSource>) => void;
  removeCharacter: (id: CharacterId) => void;
  addAsset: () => AssetId;
  updateAsset: (id: AssetId, update: Partial<AssetSource>) => void;
  removeAsset: (id: AssetId) => void;
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
  const [variables, setVariables] = useState<VariableDefinition[]>([]);
  const [characters, setCharacters] = useState<CharacterSource[]>([]);
  const [assets, setAssets] = useState<AssetSource[]>([]);
  const revisionRef = useRef(0);
  const [document, setDocument] = useState<StoryDocumentInfo>(() => ({
    id: createStableId('story'),
    name: 'untitled',
    displayName: 'Untitled Story',
    dirty: false,
  }));
  const source = useMemo<StorySourceDocument>(
    () => ({
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: document.id,
      name: document.name,
      displayName: document.displayName,
      root: toSourceGraph(graph),
      chapters: [],
      variables,
      characters,
      assets,
      events: [],
    }),
    [assets, characters, document.displayName, document.id, document.name, graph, variables],
  );

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
    (
      type: StoryNodeType,
      position: XYPosition,
      initialData?: Partial<StoryNodeDataMap[StoryNodeType]>,
    ): NodeId | null => {
      if (type === StoryNodeType.Start && nodes.some((node) => node.type === type)) return null;
      const instance = NodeFactory.create(NodeFactory.generateId(type), type, position);
      if (!instance) return null;

      checkpoint();
      const node = {
        ...toEditorGraphNode(instance),
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        data: { ...instance.data, ...initialData },
        selected: true,
      } as EditorGraphNode;
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

  const addVariable = useCallback((): VariableId => {
    const id = createStableId('variable');
    setVariables((current) => {
      const used = new Set(current.map((variable) => variable.name));
      let index = current.length + 1;
      let name = `variable${index}`;
      while (used.has(name)) name = `variable${++index}`;
      return [
        ...current,
        {
          id,
          name,
          displayName: name,
          scope: 'story',
          valueType: { kind: 'string' },
          defaultValue: '',
        },
      ];
    });
    markDirty();
    return id;
  }, [markDirty]);

  const updateVariable = useCallback(
    (id: VariableId, update: Partial<VariableDefinition>) => {
      const previous = variables.find((variable) => variable.id === id);
      if (previous && update.name && update.name !== previous.name) {
        setNodes((current) =>
          current.map((node) => renameVariableInNode(node, previous.name, update.name!)),
        );
      }
      setVariables((current) =>
        current.map((variable) => (variable.id === id ? { ...variable, ...update, id } : variable)),
      );
      markDirty();
    },
    [markDirty, setNodes, variables],
  );

  const removeVariable = useCallback(
    (id: VariableId) => {
      setVariables((current) => current.filter((variable) => variable.id !== id));
      setNodes((current) =>
        current.map((node) => {
          if (
            (node.type === StoryNodeType.GetVariable || node.type === StoryNodeType.SetVariable) &&
            node.data.variableId === id
          ) {
            return { ...node, data: { ...node.data, variableId: undefined } };
          }
          return node;
        }),
      );
      markDirty();
    },
    [markDirty, setNodes],
  );

  const addCharacter = useCallback((): CharacterId => {
    const id = createStableId('character');
    setCharacters((current) => {
      const index = current.length + 1;
      return [
        ...current,
        {
          id,
          name: `character${index}`,
          displayName: `Character ${index}`,
          emotions: { neutral: { displayName: 'Neutral' } },
        },
      ];
    });
    markDirty();
    return id;
  }, [markDirty]);

  const updateCharacter = useCallback(
    (id: CharacterId, update: Partial<CharacterSource>) => {
      setCharacters((current) =>
        current.map((character) =>
          character.id === id ? { ...character, ...update, id } : character,
        ),
      );
      markDirty();
    },
    [markDirty],
  );

  const removeCharacter = useCallback(
    (id: CharacterId) => {
      setCharacters((current) => current.filter((character) => character.id !== id));
      setNodes((current) =>
        current.map((node) =>
          node.type === StoryNodeType.Dialogue && node.data.speakerId === id
            ? { ...node, data: { ...node.data, speakerId: undefined } }
            : node,
        ),
      );
      markDirty();
    },
    [markDirty, setNodes],
  );

  const addAsset = useCallback((): AssetId => {
    const id = createStableId('asset');
    setAssets((current) => {
      const index = current.length + 1;
      return [
        ...current,
        {
          id,
          name: `voice${index}`,
          displayName: `Voice ${index}`,
          kind: 'audio',
          locales: { default: '' },
        },
      ];
    });
    markDirty();
    return id;
  }, [markDirty]);

  const updateAsset = useCallback(
    (id: AssetId, update: Partial<AssetSource>) => {
      setAssets((current) =>
        current.map((asset) => (asset.id === id ? { ...asset, ...update, id } : asset)),
      );
      markDirty();
    },
    [markDirty],
  );

  const removeAsset = useCallback(
    (id: AssetId) => {
      setAssets((current) => current.filter((asset) => asset.id !== id));
      setNodes((current) =>
        current.map((node) =>
          node.type === StoryNodeType.Dialogue && node.data.voiceId === id
            ? { ...node, data: { ...node.data, voiceId: undefined } }
            : node,
        ),
      );
      setCharacters((current) =>
        current.map((character) => ({
          ...character,
          defaultPortraitId:
            character.defaultPortraitId === id ? undefined : character.defaultPortraitId,
          emotions: Object.fromEntries(
            Object.entries(character.emotions).map(([key, emotion]) => [
              key,
              emotion.portraitId === id ? { ...emotion, portraitId: undefined } : emotion,
            ]),
          ),
        })),
      );
      markDirty();
    },
    [markDirty, setNodes],
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
    setVariables([]);
    setCharacters([]);
    setAssets([]);
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
      setVariables([...source.variables]);
      setCharacters([...source.characters]);
      setAssets([...source.assets]);
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
    [document, source],
  );

  const value = useMemo<StoryGraphStoreValue>(
    () => ({
      source,
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
      variables,
      characters,
      assets,
      addVariable,
      updateVariable,
      removeVariable,
      addCharacter,
      updateCharacter,
      removeCharacter,
      addAsset,
      updateAsset,
      removeAsset,
      document,
      markDirty,
      newStory,
      openStory,
      saveStory,
    }),
    [
      addNode,
      addVariable,
      addCharacter,
      addAsset,
      checkpoint,
      characters,
      document,
      edges,
      graph,
      nodes,
      markDirty,
      newStory,
      onEdgesChange,
      onNodesChange,
      redo,
      removeCharacter,
      removeAsset,
      removeVariable,
      restoreGraph,
      setEdges,
      setNodes,
      openStory,
      saveStory,
      source,
      undo,
      updateCharacter,
      updateAsset,
      updateNode,
      updateNodeData,
      updateVariable,
      variables,
      assets,
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
