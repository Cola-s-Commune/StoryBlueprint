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
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';
import {
  NodeFactory,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  parseStorySource,
  serializeStorySource,
  serializeStoryProject,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStableId,
  nodeRegistry,
  type NodeId,
  type BlueprintCommandTransaction,
  type BlueprintTransactionResult,
  type StorySemanticSnapshot,
  type ChapterId,
  type ChapterSource,
  type VariableId,
  type VariableDefinition,
  type CharacterId,
  type CharacterSource,
  type AssetSource,
  type AssetId,
  type EventId,
  type EventSource,
  type SignalId,
  type SignalSource,
  type DialogueNodeData,
  type DialogueLineId,
  type StoryNodeDataMap,
  type StoryId,
  type StorySourceDocument,
} from '@story-blueprint/common';
import {
  compileProject,
  compileStory,
  type ProjectCompilerDiagnostic,
} from '@story-blueprint/compiler';
import {
  fromSourceGraph,
  applyAIProposalPositions,
  applyBlueprintLayoutRequests,
  extractSelectionToSubstory as extractGraphSelection,
  mergeDialogueNodes as mergeGraphDialogues,
  prepareAIGraphChanges,
  splitDialogueLines as splitGraphDialogueLines,
  toEditorGraphNode,
  toSourceGraph,
  type EditorGraphEdge,
  type EditorGraphNode,
  type EditorGraphState,
} from './editorGraph';
import { useGraphHistory } from './useGraphHistory';
import { buildStoryMergePreview, type StoryMergePreview } from './storyMergePreview';
import type { StoryMergeChoice, StoryMergeConflict, StoryMergeDecisions } from './storyMerge';
import type {
  ApplyWorkspaceMergeFile,
  OpenStoryResult,
  RecentProject,
  WorkspaceInfo,
} from '../../shared/electronApi';

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
    case StoryNodeType.Dialogue: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
      return {
        ...node,
        data: {
          ...node.data,
          lines: data.lines.map((line) => ({
            ...line,
            text: {
              source: renameTemplateIdentifier(line.text.source, oldName, newName),
            },
          })),
        },
      };
    }
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

function createNewSubstoryGraph(): EditorGraphState {
  const entry = NodeFactory.create(
    NodeFactory.generateId(StoryNodeType.Start),
    StoryNodeType.Start,
    {
      x: 120,
      y: 120,
    },
  );
  const returnNode = NodeFactory.create(
    NodeFactory.generateId(StoryNodeType.Return),
    StoryNodeType.Return,
    { x: 460, y: 120 },
  );
  if (!entry || !returnNode) return { nodes: [], edges: [] };
  entry.data = { title: 'Substory Entry' };
  return {
    nodes: [
      { ...toEditorGraphNode(entry), selected: true },
      { ...toEditorGraphNode(returnNode), selected: false },
    ],
    edges: [
      {
        id: createStableId('edge'),
        source: entry.id,
        sourceHandle: 'out',
        target: returnNode.id,
        targetHandle: 'in',
      },
    ],
  };
}

export interface StoryDocumentInfo {
  id: StoryId;
  name: string;
  displayName: string;
  filePath?: string;
  fileToken?: string;
  dirty: boolean;
  error?: string;
  gitConflict?: boolean;
}

export interface EditorChapter extends Omit<ChapterSource, 'graph'> {
  graph: EditorGraphState;
}

export interface EditorStoryResource {
  document: StoryDocumentInfo;
  chapters: EditorChapter[];
}

interface EditorStoryWorkspaceItem extends EditorStoryResource {
  rootGraph: EditorGraphState;
  variables: VariableDefinition[];
  characters: CharacterSource[];
  assets: AssetSource[];
  revision: number;
}

export type StoryDataSelection =
  | { kind: 'event-table' }
  | { kind: 'variable'; id: VariableId }
  | { kind: 'character'; id: CharacterId }
  | { kind: 'asset'; id: AssetId }
  | { kind: 'event'; id: EventId }
  | { kind: 'signal'; id: SignalId };

function collectOpenResourceUsage(items: readonly EditorStoryWorkspaceItem[]) {
  const characterIds = new Set<CharacterId>();
  const assetIds = new Set<AssetId>();
  for (const story of items) {
    const graphs = [story.rootGraph, ...story.chapters.map((chapter) => chapter.graph)];
    for (const candidate of graphs.flatMap((candidate) => candidate.nodes)) {
      if (candidate.type !== StoryNodeType.Dialogue) continue;
      const dialogue = candidate.data as DialogueNodeData;
      for (const line of dialogue.lines) {
        if (line.speakerId) characterIds.add(line.speakerId);
        if (line.voiceId) assetIds.add(line.voiceId);
      }
    }
    for (const character of story.characters) {
      if (character.defaultPortraitId) assetIds.add(character.defaultPortraitId);
      for (const emotion of Object.values(character.emotions)) {
        if (emotion.portraitId) assetIds.add(emotion.portraitId);
      }
    }
  }
  return { characterIds, assetIds };
}

export type ActiveGraphId = 'root' | ChapterId;

interface EditorHistoryState {
  activeGraphId: ActiveGraphId;
  graph: EditorGraphState;
  rootGraph: EditorGraphState;
  chapters: EditorChapter[];
  variables: VariableDefinition[];
}

interface AIEditorChanges {
  nonce: number;
  addedNodeIds: NodeId[];
  changedNodeIds: NodeId[];
  removedNodeIds: NodeId[];
  layoutNodeIds: NodeId[];
  variableChangeCount: number;
}

interface AIEditorProposal extends AIEditorChanges {
  graph: EditorGraphState;
  transaction: unknown;
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
  stories: EditorStoryResource[];
  hasActiveStory: boolean;
  activeStoryId?: StoryId;
  workspace?: WorkspaceInfo;
  workspaceError?: string;
  recentProjects: RecentProject[];
  problems: readonly ProjectCompilerDiagnostic[];
  lastBuildPath?: string;
  problemFocus?: { nodeId: NodeId; nonce: number };
  aiChanges?: AIEditorChanges;
  clearAIChanges: () => void;
  aiProposal?: AIEditorProposal;
  updateAIProposalNodes: OnNodesChange<EditorGraphNode>;
  applyAIProposal: () => BlueprintTransactionResult | undefined;
  discardAIProposal: () => void;
  storyMergePreview?: StoryMergePreview;
  storyMergePreviewGraphId?: ActiveGraphId;
  storyMergeDecisionRequest?: { id: string; choice: StoryMergeChoice; nonce: number };
  showStoryMergePreview: (
    merged: StorySourceDocument,
    conflicts: readonly StoryMergeConflict[],
    decisions: StoryMergeDecisions,
  ) => void;
  clearStoryMergePreview: () => void;
  setStoryMergePreviewGraph: (graphId: ActiveGraphId) => void;
  chooseStoryMergePreviewConflict: (id: string, choice: StoryMergeChoice) => void;
  focusStoryMergePreviewNode: (graphId: ActiveGraphId, nodeId: NodeId) => boolean;
  variables: VariableDefinition[];
  characters: CharacterSource[];
  assets: AssetSource[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  semanticSnapshot: StorySemanticSnapshot;
  executeBlueprintCommands: (
    transaction: unknown,
    options?: { dryRun?: boolean; stage?: boolean },
  ) => BlueprintTransactionResult;
  storyDataSelection?: StoryDataSelection;
  selectStoryData: (selection?: StoryDataSelection) => void;
  chapters: EditorChapter[];
  activeGraphId: ActiveGraphId;
  switchGraph: (id: ActiveGraphId) => void;
  focusGraphNode: (graphId: ActiveGraphId, nodeId: NodeId) => boolean;
  addSubstory: () => ChapterId;
  updateSubstory: (id: ChapterId, update: { name?: string; displayName?: string }) => void;
  removeSubstory: (id: ChapterId) => string | undefined;
  extractSelectionToSubstory: () =>
    { ok: true; chapterId: ChapterId } | { ok: false; message: string };
  mergeSelectedDialogues: () => { ok: true } | { ok: false; message: string };
  splitDialogueLines: (
    nodeId: NodeId,
    lineIds: readonly DialogueLineId[],
  ) => { ok: true } | { ok: false; message: string };
  applyStoryMerge: (
    merged: StorySourceDocument,
    gitConflictRevision?: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  validateStoryMerge: (
    merged: StorySourceDocument,
  ) => { ok: true } | { ok: false; message: string };
  validateWorkspaceMerge: (
    files: ApplyWorkspaceMergeFile[],
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  applyWorkspaceMerge: (
    files: ApplyWorkspaceMergeFile[],
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  addVariable: () => VariableId;
  updateVariable: (id: VariableId, update: Partial<VariableDefinition>) => void;
  removeVariable: (id: VariableId) => void;
  addCharacter: () => CharacterId;
  updateCharacter: (id: CharacterId, update: Partial<CharacterSource>) => void;
  removeCharacter: (id: CharacterId) => void;
  addAsset: () => AssetId;
  updateAsset: (id: AssetId, update: Partial<AssetSource>) => void;
  removeAsset: (id: AssetId) => void;
  addEvent: () => EventId | undefined;
  updateEvent: (id: EventId, update: Partial<EventSource>) => void;
  removeEvent: (id: EventId) => void;
  addSignal: () => SignalId | undefined;
  updateSignal: (id: SignalId, update: Partial<SignalSource>) => void;
  removeSignal: (id: SignalId) => void;
  markDirty: () => void;
  newStory: () => void;
  openStory: () => Promise<void>;
  saveStory: (saveAs?: boolean, sourceOverride?: StorySourceDocument) => Promise<void>;
  saveAllStories: () => Promise<void>;
  switchStory: (id: StoryId, graphId?: ActiveGraphId) => void;
  closeStory: (id: StoryId) => Promise<void>;
  revealStoryFile: (id: StoryId) => Promise<void>;
  deleteStoryFile: (id: StoryId) => Promise<void>;
  updateStory: (update: { name?: string; displayName?: string }) => void;
  openWorkspace: () => Promise<void>;
  openProject: () => Promise<void>;
  openRecentProject: (filePath: string) => Promise<void>;
  removeRecentProject: (filePath: string) => Promise<void>;
  newProject: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  initializeWorkspaceGit: () => Promise<void>;
  revealWorkspaceItem: (relativePath: string) => Promise<void>;
  deleteWorkspaceStory: (relativePath: string) => Promise<void>;
  deleteWorkspaceProject: (relativePath: string) => Promise<void>;
  openWorkspaceStory: (relativePath: string) => Promise<void>;
  createWorkspaceDirectory: (parent: string, name: string) => Promise<void>;
  createWorkspaceStory: (directory: string, displayName: string) => Promise<void>;
  createWorkspaceProject: (displayName: string) => Promise<void>;
  syncWorkspaceProject: () => Promise<void>;
  buildProject: () => Promise<void>;
  focusProblem: (problem: ProjectCompilerDiagnostic) => Promise<void>;
  updateProjectSettings: (settings: {
    entryStoryId?: StoryId;
    outputDirectory?: string;
  }) => Promise<void>;
}

const StoryGraphStoreContext = createContext<StoryGraphStoreValue | null>(null);

export function StoryGraphStoreProvider({ children }: PropsWithChildren) {
  const initialGraph = useMemo<EditorGraphState>(() => ({ nodes: [], edges: [] }), []);
  const initialDocument = useMemo<StoryDocumentInfo>(
    () => ({
      id: createStableId('story'),
      name: 'no-story',
      displayName: 'No Story Open',
      dirty: false,
    }),
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorGraphNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorGraphEdge>(initialGraph.edges);
  const graph = useMemo<EditorGraphState>(() => ({ nodes, edges }), [edges, nodes]);
  const history = useGraphHistory<EditorHistoryState>();
  const [variables, setVariables] = useState<VariableDefinition[]>([]);
  const [characters, setCharacters] = useState<CharacterSource[]>([]);
  const [assets, setAssets] = useState<AssetSource[]>([]);
  const rootGraphRef = useRef<EditorGraphState>(structuredClone(initialGraph));
  const [chapters, setChapters] = useState<EditorChapter[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<ActiveGraphId>('root');
  const revisionRef = useRef(0);
  const [document, setDocument] = useState<StoryDocumentInfo>(initialDocument);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const events = workspace?.project?.events ?? [];
  const signals = workspace?.project?.signals ?? [];
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [problems, setProblems] = useState<readonly ProjectCompilerDiagnostic[]>([]);
  const [lastBuildPath, setLastBuildPath] = useState<string>();
  const [problemFocus, setProblemFocus] = useState<{ nodeId: NodeId; nonce: number }>();
  const [aiChanges, setAIChanges] = useState<AIEditorChanges>();
  const [aiProposal, setAIProposal] = useState<AIEditorProposal>();
  const [storyMergePreview, setStoryMergePreview] = useState<StoryMergePreview>();
  const [storyMergePreviewGraphId, setStoryMergePreviewGraphIdState] = useState<ActiveGraphId>();
  const [storyMergeDecisionRequest, setStoryMergeDecisionRequest] = useState<{
    id: string;
    choice: StoryMergeChoice;
    nonce: number;
  }>();
  const [workspaceStories, setWorkspaceStories] = useState<EditorStoryWorkspaceItem[]>([]);
  const [storyDataSelection, setStoryDataSelection] = useState<StoryDataSelection>();
  const [sessionReady, setSessionReady] = useState(false);
  const restoredSessionRef = useRef(false);
  const projectResourceWritesRef = useRef(new Map<string, Promise<WorkspaceInfo>>());
  const currentStoryItemsRef = useRef<() => EditorStoryWorkspaceItem[]>(() => []);
  const [projectResourcesDirty, setProjectResourcesDirty] = useState(false);
  const source = useMemo<StorySourceDocument>(
    () => ({
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: document.id,
      name: document.name,
      displayName: document.displayName,
      root: toSourceGraph(activeGraphId === 'root' ? graph : rootGraphRef.current),
      chapters: chapters.map((chapter) => ({
        ...chapter,
        graph: toSourceGraph(activeGraphId === chapter.id ? graph : chapter.graph),
      })),
      variables,
      characters,
      assets,
      events: [],
    }),
    [
      activeGraphId,
      assets,
      chapters,
      characters,
      document.displayName,
      document.id,
      document.name,
      graph,
      variables,
    ],
  );
  const resolvedCharacters = useMemo(() => {
    const external = workspace?.characterResources.map((resource) => resource.character) ?? [];
    const externalIds = new Set(external.map((character) => character.id));
    return [...external, ...characters.filter((character) => !externalIds.has(character.id))];
  }, [characters, workspace?.characterResources]);
  const resolvedAssets = useMemo(() => {
    const external = workspace?.assetResources.map((resource) => resource.asset) ?? [];
    const externalIds = new Set(external.map((asset) => asset.id));
    return [...external, ...assets.filter((asset) => !externalIds.has(asset.id))];
  }, [assets, workspace?.assetResources]);
  const aiSemanticContext = useMemo(
    () => ({
      characters: resolvedCharacters,
      assets: resolvedAssets,
      events,
      signals,
    }),
    [events, resolvedAssets, resolvedCharacters, signals],
  );
  const semanticSnapshot = useMemo(
    () => createStorySemanticSnapshot({ ...source, ...aiSemanticContext }),
    [aiSemanticContext, source],
  );

  const markDirty = useCallback(() => {
    if (!hasActiveStory) return;
    revisionRef.current += 1;
    window.electronAPI?.setStoryDirty(true);
    setDocument((current) => ({ ...current, dirty: true, error: undefined }));
  }, [hasActiveStory]);

  const stories = useMemo<EditorStoryResource[]>(
    () =>
      workspaceStories.map((story) =>
        hasActiveStory && story.document.id === document.id ? { document, chapters } : story,
      ),
    [chapters, document, hasActiveStory, workspaceStories],
  );

  useEffect(() => {
    window.electronAPI?.setStoryDirty(
      projectResourcesDirty ||
        (hasActiveStory && document.dirty) ||
        workspaceStories.some((story) => story.document.dirty),
    );
  }, [document.dirty, hasActiveStory, projectResourcesDirty, workspaceStories]);

  const queueProjectResourceWrite = useCallback((write: () => Promise<WorkspaceInfo>) => {
    const key = 'project-resources';
    const previous = projectResourceWritesRef.current.get(key);
    const operation = (previous ?? Promise.resolve(undefined)).catch(() => undefined).then(write);
    projectResourceWritesRef.current.set(key, operation);
    setProjectResourcesDirty(true);
    void operation
      .then((nextWorkspace) => {
        if (projectResourceWritesRef.current.get(key) !== operation) return;
        projectResourceWritesRef.current.delete(key);
        setWorkspace(nextWorkspace);
        setWorkspaceError(undefined);
        setProjectResourcesDirty(projectResourceWritesRef.current.size > 0);
      })
      .catch((error: unknown) => {
        if (projectResourceWritesRef.current.get(key) === operation) {
          projectResourceWritesRef.current.delete(key);
          setProjectResourcesDirty(projectResourceWritesRef.current.size > 0);
        }
        setWorkspaceError(error instanceof Error ? error.message : String(error));
        void window.electronAPI
          ?.refreshWorkspace()
          .then(setWorkspace)
          .catch(() => undefined);
      });
  }, []);

  const selectStoryData = useCallback(
    (selection?: StoryDataSelection) => {
      setStoryDataSelection(selection);
      if (!selection) return;
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    },
    [setEdges, setNodes],
  );

  useEffect(() => {
    void window.electronAPI
      ?.getRecentProjects()
      .then(setRecentProjects)
      .catch(() => setRecentProjects([]));
  }, []);

  const checkpoint = useCallback(
    (snapshot?: EditorGraphState) => {
      setAIChanges(undefined);
      setAIProposal(undefined);
      history.checkpoint({
        activeGraphId,
        graph: snapshot ?? graph,
        rootGraph: rootGraphRef.current,
        chapters,
        variables,
      });
    },
    [activeGraphId, chapters, graph, history, variables],
  );

  useEffect(() => {
    setAIChanges(undefined);
    setAIProposal(undefined);
  }, [activeGraphId, document.id]);

  const restoreGraph = useCallback(
    (next: EditorGraphState) => {
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [setEdges, setNodes],
  );

  const switchGraph = useCallback(
    (id: ActiveGraphId) => {
      if (id === activeGraphId) return;
      const target =
        id === 'root' ? rootGraphRef.current : chapters.find((item) => item.id === id)?.graph;
      if (!target) return;
      if (activeGraphId === 'root') {
        rootGraphRef.current = structuredClone(graph);
      } else {
        setChapters((current) =>
          current.map((chapter) =>
            chapter.id === activeGraphId ? { ...chapter, graph: structuredClone(graph) } : chapter,
          ),
        );
      }
      setActiveGraphId(id);
      restoreGraph(structuredClone(target));
      history.clear();
    },
    [activeGraphId, chapters, graph, history, restoreGraph],
  );

  const focusGraphNode = useCallback(
    (graphId: ActiveGraphId, nodeId: NodeId): boolean => {
      const target =
        graphId === activeGraphId
          ? graph
          : graphId === 'root'
            ? rootGraphRef.current
            : chapters.find((chapter) => chapter.id === graphId)?.graph;
      if (!target?.nodes.some((node) => node.id === nodeId)) return false;
      const focused: EditorGraphState = {
        nodes: target.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
        edges: target.edges.map((edge) => ({ ...edge, selected: false })),
      };
      if (graphId !== activeGraphId) switchGraph(graphId);
      restoreGraph(focused);
      setStoryDataSelection(undefined);
      setProblemFocus({ nodeId, nonce: Date.now() });
      return true;
    },
    [activeGraphId, chapters, graph, restoreGraph, switchGraph],
  );

  const showStoryMergePreview = useCallback(
    (
      merged: StorySourceDocument,
      conflicts: readonly StoryMergeConflict[],
      decisions: StoryMergeDecisions,
    ) => {
      const preview = buildStoryMergePreview(source, merged, conflicts, decisions);
      setStoryMergePreview(preview);
      setStoryMergePreviewGraphIdState((current) =>
        current && preview.graphs.some((graph) => graph.id === current) ? current : activeGraphId,
      );
    },
    [activeGraphId, source],
  );

  const clearStoryMergePreview = useCallback(() => {
    setStoryMergePreview(undefined);
    setStoryMergePreviewGraphIdState(undefined);
    setStoryMergeDecisionRequest(undefined);
  }, []);

  const setStoryMergePreviewGraph = useCallback(
    (graphId: ActiveGraphId) => {
      if (!storyMergePreview?.graphs.some((graph) => graph.id === graphId)) return;
      setStoryMergePreviewGraphIdState(graphId);
      const isLocalGraph = graphId === 'root' || chapters.some((chapter) => chapter.id === graphId);
      if (isLocalGraph && graphId !== activeGraphId) switchGraph(graphId);
    },
    [activeGraphId, chapters, storyMergePreview, switchGraph],
  );

  const chooseStoryMergePreviewConflict = useCallback((id: string, choice: StoryMergeChoice) => {
    setStoryMergeDecisionRequest({ id, choice, nonce: Date.now() });
  }, []);

  const focusStoryMergePreviewNode = useCallback(
    (graphId: ActiveGraphId, nodeId: NodeId): boolean => {
      const previewGraph = storyMergePreview?.graphs.find((candidate) => candidate.id === graphId);
      if (!previewGraph?.graph.nodes.some((node) => node.id === nodeId)) return false;
      setStoryMergePreviewGraph(graphId);
      setStoryDataSelection(undefined);
      setProblemFocus({ nodeId, nonce: Date.now() });
      return true;
    },
    [setStoryMergePreviewGraph, storyMergePreview],
  );

  useEffect(() => clearStoryMergePreview(), [clearStoryMergePreview, document.id]);

  const updateInactiveGraphs = useCallback(
    (transform: (graph: EditorGraphState) => EditorGraphState) => {
      if (activeGraphId !== 'root') rootGraphRef.current = transform(rootGraphRef.current);
      setChapters((current) =>
        current.map((chapter) =>
          chapter.id === activeGraphId ? chapter : { ...chapter, graph: transform(chapter.graph) },
        ),
      );
    },
    [activeGraphId],
  );

  const undo = useCallback(() => {
    const previous = history.undo({
      activeGraphId,
      graph,
      rootGraph: rootGraphRef.current,
      chapters,
      variables,
    });
    if (previous) {
      setActiveGraphId(previous.activeGraphId);
      rootGraphRef.current = previous.rootGraph;
      setChapters(previous.chapters);
      restoreGraph(previous.graph);
      setVariables(previous.variables);
      setAIChanges(undefined);
      setAIProposal(undefined);
      markDirty();
    }
  }, [activeGraphId, chapters, graph, history, markDirty, restoreGraph, variables]);

  const redo = useCallback(() => {
    const next = history.redo({
      activeGraphId,
      graph,
      rootGraph: rootGraphRef.current,
      chapters,
      variables,
    });
    if (next) {
      setActiveGraphId(next.activeGraphId);
      rootGraphRef.current = next.rootGraph;
      setChapters(next.chapters);
      restoreGraph(next.graph);
      setVariables(next.variables);
      setAIChanges(undefined);
      setAIProposal(undefined);
      markDirty();
    }
  }, [activeGraphId, chapters, graph, history, markDirty, restoreGraph, variables]);

  const clearAIChanges = useCallback(() => setAIChanges(undefined), []);
  const discardAIProposal = useCallback(() => setAIProposal(undefined), []);
  const updateAIProposalNodes = useCallback<OnNodesChange<EditorGraphNode>>((changes) => {
    const allowed = changes.filter(
      (change) =>
        change.type === 'position' || change.type === 'dimensions' || change.type === 'select',
    );
    if (allowed.length === 0) return;
    setAIProposal((current) =>
      current
        ? {
            ...current,
            graph: { ...current.graph, nodes: applyNodeChanges(allowed, current.graph.nodes) },
          }
        : current,
    );
  }, []);

  const executeBlueprintCommands = useCallback(
    (
      transactionValue: unknown,
      options: { dryRun?: boolean; stage?: boolean } = {},
    ): BlueprintTransactionResult => {
      if (options.stage) setAIProposal(undefined);
      if (
        (!options.dryRun || options.stage) &&
        typeof transactionValue === 'object' &&
        transactionValue !== null
      ) {
        const operations = (transactionValue as Partial<BlueprintCommandTransaction>).operations;
        if (
          Array.isArray(operations) &&
          operations.some((operation) => {
            if (
              typeof operation !== 'object' ||
              operation === null ||
              !('graph' in operation) ||
              typeof operation.graph !== 'object' ||
              operation.graph === null ||
              !('kind' in operation.graph)
            ) {
              return false;
            }
            const target = operation.graph;
            return activeGraphId === 'root'
              ? target.kind !== 'root'
              : target.kind !== 'chapter' ||
                  !('chapterId' in target) ||
                  target.chapterId !== activeGraphId;
          })
        ) {
          return {
            ok: false,
            committed: false,
            document: source,
            diagnostics: [
              {
                code: 'INVALID_TRANSACTION',
                message:
                  'Editor commits currently require every operation to target the active graph',
              },
            ],
          };
        }
      }
      const result = executeBlueprintCommandTransaction(source, transactionValue, {
        dryRun: options.dryRun,
        semanticContext: aiSemanticContext,
      });
      if (!result.ok) return result;
      const compiled = compileStory({
        ...result.document,
        characters: resolvedCharacters,
        assets: resolvedAssets,
        events,
        signals,
      });
      const compileErrors = compiled.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (compileErrors.length > 0) {
        return {
          ok: false,
          committed: false,
          document: source,
          diagnostics: compileErrors.map((diagnostic) => ({
            code: 'INVALID_GRAPH' as const,
            message: diagnostic.message,
            path: diagnostic.path,
          })),
        };
      }
      const nextSourceGraph =
        activeGraphId === 'root'
          ? result.document.root
          : result.document.chapters.find((chapter) => chapter.id === activeGraphId)?.graph;
      if (!nextSourceGraph) {
        return {
          ok: false,
          committed: false,
          document: source,
          diagnostics: [{ code: 'UNKNOWN_GRAPH', message: 'Active graph no longer exists' }],
        };
      }
      const proposalGraph = applyBlueprintLayoutRequests(
        fromSourceGraph(nextSourceGraph),
        result.layoutRequests,
      );
      const prepared = prepareAIGraphChanges(graph, proposalGraph);
      const movedNodeIds = proposalGraph.nodes
        .filter((node) => {
          const before = graph.nodes.find((candidate) => candidate.id === node.id);
          return (
            before !== undefined &&
            (before.position.x !== node.position.x || before.position.y !== node.position.y)
          );
        })
        .map((node) => node.id);
      const changedNodeIds = [...new Set([...prepared.changedNodeIds, ...movedNodeIds])];
      const beforeVariables = new Map(source.variables.map((variable) => [variable.id, variable]));
      const afterVariables = new Map(
        result.document.variables.map((variable) => [variable.id, variable]),
      );
      const variableIds = new Set([...beforeVariables.keys(), ...afterVariables.keys()]);
      const variableChangeCount = [...variableIds].filter(
        (id) => JSON.stringify(beforeVariables.get(id)) !== JSON.stringify(afterVariables.get(id)),
      ).length;
      if (options.stage) {
        setAIChanges(undefined);
        setAIProposal({
          nonce: Date.now(),
          graph: {
            nodes: prepared.graph.nodes.map((node) => ({ ...node, selected: false })),
            edges: prepared.graph.edges.map((edge) => ({ ...edge, selected: false })),
          },
          transaction: structuredClone(transactionValue),
          addedNodeIds: prepared.addedNodeIds,
          changedNodeIds,
          removedNodeIds: prepared.removedNodeIds,
          layoutNodeIds: movedNodeIds,
          variableChangeCount,
        });
        return result;
      }
      if (!result.committed) return result;
      const stagedProposal =
        aiProposal && JSON.stringify(aiProposal.transaction) === JSON.stringify(transactionValue)
          ? aiProposal
          : undefined;
      const committedGraph = stagedProposal
        ? applyAIProposalPositions(prepared.graph, stagedProposal.graph)
        : prepared.graph;
      checkpoint();
      restoreGraph(committedGraph);
      setVariables([...structuredClone(result.document.variables)]);
      setAIProposal(undefined);
      setAIChanges(
        stagedProposal
          ? undefined
          : {
              nonce: Date.now(),
              addedNodeIds: prepared.addedNodeIds,
              changedNodeIds,
              removedNodeIds: prepared.removedNodeIds,
              layoutNodeIds: movedNodeIds,
              variableChangeCount,
            },
      );
      markDirty();
      return result;
    },
    [
      activeGraphId,
      aiProposal,
      aiSemanticContext,
      checkpoint,
      events,
      graph,
      markDirty,
      resolvedAssets,
      resolvedCharacters,
      restoreGraph,
      signals,
      source,
    ],
  );

  const applyAIProposal = useCallback(
    () => (aiProposal ? executeBlueprintCommands(aiProposal.transaction) : undefined),
    [aiProposal, executeBlueprintCommands],
  );

  const addNode = useCallback(
    (
      type: StoryNodeType,
      position: XYPosition,
      initialData?: Partial<StoryNodeDataMap[StoryNodeType]>,
    ): NodeId | null => {
      if (type === StoryNodeType.Start && nodes.some((node) => node.type === type)) return null;
      if (type === StoryNodeType.Return && activeGraphId === 'root') return null;
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
    [activeGraphId, checkpoint, markDirty, nodes, setEdges, setNodes],
  );

  const nextSubstoryIdentity = useCallback(() => {
    const used = new Set(chapters.map((chapter) => chapter.name));
    let index = chapters.length + 1;
    let name = `substory${index}`;
    while (used.has(name)) name = `substory${++index}`;
    return { name, displayName: `Substory ${index}` };
  }, [chapters]);

  const addSubstory = useCallback((): ChapterId => {
    const id = createStableId('chapter');
    const identity = nextSubstoryIdentity();
    const chapter: EditorChapter = {
      id,
      ...identity,
      parameters: [],
      localVariables: [],
      graph: createNewSubstoryGraph(),
    };
    if (activeGraphId === 'root') rootGraphRef.current = structuredClone(graph);
    setChapters((current) => [
      ...current.map((item) =>
        item.id === activeGraphId ? { ...item, graph: structuredClone(graph) } : item,
      ),
      chapter,
    ]);
    setActiveGraphId(id);
    restoreGraph(structuredClone(chapter.graph));
    history.clear();
    markDirty();
    return id;
  }, [activeGraphId, graph, history, markDirty, nextSubstoryIdentity, restoreGraph]);

  const updateSubstory = useCallback(
    (id: ChapterId, update: { name?: string; displayName?: string }) => {
      setChapters((current) =>
        current.map((chapter) => (chapter.id === id ? { ...chapter, ...update, id } : chapter)),
      );
      markDirty();
    },
    [markDirty],
  );

  const removeSubstory = useCallback(
    (id: ChapterId): string | undefined => {
      const allGraphs = [
        activeGraphId === 'root' ? graph : rootGraphRef.current,
        ...chapters
          .filter((chapter) => chapter.id !== id)
          .map((chapter) => (activeGraphId === chapter.id ? graph : chapter.graph)),
      ];
      const referenced = allGraphs.some((candidate) =>
        candidate.nodes.some(
          (node) => node.type === StoryNodeType.CallSubstory && node.data.chapterId === id,
        ),
      );
      if (referenced) return 'Remove Call Substory nodes that reference this substory first.';
      if (activeGraphId === id) {
        setActiveGraphId('root');
        restoreGraph(structuredClone(rootGraphRef.current));
        history.clear();
      }
      setChapters((current) => current.filter((chapter) => chapter.id !== id));
      markDirty();
      return undefined;
    },
    [activeGraphId, chapters, graph, history, markDirty, restoreGraph],
  );

  const extractSelectionToSubstory = useCallback(():
    { ok: true; chapterId: ChapterId } | { ok: false; message: string } => {
    const id = createStableId('chapter');
    const extracted = extractGraphSelection(graph, id);
    if (!extracted.ok) return extracted;
    const identity = nextSubstoryIdentity();
    checkpoint();
    restoreGraph(extracted.remainingGraph);
    setChapters((current) => [
      ...current.map((chapter) =>
        chapter.id === activeGraphId
          ? { ...chapter, graph: structuredClone(extracted.remainingGraph) }
          : chapter,
      ),
      {
        id,
        ...identity,
        parameters: [],
        localVariables: [],
        graph: extracted.chapterGraph,
      },
    ]);
    if (activeGraphId === 'root') {
      rootGraphRef.current = structuredClone(extracted.remainingGraph);
    }
    markDirty();
    return { ok: true, chapterId: id };
  }, [activeGraphId, checkpoint, graph, markDirty, nextSubstoryIdentity, restoreGraph]);

  const mergeSelectedDialogues = useCallback((): { ok: true } | { ok: false; message: string } => {
    const result = mergeGraphDialogues(
      graph,
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    if (!result.ok) return result;
    checkpoint();
    restoreGraph(result.graph);
    markDirty();
    return { ok: true };
  }, [checkpoint, graph, markDirty, nodes, restoreGraph]);

  const splitDialogueLines = useCallback(
    (
      nodeId: NodeId,
      lineIds: readonly DialogueLineId[],
    ): { ok: true } | { ok: false; message: string } => {
      const result = splitGraphDialogueLines(graph, nodeId, lineIds);
      if (!result.ok) return result;
      checkpoint();
      restoreGraph(result.graph);
      markDirty();
      return { ok: true };
    },
    [checkpoint, graph, markDirty, restoreGraph],
  );

  const validateStoryMerge = useCallback(
    (merged: StorySourceDocument): { ok: true } | { ok: false; message: string } => {
      if (merged.id !== source.id) {
        return { ok: false, message: 'The merge result belongs to a different Story.' };
      }
      try {
        fromSourceGraph(merged.root);
        for (const chapter of merged.chapters) fromSourceGraph(chapter.graph);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      const compiled = compileStory({
        ...merged,
        characters: resolvedCharacters,
        assets: resolvedAssets,
        events,
        signals,
      });
      const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (errors.length > 0) {
        return {
          ok: false,
          message: errors.map((diagnostic) => diagnostic.message).join('\n'),
        };
      }
      return { ok: true };
    },
    [events, resolvedAssets, resolvedCharacters, signals, source.id],
  );

  const applyStoryMerge = useCallback(
    async (
      merged: StorySourceDocument,
      gitConflictRevision?: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const validation = validateStoryMerge(merged);
      if (!validation.ok) return validation;
      const nextRoot = fromSourceGraph(merged.root);
      const nextChapters: EditorChapter[] = merged.chapters.map((chapter) => ({
        ...structuredClone(chapter),
        graph: fromSourceGraph(chapter.graph),
      }));
      const nextActiveGraphId =
        activeGraphId !== 'root' && nextChapters.some((chapter) => chapter.id === activeGraphId)
          ? activeGraphId
          : 'root';
      const nextGraph =
        nextActiveGraphId === 'root'
          ? nextRoot
          : nextChapters.find((chapter) => chapter.id === nextActiveGraphId)!.graph;
      if (!window.electronAPI) {
        return { ok: false, message: 'Story saving is unavailable outside Electron.' };
      }
      let saved: Awaited<ReturnType<typeof window.electronAPI.saveStory>>;
      try {
        saved = await window.electronAPI.saveStory({
          filePath: document.filePath,
          fileToken: document.fileToken,
          content: serializeStorySource(merged),
          gitConflictRevision,
        });
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      if (saved.canceled) return { ok: false, message: 'Merge save was canceled.' };
      checkpoint();
      rootGraphRef.current = structuredClone(nextRoot);
      setChapters(nextChapters);
      setActiveGraphId(nextActiveGraphId);
      restoreGraph(structuredClone(nextGraph));
      setVariables([...structuredClone(merged.variables)]);
      revisionRef.current += 1;
      window.electronAPI.setStoryDirty(false);
      setDocument((current) => ({
        ...current,
        filePath: saved.filePath,
        fileToken: saved.fileToken,
        dirty: false,
        error: undefined,
        gitConflict: false,
      }));
      return { ok: true };
    },
    [
      activeGraphId,
      checkpoint,
      document.filePath,
      document.fileToken,
      resolvedAssets,
      resolvedCharacters,
      restoreGraph,
      source.id,
      validateStoryMerge,
    ],
  );

  const addVariable = useCallback((): VariableId => {
    const id = createStableId('variable');
    checkpoint();
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
  }, [checkpoint, markDirty]);

  const updateVariable = useCallback(
    (id: VariableId, update: Partial<VariableDefinition>) => {
      checkpoint();
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const previous = variables.find((variable) => variable.id === id);
      if (previous && nextUpdate.name && nextUpdate.name !== previous.name) {
        setNodes((current) =>
          current.map((node) => renameVariableInNode(node, previous.name, nextUpdate.name!)),
        );
        updateInactiveGraphs((candidate) => ({
          ...candidate,
          nodes: candidate.nodes.map((node) =>
            renameVariableInNode(node, previous.name, nextUpdate.name!),
          ),
        }));
      }
      setVariables((current) =>
        current.map((variable) =>
          variable.id === id ? { ...variable, ...nextUpdate, id } : variable,
        ),
      );
      markDirty();
    },
    [checkpoint, markDirty, setNodes, updateInactiveGraphs, variables],
  );

  const removeVariable = useCallback(
    (id: VariableId) => {
      checkpoint();
      setStoryDataSelection((current) =>
        current?.kind === 'variable' && current.id === id ? undefined : current,
      );
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
      updateInactiveGraphs((candidate) => ({
        ...candidate,
        nodes: candidate.nodes.map((node) => {
          if (
            (node.type === StoryNodeType.GetVariable || node.type === StoryNodeType.SetVariable) &&
            node.data.variableId === id
          ) {
            return { ...node, data: { ...node.data, variableId: undefined } };
          }
          return node;
        }),
      }));
      markDirty();
    },
    [checkpoint, markDirty, setNodes, updateInactiveGraphs],
  );

  const addCharacter = useCallback((): CharacterId => {
    const id = createStableId('character');
    const index = resolvedCharacters.length + 1;
    const character: CharacterSource = {
      id,
      name: `character${index}`,
      displayName: `Character ${index}`,
      emotions: { neutral: { displayName: 'Neutral' } },
    };
    if (workspace?.project && window.electronAPI) {
      queueProjectResourceWrite(() => window.electronAPI!.createProjectCharacter(character));
      return id;
    }
    setCharacters((current) => {
      return [...current, character];
    });
    markDirty();
    return id;
  }, [markDirty, queueProjectResourceWrite, resolvedCharacters.length, workspace?.project]);

  const updateCharacter = useCallback(
    (id: CharacterId, update: Partial<CharacterSource>) => {
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const resource = workspace?.characterResources.find(
        (candidate) => candidate.character.id === id,
      );
      if (resource && window.electronAPI) {
        const character = { ...resource.character, ...nextUpdate, id };
        setWorkspace((current) =>
          current
            ? {
                ...current,
                characterResources: current.characterResources.map((candidate) =>
                  candidate.character.id === id ? { ...candidate, character } : candidate,
                ),
              }
            : current,
        );
        queueProjectResourceWrite(() =>
          window.electronAPI!.updateProjectCharacter(resource.relativePath, character),
        );
        return;
      }
      setCharacters((current) =>
        current.map((character) =>
          character.id === id ? { ...character, ...nextUpdate, id } : character,
        ),
      );
      markDirty();
    },
    [markDirty, queueProjectResourceWrite, workspace?.characterResources],
  );

  const removeCharacter = useCallback(
    (id: CharacterId) => {
      const resource = workspace?.characterResources.find(
        (candidate) => candidate.character.id === id,
      );
      if (resource && window.electronAPI) {
        if (collectOpenResourceUsage(currentStoryItemsRef.current()).characterIds.has(id)) {
          setWorkspaceError('Character is used by an open Story. Remove its references first.');
          return;
        }
        queueProjectResourceWrite(async () => {
          const result = await window.electronAPI!.deleteProjectCharacter(resource.relativePath);
          if (!result.canceled) {
            setStoryDataSelection((current) =>
              current?.kind === 'character' && current.id === id ? undefined : current,
            );
          }
          return result.workspace;
        });
        return;
      }
      const character = characters.find((candidate) => candidate.id === id);
      if (
        character &&
        !window.confirm(`Delete character "${character.displayName}"? This cannot be undone.`)
      ) {
        return;
      }
      setStoryDataSelection((current) =>
        current?.kind === 'character' && current.id === id ? undefined : current,
      );
      setCharacters((current) => current.filter((character) => character.id !== id));
      setNodes((current) =>
        current.map((node) =>
          node.type === StoryNodeType.Dialogue
            ? {
                ...node,
                data: {
                  ...node.data,
                  lines: (node.data as DialogueNodeData).lines.map((line) =>
                    line.speakerId === id ? { ...line, speakerId: undefined } : line,
                  ),
                },
              }
            : node,
        ),
      );
      updateInactiveGraphs((candidate) => ({
        ...candidate,
        nodes: candidate.nodes.map((node) =>
          node.type === StoryNodeType.Dialogue
            ? {
                ...node,
                data: {
                  ...node.data,
                  lines: (node.data as DialogueNodeData).lines.map((line) =>
                    line.speakerId === id ? { ...line, speakerId: undefined } : line,
                  ),
                },
              }
            : node,
        ),
      }));
      markDirty();
    },
    [
      markDirty,
      queueProjectResourceWrite,
      setNodes,
      updateInactiveGraphs,
      characters,
      workspace?.characterResources,
    ],
  );

  const addAsset = useCallback((): AssetId => {
    const id = createStableId('asset');
    const index = resolvedAssets.length + 1;
    const asset: AssetSource = {
      id,
      name: `voice${index}`,
      displayName: `Voice ${index}`,
      kind: 'audio',
      locales: { default: '' },
    };
    if (workspace?.project && window.electronAPI) {
      queueProjectResourceWrite(() => window.electronAPI!.createProjectAsset(asset));
      return id;
    }
    setAssets((current) => {
      return [...current, asset];
    });
    markDirty();
    return id;
  }, [markDirty, queueProjectResourceWrite, resolvedAssets.length, workspace?.project]);

  const updateAsset = useCallback(
    (id: AssetId, update: Partial<AssetSource>) => {
      const resource = workspace?.assetResources.find((candidate) => candidate.asset.id === id);
      if (resource && window.electronAPI) {
        const asset = { ...resource.asset, ...update, id };
        setWorkspace((current) =>
          current
            ? {
                ...current,
                assetResources: current.assetResources.map((candidate) =>
                  candidate.asset.id === id ? { ...candidate, asset } : candidate,
                ),
              }
            : current,
        );
        queueProjectResourceWrite(() =>
          window.electronAPI!.updateProjectAsset(resource.relativePath, asset),
        );
        return;
      }
      setAssets((current) =>
        current.map((asset) => (asset.id === id ? { ...asset, ...update, id } : asset)),
      );
      markDirty();
    },
    [markDirty, queueProjectResourceWrite, workspace?.assetResources],
  );

  const removeAsset = useCallback(
    (id: AssetId) => {
      const resource = workspace?.assetResources.find((candidate) => candidate.asset.id === id);
      if (resource && window.electronAPI) {
        if (collectOpenResourceUsage(currentStoryItemsRef.current()).assetIds.has(id)) {
          setWorkspaceError('Asset is used by an open Story. Remove its references first.');
          return;
        }
        setStoryDataSelection((current) =>
          current?.kind === 'asset' && current.id === id ? undefined : current,
        );
        queueProjectResourceWrite(() =>
          window.electronAPI!.deleteProjectAsset(resource.relativePath),
        );
        return;
      }
      setStoryDataSelection((current) =>
        current?.kind === 'asset' && current.id === id ? undefined : current,
      );
      setAssets((current) => current.filter((asset) => asset.id !== id));
      setNodes((current) =>
        current.map((node) =>
          node.type === StoryNodeType.Dialogue
            ? {
                ...node,
                data: {
                  ...node.data,
                  lines: (node.data as DialogueNodeData).lines.map((line) =>
                    line.voiceId === id ? { ...line, voiceId: undefined } : line,
                  ),
                },
              }
            : node,
        ),
      );
      updateInactiveGraphs((candidate) => ({
        ...candidate,
        nodes: candidate.nodes.map((node) =>
          node.type === StoryNodeType.Dialogue
            ? {
                ...node,
                data: {
                  ...node.data,
                  lines: (node.data as DialogueNodeData).lines.map((line) =>
                    line.voiceId === id ? { ...line, voiceId: undefined } : line,
                  ),
                },
              }
            : node,
        ),
      }));
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
    [
      markDirty,
      queueProjectResourceWrite,
      setNodes,
      updateInactiveGraphs,
      workspace?.assetResources,
    ],
  );

  const writeProjectEvents = useCallback(
    (nextEvents: readonly EventSource[]) => {
      if (!workspace?.project || !window.electronAPI) return;
      const project = workspace.project;
      setWorkspace((current) =>
        current?.project
          ? { ...current, project: { ...current.project, events: nextEvents } }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.updateProjectSettings({
          entryStoryId: project.entryStoryId,
          outputDirectory: project.outputDirectory,
          events: nextEvents,
        }),
      );
    },
    [queueProjectResourceWrite, workspace?.project],
  );

  const addEvent = useCallback((): EventId | undefined => {
    if (!workspace?.project) {
      setWorkspaceError('Open or create a Story project before adding events.');
      return undefined;
    }
    const id = createStableId('event');
    const used = new Set(events.map((event) => event.name));
    let index = events.length + 1;
    let name = `event${index}`;
    while (used.has(name)) name = `event${++index}`;
    writeProjectEvents([
      ...events,
      {
        id,
        name,
        displayName: name,
        parameters: [],
        resumable: true,
        sideEffect: 'write',
      },
    ]);
    return id;
  }, [events, workspace?.project, writeProjectEvents]);

  const updateEvent = useCallback(
    (id: EventId, update: Partial<EventSource>) => {
      const previous = events.find((event) => event.id === id);
      if (!previous) return;
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const nextEvent = { ...previous, ...nextUpdate, id };
      if (nextUpdate.parameters) {
        const renamed = new Map<string, string>();
        const previousNames = new Set(previous.parameters.map((parameter) => parameter.name));
        if (previous.parameters.length === nextEvent.parameters.length) {
          previous.parameters.forEach((parameter, index) => {
            const nextName = nextEvent.parameters[index]?.name;
            if (nextName && nextName !== parameter.name && !previousNames.has(nextName)) {
              renamed.set(parameter.name, nextName);
            }
          });
        }
        const updateCalls = (candidate: EditorGraphState): EditorGraphState => ({
          ...candidate,
          nodes: candidate.nodes.map((node) => {
            if (node.type !== StoryNodeType.CallEvent) return node;
            const call = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
            if (call.eventId !== id) return node;
            const argumentsByName = { ...call.arguments };
            for (const [oldName, newName] of renamed) {
              argumentsByName[newName] = argumentsByName[oldName] ?? {
                source: '',
                bindings: {},
              };
              delete argumentsByName[oldName];
            }
            const nextArguments = Object.fromEntries(
              nextEvent.parameters.map((parameter) => [
                parameter.name,
                argumentsByName[parameter.name] ?? {
                  source:
                    parameter.valueType.kind === 'string'
                      ? '""'
                      : parameter.valueType.kind === 'boolean'
                        ? 'false'
                        : '0',
                  bindings: {},
                },
              ]),
            );
            return { ...node, data: { ...node.data, arguments: nextArguments } };
          }),
        });
        setNodes((current) => updateCalls({ nodes: current, edges }).nodes);
        updateInactiveGraphs(updateCalls);
        setWorkspaceStories((current) =>
          current.map((story) => ({
            ...story,
            rootGraph: updateCalls(story.rootGraph),
            chapters: story.chapters.map((chapter) => ({
              ...chapter,
              graph: updateCalls(chapter.graph),
            })),
            document: { ...story.document, dirty: true },
            revision: story.revision + 1,
          })),
        );
        markDirty();
      }
      writeProjectEvents(events.map((event) => (event.id === id ? nextEvent : event)));
    },
    [edges, events, markDirty, setNodes, updateInactiveGraphs, writeProjectEvents],
  );

  const removeEvent = useCallback(
    (id: EventId) => {
      const event = events.find((candidate) => candidate.id === id);
      if (!event) return;
      const used = currentStoryItemsRef
        .current()
        .some((story) =>
          [story.rootGraph, ...story.chapters.map((chapter) => chapter.graph)].some((candidate) =>
            candidate.nodes.some(
              (node) => node.type === StoryNodeType.CallEvent && node.data.eventId === id,
            ),
          ),
        );
      if (used) {
        setWorkspaceError('Event is used by an open Story. Remove its Call Event nodes first.');
        return;
      }
      if (!window.confirm(`Delete event "${event.displayName}"? This cannot be undone.`)) return;
      setStoryDataSelection((current) =>
        current?.kind === 'event' && current.id === id ? undefined : current,
      );
      writeProjectEvents(events.filter((candidate) => candidate.id !== id));
    },
    [events, writeProjectEvents],
  );

  const writeProjectSignals = useCallback(
    (nextSignals: readonly SignalSource[]) => {
      if (!workspace?.project || !window.electronAPI) return;
      const project = workspace.project;
      setWorkspace((current) =>
        current?.project
          ? { ...current, project: { ...current.project, signals: nextSignals } }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.updateProjectSettings({
          entryStoryId: project.entryStoryId,
          outputDirectory: project.outputDirectory,
          signals: nextSignals,
        }),
      );
    },
    [queueProjectResourceWrite, workspace?.project],
  );

  const addSignal = useCallback((): SignalId | undefined => {
    if (!workspace?.project) {
      setWorkspaceError('Open or create a Story project before adding signals.');
      return undefined;
    }
    const id = createStableId('signal');
    const used = new Set(signals.map((signal) => signal.name));
    let index = signals.length + 1;
    let name = `signal${index}`;
    while (used.has(name)) name = `signal${++index}`;
    writeProjectSignals([...signals, { id, name, displayName: name, parameters: [] }]);
    return id;
  }, [signals, workspace?.project, writeProjectSignals]);

  const updateSignal = useCallback(
    (id: SignalId, update: Partial<SignalSource>) => {
      const previous = signals.find((signal) => signal.id === id);
      if (!previous) return;
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const nextSignal = { ...previous, ...nextUpdate, id };
      if (nextUpdate.parameters) {
        const renamed = new Map<string, string>();
        const previousNames = new Set(previous.parameters.map((parameter) => parameter.name));
        if (previous.parameters.length === nextSignal.parameters.length) {
          previous.parameters.forEach((parameter, index) => {
            const nextName = nextSignal.parameters[index]?.name;
            if (nextName && nextName !== parameter.name && !previousNames.has(nextName)) {
              renamed.set(parameter.name, nextName);
            }
          });
        }
        const updateWaits = (candidate: EditorGraphState): EditorGraphState => ({
          ...candidate,
          nodes: candidate.nodes.map((node) => {
            if (node.type !== StoryNodeType.WaitSignal) return node;
            const wait = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
            if (wait.signalId !== id) return node;
            const matches = { ...(wait.matches ?? {}) };
            for (const [oldName, newName] of renamed) {
              if (matches[oldName]) matches[newName] = matches[oldName];
              delete matches[oldName];
            }
            const allowed = new Set(nextSignal.parameters.map((parameter) => parameter.name));
            return {
              ...node,
              data: {
                ...node.data,
                matches: Object.fromEntries(
                  Object.entries(matches).filter(([name]) => allowed.has(name)),
                ),
              },
            };
          }),
        });
        setNodes((current) => updateWaits({ nodes: current, edges }).nodes);
        updateInactiveGraphs(updateWaits);
        setWorkspaceStories((current) =>
          current.map((story) => ({
            ...story,
            rootGraph: updateWaits(story.rootGraph),
            chapters: story.chapters.map((chapter) => ({
              ...chapter,
              graph: updateWaits(chapter.graph),
            })),
            document: { ...story.document, dirty: true },
            revision: story.revision + 1,
          })),
        );
        markDirty();
      }
      writeProjectSignals(signals.map((signal) => (signal.id === id ? nextSignal : signal)));
    },
    [edges, markDirty, setNodes, signals, updateInactiveGraphs, writeProjectSignals],
  );

  const removeSignal = useCallback(
    (id: SignalId) => {
      const signal = signals.find((candidate) => candidate.id === id);
      if (!signal) return;
      const used = currentStoryItemsRef
        .current()
        .some((story) =>
          [story.rootGraph, ...story.chapters.map((chapter) => chapter.graph)].some((candidate) =>
            candidate.nodes.some(
              (node) => node.type === StoryNodeType.WaitSignal && node.data.signalId === id,
            ),
          ),
        );
      if (used) {
        setWorkspaceError(
          'Signal is used by an open Story. Remove its Wait for Signal nodes first.',
        );
        return;
      }
      if (!window.confirm(`Delete signal "${signal.displayName}"? This cannot be undone.`)) return;
      setStoryDataSelection((current) =>
        current?.kind === 'signal' && current.id === id ? undefined : current,
      );
      writeProjectSignals(signals.filter((candidate) => candidate.id !== id));
    },
    [signals, writeProjectSignals],
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

  const captureActiveStory = useCallback(
    (): EditorStoryWorkspaceItem => ({
      document: { ...document },
      rootGraph: structuredClone(activeGraphId === 'root' ? graph : rootGraphRef.current),
      chapters: chapters.map((chapter) => ({
        ...chapter,
        graph: structuredClone(activeGraphId === chapter.id ? graph : chapter.graph),
      })),
      variables: structuredClone(variables),
      characters: structuredClone(characters),
      assets: structuredClone(assets),
      revision: revisionRef.current,
    }),
    [activeGraphId, assets, chapters, characters, document, graph, variables],
  );

  const storyItemToSource = useCallback(
    (story: EditorStoryWorkspaceItem): StorySourceDocument => ({
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: story.document.id,
      name: story.document.name,
      displayName: story.document.displayName,
      root: toSourceGraph(story.rootGraph),
      chapters: story.chapters.map((chapter) => ({
        ...chapter,
        graph: toSourceGraph(chapter.graph),
      })),
      variables: story.variables,
      characters: story.characters,
      assets: story.assets,
      events: [],
    }),
    [],
  );

  const currentStoryItems = useCallback((): EditorStoryWorkspaceItem[] => {
    const active = hasActiveStory ? captureActiveStory() : undefined;
    return workspaceStories.map((story) =>
      active && story.document.id === active.document.id ? active : story,
    );
  }, [captureActiveStory, hasActiveStory, workspaceStories]);
  currentStoryItemsRef.current = currentStoryItems;

  const saveStoryItems = useCallback(
    async (items: EditorStoryWorkspaceItem[]): Promise<EditorStoryWorkspaceItem[] | undefined> => {
      if (!window.electronAPI) return undefined;
      const saved: EditorStoryWorkspaceItem[] = [];
      for (const item of items) {
        if (item.document.gitConflict) {
          throw new Error(
            `${item.document.displayName} has an unresolved Git conflict. Use Story Merge before saving.`,
          );
        }
        if (!item.document.dirty) {
          saved.push(item);
          continue;
        }
        const result = await window.electronAPI.saveStory({
          filePath: item.document.filePath,
          fileToken: item.document.fileToken,
          content: serializeStorySource(storyItemToSource(item)),
        });
        if (result.canceled) return undefined;
        const savedItem: EditorStoryWorkspaceItem = {
          ...item,
          document: {
            ...item.document,
            filePath: result.filePath,
            fileToken: result.fileToken,
            dirty: false,
            error: undefined,
          },
        };
        saved.push(savedItem);
        setWorkspaceStories((current) =>
          current.map((candidate) =>
            candidate.document.id === savedItem.document.id ? savedItem : candidate,
          ),
        );
        setDocument((current) =>
          current.id === savedItem.document.id ? savedItem.document : current,
        );
      }
      return saved;
    },
    [storyItemToSource],
  );

  const saveAllDirtyStories = useCallback(async (): Promise<boolean> => {
    try {
      while (projectResourceWritesRef.current.size > 0) {
        await Promise.all([...projectResourceWritesRef.current.values()]);
      }
      setProjectResourcesDirty(false);
      const saved = await saveStoryItems(currentStoryItems());
      if (!saved) return false;
      setWorkspaceStories(saved);
      const active = saved.find((item) => item.document.id === document.id);
      if (active) setDocument(active.document);
      if (workspace) {
        setWorkspace(
          workspace.project
            ? await window.electronAPI!.syncWorkspaceProject()
            : await window.electronAPI!.refreshWorkspace(),
        );
      }
      return true;
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [currentStoryItems, document.id, saveStoryItems, workspace]);

  const confirmWorkspaceChange = useCallback(
    async (action: string): Promise<boolean> => {
      if (!window.electronAPI) return false;
      const dirty = currentStoryItems().filter((item) => item.document.dirty);
      if (dirty.length === 0) return projectResourcesDirty ? saveAllDirtyStories() : true;
      const choice = await window.electronAPI.confirmUnsavedStories(
        dirty.map((item) => item.document.displayName),
        action,
      );
      if (choice === 'cancel') return false;
      return choice === 'discard' ? true : saveAllDirtyStories();
    },
    [currentStoryItems, projectResourcesDirty, saveAllDirtyStories],
  );

  const clearStorySession = useCallback(() => {
    const emptyGraph: EditorGraphState = { nodes: [], edges: [] };
    rootGraphRef.current = emptyGraph;
    restoreGraph(emptyGraph);
    setWorkspaceStories([]);
    setChapters([]);
    setVariables([]);
    setCharacters([]);
    setAssets([]);
    setActiveGraphId('root');
    setDocument(initialDocument);
    setHasActiveStory(false);
    setStoryDataSelection(undefined);
    revisionRef.current = 0;
    history.clear();
  }, [history, initialDocument, restoreGraph]);

  const acceptWorkspaceChange = useCallback(
    async (nextWorkspace: WorkspaceInfo) => {
      clearStorySession();
      setWorkspace(nextWorkspace);
      setWorkspaceError(undefined);
      setRecentProjects(await window.electronAPI!.getRecentProjects());
    },
    [clearStorySession],
  );

  const loadStory = useCallback(
    (story: EditorStoryWorkspaceItem, graphId: ActiveGraphId = 'root') => {
      const targetGraph =
        graphId === 'root'
          ? story.rootGraph
          : story.chapters.find((chapter) => chapter.id === graphId)?.graph;
      if (!targetGraph) return;
      setStoryDataSelection(undefined);
      rootGraphRef.current = structuredClone(story.rootGraph);
      restoreGraph(structuredClone(targetGraph));
      setChapters(structuredClone(story.chapters));
      setActiveGraphId(graphId);
      setVariables(structuredClone(story.variables));
      setCharacters(structuredClone(story.characters));
      setAssets(structuredClone(story.assets));
      setDocument({ ...story.document });
      setHasActiveStory(true);
      revisionRef.current = story.revision;
      history.clear();
    },
    [history, restoreGraph],
  );

  const switchStory = useCallback(
    (id: StoryId, graphId: ActiveGraphId = 'root') => {
      if (hasActiveStory && id === document.id) {
        switchGraph(graphId);
        return;
      }
      const target = workspaceStories.find((story) => story.document.id === id);
      if (!target) return;
      const current = hasActiveStory ? captureActiveStory() : undefined;
      setWorkspaceStories((items) =>
        items.map((story) =>
          current && story.document.id === current.document.id ? current : story,
        ),
      );
      loadStory(target, graphId);
    },
    [captureActiveStory, document.id, hasActiveStory, loadStory, switchGraph, workspaceStories],
  );

  const newStory = useCallback(() => {
    const nextGraph = createNewGraph();
    const current = hasActiveStory ? captureActiveStory() : undefined;
    const usedNames = new Set(workspaceStories.map((story) => story.document.name));
    let untitledIndex = 1;
    let name = 'untitled';
    while (usedNames.has(name)) name = `untitled-${++untitledIndex}`;
    const next: EditorStoryWorkspaceItem = {
      document: {
        id: createStableId('story'),
        name,
        displayName: `Untitled Story${untitledIndex === 1 ? '' : ` ${untitledIndex}`}`,
        dirty: true,
      },
      rootGraph: structuredClone(nextGraph),
      chapters: [],
      variables: [],
      characters: [],
      assets: [],
      revision: 1,
    };
    setWorkspaceStories((items) => [
      ...items.map((story) =>
        current && story.document.id === current.document.id ? current : story,
      ),
      next,
    ]);
    loadStory(next);
  }, [captureActiveStory, hasActiveStory, loadStory, workspaceStories]);

  const storyItemFromOpenedStory = useCallback(
    (
      result: Exclude<OpenStoryResult, { canceled: true }>,
      recovered: { dirty?: boolean; filePath?: string; fileToken?: string } = {},
    ): EditorStoryWorkspaceItem => {
      const source = parseStorySource(result.content);
      const graphLoadOptions = { allowInvalidConnections: result.gitConflict === true };
      const rootGraph = fromSourceGraph(source.root, graphLoadOptions);
      return {
        document: {
          id: source.id,
          name: source.name,
          displayName: source.displayName,
          filePath: recovered.dirty ? recovered.filePath : result.filePath,
          fileToken: recovered.dirty ? recovered.fileToken : result.fileToken,
          dirty: recovered.dirty ?? false,
          gitConflict: result.gitConflict,
        },
        rootGraph,
        chapters: source.chapters.map((chapter) => ({
          ...chapter,
          graph: fromSourceGraph(chapter.graph, graphLoadOptions),
        })),
        variables: [...source.variables],
        characters: [...source.characters],
        assets: [...source.assets],
        revision: recovered.dirty ? 1 : 0,
      };
    },
    [],
  );

  const acceptOpenedStory = useCallback(
    (
      result: Exclude<OpenStoryResult, { canceled: true }>,
      recovered: { dirty?: boolean; filePath?: string; fileToken?: string } = {},
      replaceSession = false,
    ) => {
      const opened = storyItemFromOpenedStory(result, recovered);
      const current = !replaceSession && hasActiveStory ? captureActiveStory() : undefined;
      setWorkspaceStories((items) => {
        if (replaceSession) return [opened];
        const withoutOpened = items.filter(
          (story) =>
            story.document.id !== opened.document.id &&
            story.document.filePath !== opened.document.filePath,
        );
        return [
          ...withoutOpened.map((story) =>
            current && story.document.id === current.document.id ? current : story,
          ),
          opened,
        ];
      });
      loadStory(opened);
      return opened;
    },
    [captureActiveStory, hasActiveStory, loadStory, storyItemFromOpenedStory],
  );

  useEffect(() => {
    if (!window.electronAPI) return;
    let reloading = false;
    return window.electronAPI.onWorkspaceGitChanged((git) => {
      if (reloading) return;
      reloading = true;
      void (async () => {
        try {
          const items = currentStoryItemsRef.current();
          const dirtyNames = items
            .filter((item) => item.document.dirty)
            .map((item) => item.document.displayName);
          if (projectResourcesDirty) dirtyNames.push('Project resources');
          if (dirtyNames.length > 0) {
            const choice = await window.electronAPI!.confirmGitReload(dirtyNames);
            if (choice === 'keep') {
              setWorkspace((current) => (current ? { ...current, git } : current));
              setWorkspaceError(
                'Git workspace changed. Project reload was skipped to preserve unsaved editor changes.',
              );
              return;
            }
          }

          if (projectResourceWritesRef.current.size > 0) {
            await Promise.allSettled([...projectResourceWritesRef.current.values()]);
          }
          const activeFilePath = document.filePath;
          const requests = items.flatMap((item) =>
            item.document.filePath && item.document.fileToken
              ? [{ filePath: item.document.filePath, fileToken: item.document.fileToken }]
              : [],
          );
          const result = await window.electronAPI!.reloadWorkspaceAfterGitChange(requests);
          const reloaded = result.stories.map((story) => storyItemFromOpenedStory(story));
          setWorkspace(result.workspace);
          setWorkspaceError(
            result.missingStoryPaths.length > 0
              ? `${result.missingStoryPaths.length} open Story file(s) do not exist on the new branch.`
              : undefined,
          );
          setProjectResourcesDirty(false);
          setWorkspaceStories(reloaded);
          const active = reloaded.find((item) => item.document.filePath === activeFilePath);
          const next = active ?? reloaded[0];
          if (next) {
            const nextGraph =
              activeGraphId === 'root' || next.chapters.some((chapter) => chapter.id === activeGraphId)
                ? activeGraphId
                : 'root';
            loadStory(next, nextGraph);
          } else {
            clearStorySession();
            setWorkspace(result.workspace);
          }
        } catch (error) {
          setWorkspaceError(error instanceof Error ? error.message : String(error));
        } finally {
          reloading = false;
        }
      })();
    });
  }, [
    activeGraphId,
    clearStorySession,
    document.filePath,
    loadStory,
    projectResourcesDirty,
    storyItemFromOpenedStory,
  ]);

  const openStory = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.openStory();
      if (result.canceled) return;
      acceptOpenedStory(result);
    } catch (error) {
      setDocument((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [acceptOpenedStory]);

  const refreshWorkspace = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      setWorkspace(await window.electronAPI.refreshWorkspace());
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const initializeWorkspaceGit = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      setWorkspace(await window.electronAPI.initializeWorkspaceGit());
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const revealWorkspaceItem = useCallback(async (relativePath: string) => {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.revealWorkspaceItem(relativePath);
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deleteWorkspaceStory = useCallback(async (relativePath: string) => {
    if (!window.electronAPI) return;
    if (!window.confirm(`Delete Story file "${relativePath}"? This cannot be undone.`)) return;
    try {
      setWorkspace(await window.electronAPI.deleteWorkspaceStory(relativePath));
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deleteWorkspaceProject = useCallback(async (relativePath: string) => {
    if (!window.electronAPI) return;
    if (
      !window.confirm(
        `Delete project file "${relativePath}"? Story, character, and asset files will be kept.`,
      )
    ) {
      return;
    }
    try {
      while (projectResourceWritesRef.current.size > 0) {
        await Promise.all([...projectResourceWritesRef.current.values()]);
      }
      setWorkspace(await window.electronAPI.deleteWorkspaceProject(relativePath));
      setRecentProjects(await window.electronAPI.getRecentProjects());
      setProblems([]);
      setLastBuildPath(undefined);
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const openWorkspace = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (!(await confirmWorkspaceChange('opening another workspace'))) return;
      const result = await window.electronAPI.openWorkspace();
      if (result.canceled) return;
      await acceptWorkspaceChange(result.workspace);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [acceptWorkspaceChange, confirmWorkspaceChange]);

  const openProject = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (!(await confirmWorkspaceChange('opening another project'))) return;
      const result = await window.electronAPI.openProject();
      if (result.canceled) return;
      await acceptWorkspaceChange(result.workspace);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [acceptWorkspaceChange, confirmWorkspaceChange]);

  const openRecentProject = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) return;
      try {
        if (!(await confirmWorkspaceChange('opening another project'))) return;
        const result = await window.electronAPI.openRecentProject(filePath);
        if (result.canceled) return;
        await acceptWorkspaceChange(result.workspace);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
        setRecentProjects(await window.electronAPI.getRecentProjects());
      }
    },
    [acceptWorkspaceChange, confirmWorkspaceChange],
  );

  const removeRecentProject = useCallback(async (filePath: string) => {
    if (!window.electronAPI) return;
    setRecentProjects(await window.electronAPI.removeRecentProject(filePath));
  }, []);

  const newProject = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (!(await confirmWorkspaceChange('creating another project'))) return;
      const result = await window.electronAPI.newProject();
      if (result.canceled) return;
      await acceptWorkspaceChange(result.workspace);
      if (result.initialStory) acceptOpenedStory(result.initialStory, {}, true);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [acceptOpenedStory, acceptWorkspaceChange, confirmWorkspaceChange]);

  const openWorkspaceStory = useCallback(
    async (relativePath: string) => {
      if (!window.electronAPI) return;
      try {
        const result = await window.electronAPI.openWorkspaceStory(relativePath);
        if (result.canceled) return;
        acceptOpenedStory(result);
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptOpenedStory],
  );

  const createWorkspaceDirectory = useCallback(async (parent: string, name: string) => {
    if (!window.electronAPI) return;
    try {
      setWorkspace(await window.electronAPI.createWorkspaceDirectory(parent, name));
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const createWorkspaceStory = useCallback(
    async (directory: string, displayName: string) => {
      if (!window.electronAPI) return;
      const trimmedName = displayName.trim();
      if (!trimmedName) return;
      try {
        const id = createStableId('story');
        const rootGraph = createNewGraph();
        const name =
          trimmedName
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'story';
        const createdSource: StorySourceDocument = {
          format: STORY_SOURCE_FORMAT,
          version: STORY_SOURCE_VERSION,
          id,
          name,
          displayName: trimmedName,
          root: toSourceGraph(rootGraph),
          chapters: [],
          variables: [],
          characters: [],
          assets: [],
          events: [],
        };
        const result = await window.electronAPI.createWorkspaceStory({
          directory,
          name: trimmedName,
          content: serializeStorySource(createdSource),
        });
        if (result.canceled) return;
        acceptOpenedStory(result);
        setWorkspace(await window.electronAPI.refreshWorkspace());
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptOpenedStory],
  );

  const createWorkspaceProject = useCallback(
    async (displayName: string) => {
      if (!window.electronAPI) return;
      const trimmedName = displayName.trim();
      if (!trimmedName) return;
      try {
        const name =
          trimmedName
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'project';
        const result = await window.electronAPI.createWorkspaceProject({
          fileName: name,
          content: serializeStoryProject({
            format: STORY_PROJECT_FORMAT,
            version: STORY_PROJECT_VERSION,
            id: createStableId('project'),
            name,
            displayName: trimmedName,
            stories: [],
            characters: [],
            assets: [],
            events: [],
            signals: [],
          }),
        });
        setWorkspace(result.workspace);
        acceptOpenedStory(result.initialStory);
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptOpenedStory],
  );

  const syncWorkspaceProject = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      setWorkspace(await window.electronAPI.syncWorkspaceProject());
      setWorkspaceError(undefined);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const applyWorkspaceMerge = useCallback(async (files: ApplyWorkspaceMergeFile[]) => {
    if (!window.electronAPI) {
      return { ok: false as const, message: 'Project resource saving requires Electron.' };
    }
    try {
      setWorkspace(await window.electronAPI.applyWorkspaceMerge(files));
      setWorkspaceError(undefined);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceError(message);
      return { ok: false as const, message };
    }
  }, []);

  const validateWorkspaceMerge = useCallback(async (files: ApplyWorkspaceMergeFile[]) => {
    if (!window.electronAPI) {
      return { ok: false as const, message: 'Project resource validation requires Electron.' };
    }
    try {
      await window.electronAPI.validateWorkspaceMerge(files);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  const updateProjectSettings = useCallback(
    async (settings: { entryStoryId?: StoryId; outputDirectory?: string }) => {
      if (!window.electronAPI || !workspace?.project) return;
      try {
        setWorkspace(
          await window.electronAPI.updateProjectSettings({
            entryStoryId: settings.entryStoryId ?? workspace.project.entryStoryId,
            outputDirectory:
              settings.outputDirectory === undefined
                ? workspace.project.outputDirectory
                : settings.outputDirectory,
          }),
        );
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [workspace?.project],
  );

  const buildProject = useCallback(async () => {
    if (!window.electronAPI || !workspace?.project) {
      setWorkspaceError('Open or create a Story project before building.');
      return;
    }
    setLastBuildPath(undefined);
    setProblems([]);
    if (!(await saveAllDirtyStories())) return;
    try {
      const nextWorkspace = await window.electronAPI.syncWorkspaceProject();
      setWorkspace(nextWorkspace);
      if (!nextWorkspace.project) throw new Error('Project index is unavailable');
      const files = await window.electronAPI.readWorkspaceProjectStories();
      const projectSources = files.map((file) => {
        const source = parseStorySource(file.content);
        const externalCharacters = nextWorkspace.project!.characters.flatMap((reference) => {
          if (!reference.path || !reference.storyIds.includes(source.id)) return [];
          const resource = nextWorkspace.characterResources.find(
            (candidate) => candidate.relativePath === reference.path,
          );
          return resource ? [resource.character] : [];
        });
        const externalAssets = nextWorkspace.project!.assets.flatMap((reference) => {
          if (!reference.path || !reference.storyIds.includes(source.id)) return [];
          const resource = nextWorkspace.assetResources.find(
            (candidate) => candidate.relativePath === reference.path,
          );
          return resource ? [resource.asset] : [];
        });
        return {
          path: file.path,
          source: {
            ...source,
            characters: [...source.characters, ...externalCharacters],
            assets: [...source.assets, ...externalAssets],
            events: nextWorkspace.project!.events,
          },
        };
      });
      const result = compileProject(nextWorkspace.project, projectSources);
      setProblems(result.diagnostics);
      if (!result.ok) return;
      const exported = await window.electronAPI.exportCompiledProject(
        `${JSON.stringify(result.project, null, 2)}\n`,
      );
      if (!exported.canceled) setLastBuildPath(exported.filePath);
      setWorkspaceError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProblems([{ code: 'PROJECT_ERROR', severity: 'error', message }]);
      setWorkspaceError(message);
    }
  }, [saveAllDirtyStories, workspace?.project]);

  const focusProblem = useCallback(
    async (problem: ProjectCompilerDiagnostic) => {
      if (!problem.storyId) return;
      let target = currentStoryItems().find((story) => story.document.id === problem.storyId);
      if (!target && problem.storyPath && window.electronAPI) {
        const opened = await window.electronAPI.openWorkspaceStory(problem.storyPath);
        if (opened.canceled) return;
        target = acceptOpenedStory(opened);
      }
      if (!target) return;
      let graphId: ActiveGraphId = problem.sourceChapterId ?? 'root';
      if (problem.sourceNodeId && !problem.sourceChapterId) {
        const chapter = target.chapters.find((item) =>
          item.graph.nodes.some((node) => node.id === problem.sourceNodeId),
        );
        if (chapter) graphId = chapter.id;
      }
      if (problem.sourceNodeId) {
        const selectNode = (candidate: EditorGraphState): EditorGraphState => ({
          ...candidate,
          nodes: candidate.nodes.map((node) => ({
            ...node,
            selected: node.id === problem.sourceNodeId,
          })),
          edges: candidate.edges.map((edge) => ({ ...edge, selected: false })),
        });
        target = {
          ...target,
          rootGraph: graphId === 'root' ? selectNode(target.rootGraph) : target.rootGraph,
          chapters: target.chapters.map((chapter) =>
            chapter.id === graphId ? { ...chapter, graph: selectNode(chapter.graph) } : chapter,
          ),
        };
      }
      setWorkspaceStories((items) =>
        items.map((story) => (story.document.id === target!.document.id ? target! : story)),
      );
      loadStory(target, graphId);
      if (problem.sourceNodeId) {
        setProblemFocus({ nodeId: problem.sourceNodeId, nonce: Date.now() });
      }
    },
    [acceptOpenedStory, currentStoryItems, loadStory],
  );

  const closeStory = useCallback(
    async (id: StoryId) => {
      const target =
        id === document.id
          ? { ...captureActiveStory(), document }
          : workspaceStories.find((story) => story.document.id === id);
      if (!target) return;
      if (target.document.dirty && window.electronAPI) {
        const choice = await window.electronAPI.confirmUnsavedStories(
          [target.document.displayName],
          'closing it',
        );
        if (choice === 'cancel') return;
        if (choice === 'save') {
          const saved = await saveStoryItems([target]);
          if (!saved) return;
        }
      }
      const remaining = workspaceStories.filter((story) => story.document.id !== id);
      if (id !== document.id) {
        setWorkspaceStories(remaining);
        return;
      }
      if (remaining.length > 0) {
        setWorkspaceStories(remaining);
        loadStory(remaining[0]);
        return;
      }
      clearStorySession();
    },
    [captureActiveStory, document, clearStorySession, loadStory, saveStoryItems, workspaceStories],
  );

  const revealStoryFile = useCallback(
    async (id: StoryId) => {
      if (!window.electronAPI) return;
      const target = currentStoryItems().find((story) => story.document.id === id);
      if (!target?.document.filePath || !target.document.fileToken) return;
      try {
        await window.electronAPI.revealStory(target.document.filePath, target.document.fileToken);
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [currentStoryItems],
  );

  const deleteStoryFile = useCallback(
    async (id: StoryId) => {
      if (!window.electronAPI) return;
      const items = currentStoryItems();
      const target = items.find((story) => story.document.id === id);
      if (!target?.document.filePath || !target.document.fileToken) return;
      const dirtyWarning = target.document.dirty ? ' Unsaved changes will also be lost.' : '';
      if (
        !window.confirm(
          `Delete Story file "${target.document.displayName}"?${dirtyWarning} This cannot be undone.`,
        )
      ) {
        return;
      }
      try {
        const nextWorkspace = await window.electronAPI.deleteStory(
          target.document.filePath,
          target.document.fileToken,
        );
        if (nextWorkspace) setWorkspace(nextWorkspace);
        const remaining = items.filter((story) => story.document.id !== id);
        setWorkspaceStories(remaining);
        if (id === document.id) {
          if (remaining.length > 0) loadStory(remaining[0]);
          else clearStorySession();
        }
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [clearStorySession, currentStoryItems, document.id, loadStory],
  );

  const updateStory = useCallback(
    (update: { name?: string; displayName?: string }) => {
      if (!hasActiveStory) return;
      setDocument((current) => ({ ...current, ...update, id: current.id }));
      markDirty();
    },
    [hasActiveStory, markDirty],
  );

  const saveStory = useCallback(
    async (saveAs = false, sourceOverride?: StorySourceDocument) => {
      if (!hasActiveStory || !window.electronAPI) return;
      if (document.gitConflict) {
        setDocument((current) => ({
          ...current,
          error: 'This Story has an unresolved Git conflict. Use View → Story Merge before saving.',
        }));
        return;
      }
      try {
        const savingDocumentId = document.id;
        const savingRevision = revisionRef.current;
        const result = await window.electronAPI.saveStory({
          filePath: document.filePath,
          fileToken: document.fileToken,
          content: serializeStorySource(sourceOverride ?? source),
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
        if (workspace) {
          try {
            setWorkspace(
              workspace.project
                ? await window.electronAPI.syncWorkspaceProject()
                : await window.electronAPI.refreshWorkspace(),
            );
            setWorkspaceError(undefined);
          } catch (error) {
            setWorkspaceError(error instanceof Error ? error.message : String(error));
          }
        }
      } catch (error) {
        setDocument((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [document, hasActiveStory, source, workspace],
  );

  const saveAllStories = useCallback(async () => {
    await saveAllDirtyStories();
  }, [saveAllDirtyStories]);

  useEffect(() => {
    if (restoredSessionRef.current || !window.electronAPI) return;
    restoredSessionRef.current = true;
    void (async () => {
      try {
        const restored = await window.electronAPI!.restoreEditorSession();
        if (restored.workspace) setWorkspace(restored.workspace);
        for (const story of restored.stories) acceptOpenedStory(story);
        for (const recovery of restored.recoveries) {
          const diskStory = restored.stories.find(
            (story) => story.filePath.toLowerCase() === recovery.filePath?.toLowerCase(),
          );
          acceptOpenedStory(
            {
              canceled: false,
              filePath: recovery.filePath ?? '',
              fileToken: diskStory?.fileToken ?? '',
              content: recovery.content,
            },
            {
              dirty: true,
              filePath: recovery.filePath,
              fileToken: diskStory?.fileToken,
            },
          );
        }
        setRecentProjects(await window.electronAPI!.getRecentProjects());
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      } finally {
        setSessionReady(true);
      }
    })();
  }, [acceptOpenedStory]);

  useEffect(() => {
    if (!sessionReady || !window.electronAPI) return;
    const timer = window.setTimeout(() => {
      const items = currentStoryItems();
      const storyFilePaths = items
        .map((item) => item.document.filePath)
        .filter((filePath): filePath is string => Boolean(filePath));
      void window.electronAPI
        ?.updateEditorSession({
          workspaceRoot: workspace?.rootPath,
          storyFilePaths,
          activeStoryFilePath: hasActiveStory ? document.filePath : undefined,
        })
        .catch((error: unknown) =>
          setWorkspaceError(error instanceof Error ? error.message : String(error)),
        );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentStoryItems, document.filePath, hasActiveStory, sessionReady, workspace?.rootPath]);

  useEffect(() => {
    if (!sessionReady || !window.electronAPI) return;
    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        const snapshots = currentStoryItems()
          .filter((item) => item.document.dirty)
          .map((item) => ({
            storyId: item.document.id,
            displayName: item.document.displayName,
            filePath: item.document.filePath,
            content: serializeStorySource(storyItemToSource(item)),
            savedAt,
          }));
        void window.electronAPI
          ?.writeRecoverySnapshots(snapshots)
          .catch((error: unknown) =>
            setWorkspaceError(error instanceof Error ? error.message : String(error)),
          );
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [currentStoryItems, sessionReady, storyItemToSource]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSaveBeforeClose(() => {
      void saveAllDirtyStories().then((saved) => window.electronAPI?.finishClose(saved));
    });
    return unsubscribe;
  }, [saveAllDirtyStories]);

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
      addSubstory,
      updateNode,
      updateNodeData,
      variables,
      characters: resolvedCharacters,
      assets: resolvedAssets,
      events,
      signals,
      semanticSnapshot,
      executeBlueprintCommands,
      storyDataSelection,
      selectStoryData,
      chapters,
      activeGraphId,
      switchGraph,
      focusGraphNode,
      updateSubstory,
      removeSubstory,
      extractSelectionToSubstory,
      mergeSelectedDialogues,
      splitDialogueLines,
      applyStoryMerge,
      validateStoryMerge,
      validateWorkspaceMerge,
      applyWorkspaceMerge,
      addVariable,
      updateVariable,
      removeVariable,
      addCharacter,
      updateCharacter,
      removeCharacter,
      addAsset,
      updateAsset,
      removeAsset,
      addEvent,
      updateEvent,
      removeEvent,
      addSignal,
      updateSignal,
      removeSignal,
      document,
      stories,
      hasActiveStory,
      activeStoryId: hasActiveStory ? document.id : undefined,
      workspace,
      workspaceError,
      recentProjects,
      problems,
      lastBuildPath,
      problemFocus,
      aiChanges,
      clearAIChanges,
      aiProposal,
      updateAIProposalNodes,
      applyAIProposal,
      discardAIProposal,
      storyMergePreview,
      storyMergePreviewGraphId,
      storyMergeDecisionRequest,
      showStoryMergePreview,
      clearStoryMergePreview,
      setStoryMergePreviewGraph,
      chooseStoryMergePreviewConflict,
      focusStoryMergePreviewNode,
      markDirty,
      newStory,
      openStory,
      saveStory,
      saveAllStories,
      switchStory,
      closeStory,
      revealStoryFile,
      deleteStoryFile,
      updateStory,
      openWorkspace,
      openProject,
      openRecentProject,
      removeRecentProject,
      newProject,
      refreshWorkspace,
      initializeWorkspaceGit,
      revealWorkspaceItem,
      deleteWorkspaceStory,
      deleteWorkspaceProject,
      openWorkspaceStory,
      createWorkspaceDirectory,
      createWorkspaceStory,
      createWorkspaceProject,
      syncWorkspaceProject,
      buildProject,
      focusProblem,
      updateProjectSettings,
    }),
    [
      addNode,
      addVariable,
      addCharacter,
      addAsset,
      addEvent,
      addSignal,
      addSubstory,
      checkpoint,
      characters,
      storyDataSelection,
      selectStoryData,
      resolvedCharacters,
      resolvedAssets,
      chapters,
      document,
      stories,
      hasActiveStory,
      workspace,
      workspaceError,
      recentProjects,
      problems,
      lastBuildPath,
      problemFocus,
      aiChanges,
      clearAIChanges,
      aiProposal,
      updateAIProposalNodes,
      applyAIProposal,
      discardAIProposal,
      storyMergePreview,
      storyMergePreviewGraphId,
      storyMergeDecisionRequest,
      showStoryMergePreview,
      clearStoryMergePreview,
      setStoryMergePreviewGraph,
      chooseStoryMergePreviewConflict,
      focusStoryMergePreviewNode,
      edges,
      graph,
      activeGraphId,
      nodes,
      markDirty,
      newStory,
      onEdgesChange,
      onNodesChange,
      redo,
      removeCharacter,
      removeAsset,
      removeEvent,
      removeSignal,
      removeSubstory,
      removeVariable,
      restoreGraph,
      setEdges,
      setNodes,
      openStory,
      saveStory,
      saveAllStories,
      switchStory,
      closeStory,
      revealStoryFile,
      deleteStoryFile,
      updateStory,
      openWorkspace,
      openProject,
      openRecentProject,
      removeRecentProject,
      newProject,
      refreshWorkspace,
      initializeWorkspaceGit,
      revealWorkspaceItem,
      deleteWorkspaceStory,
      deleteWorkspaceProject,
      openWorkspaceStory,
      createWorkspaceDirectory,
      createWorkspaceStory,
      createWorkspaceProject,
      syncWorkspaceProject,
      buildProject,
      focusProblem,
      updateProjectSettings,
      source,
      switchGraph,
      focusGraphNode,
      undo,
      updateCharacter,
      updateAsset,
      updateEvent,
      updateSignal,
      updateNode,
      updateNodeData,
      updateSubstory,
      updateVariable,
      variables,
      assets,
      events,
      signals,
      semanticSnapshot,
      executeBlueprintCommands,
      extractSelectionToSubstory,
      mergeSelectedDialogues,
      splitDialogueLines,
      applyStoryMerge,
      validateStoryMerge,
      validateWorkspaceMerge,
      applyWorkspaceMerge,
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
