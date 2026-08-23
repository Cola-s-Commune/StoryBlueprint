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
  serializeCharacterResource,
  serializeAssetResource,
  serializeStoryLocalization,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStableId,
  migrateEngineJsonValue,
  summarizeEngineSchemaMigration,
  nodeRegistry,
  type NodeId,
  type BlueprintCommandTransaction,
  type BlueprintTransactionResult,
  type StorySemanticSnapshot,
  type ChapterId,
  type ChapterSource,
  type VariableId,
  type VariableDefinition,
  type RuntimeValue,
  type CharacterId,
  type CharacterSource,
  type CharacterTemplateSource,
  type AssetSource,
  type AssetId,
  type EventId,
  type EventSource,
  type EngineTypeDefinition,
  type EngineSchemaMigrationSummary,
  type SignalId,
  type SignalSource,
  type DialogueNodeData,
  type DialogueLineId,
  type StoryNodeDataMap,
  type StoryId,
  type StorySourceDocument,
  type StoryLocalizationDocument,
} from '@story-blueprint/common';
import type { ExternalWorkspaceFileChange, RecoveryCandidate } from '../../shared/electronApi';
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
  replaceCharacterEmotionReferences,
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
import { planExternalFileChange } from './externalFileChangePlan';
import {
  BUILTIN_CHARACTER_TEMPLATES,
  characterFromTemplate,
  characterToTemplate,
  duplicateCharacterDefinition,
} from './characterManagement';
import {
  findVariableReferences as collectVariableReferences,
  findProjectVariableReferences,
  rewriteProjectVariableReferences,
  bindVariableReferencesInNode,
  renameVariableReferencesInNode,
  renameCharacterFieldReferencesInNode,
  bindCharacterFieldReferencesInNode,
  type VariableReference,
  type VariableReferenceGraph,
} from './variableReferences';
import {
  buildStoryResourceReferenceIndex,
  emotionReferenceKey,
  findAssetReferences as collectAssetReferences,
  findEmotionReferences as collectEmotionReferences,
  type ResourceReferenceCharacter,
  type ResourceReferenceStory,
  type StoryResourceReference,
  type StoryResourceReferenceIndex,
} from './resourceReferences';
import type {
  ApplyWorkspaceMergeFile,
  OpenStoryResult,
  ProjectStoryFile,
  RecentProject,
  ProjectResourceSnapshot,
  WorkspaceInfo,
} from '../../shared/electronApi';
import {
  buildInkImportTransaction,
  type InkImportDiagnostic,
  type InkImportSummary,
} from '../dialogue/inkImport';

nodeRegistry.registerBuiltins();

function createNewGraph(): EditorGraphState {
  const entry = NodeFactory.create(
    NodeFactory.generateId(StoryNodeType.Start),
    StoryNodeType.Start,
    {
      x: 160,
      y: 120,
    },
  );
  const end = NodeFactory.create(NodeFactory.generateId(StoryNodeType.End), StoryNodeType.End, {
    x: 480,
    y: 120,
  });
  if (!entry || !end) return { nodes: [], edges: [] };
  entry.data = { title: 'Story Entry' };
  end.data = { title: 'End Story' };
  return {
    nodes: [
      { ...toEditorGraphNode(entry), selected: true },
      { ...toEditorGraphNode(end), selected: false },
    ],
    edges: [
      {
        id: createStableId('edge'),
        source: entry.id,
        sourceHandle: 'out',
        target: end.id,
        targetHandle: 'in',
      },
    ],
  };
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
  | { kind: 'signal'; id: SignalId }
  | { kind: 'engine-type'; name: string };

export interface EngineTypeMigrationPreview {
  typeName: string;
  summary: EngineSchemaMigrationSummary;
  affectedValues: number;
  affectedLocations: readonly string[];
}

function engineFieldTypeReferences(
  type: import('@story-blueprint/common').EngineFieldType,
  name: string,
): boolean {
  return type.kind === 'object'
    ? type.typeName === name
    : type.kind === 'array'
      ? engineFieldTypeReferences(type.elementType, name)
      : type.kind === 'map'
        ? engineFieldTypeReferences(type.valueType, name)
      : false;
}

function resourceReferenceStories(
  items: readonly EditorStoryWorkspaceItem[],
): ResourceReferenceStory[] {
  return items.map((story) => ({
    id: story.document.id,
    label: story.document.displayName,
    rootGraph: story.rootGraph,
    variables: story.variables,
    chapters: story.chapters.map((chapter) => ({
      id: chapter.id,
      label: chapter.displayName,
      graph: chapter.graph,
      parameters: chapter.parameters.map((parameter) => parameter.variable),
      outputs: chapter.outputs.map((output) => output.variable),
      localVariables: chapter.localVariables,
    })),
  }));
}

function resourceReferenceCharacters(
  items: readonly EditorStoryWorkspaceItem[],
  projectCharacters: readonly CharacterSource[],
): ResourceReferenceCharacter[] {
  return [
    ...projectCharacters.map((character) => ({ character })),
    ...items.flatMap((story) =>
      story.characters.map((character) => ({
        character,
        storyId: story.document.id,
        storyLabel: story.document.displayName,
      })),
    ),
  ];
}

function editorStoryItemFromOpenedStory(
  result: Exclude<OpenStoryResult, { canceled: true }>,
  recovered: { dirty?: boolean; filePath?: string; fileToken?: string } = {},
): EditorStoryWorkspaceItem {
  const source = parseStorySource(result.content);
  const graphLoadOptions = { allowInvalidConnections: result.gitConflict === true };
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
    rootGraph: fromSourceGraph(source.root, graphLoadOptions),
    chapters: source.chapters.map((chapter) => ({
      ...chapter,
      graph: fromSourceGraph(chapter.graph, graphLoadOptions),
    })),
    variables: [...source.variables],
    characters: [...source.characters],
    assets: [...source.assets],
    revision: recovered.dirty ? 1 : 0,
  };
}

export type ActiveGraphId = 'root' | ChapterId;

interface EditorHistoryState {
  document: StoryDocumentInfo;
  hasActiveStory: boolean;
  activeGraphId: ActiveGraphId;
  graph: EditorGraphState;
  rootGraph: EditorGraphState;
  chapters: EditorChapter[];
  variables: VariableDefinition[];
  characters: CharacterSource[];
  assets: AssetSource[];
  projectResources: ProjectResourceSnapshot;
  workspaceStories: EditorStoryWorkspaceItem[];
  projectVariables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  engineTypes: readonly EngineTypeDefinition[];
  projectSettings?: { entryStoryId?: StoryId; outputDirectory?: string };
  localization?: StoryLocalizationDocument;
  storyFiles: { relativePath: string; content: string }[];
}

interface AIEditorChanges {
  nonce: number;
  addedNodeIds: NodeId[];
  changedNodeIds: NodeId[];
  removedNodeIds: NodeId[];
  layoutNodeIds: NodeId[];
  variableChangeCount: number;
  characterChangeCount: number;
}

interface AIEditorProposal extends AIEditorChanges {
  graph: EditorGraphState;
  transaction: unknown;
  origin: 'ai' | 'ink';
}

export interface InkImportReport {
  filePath?: string;
  diagnostics: readonly InkImportDiagnostic[];
  summary?: InkImportSummary;
}

export interface ExternalStoryMergeRequest {
  relativePath: string;
  base: StorySourceDocument;
  local: StorySourceDocument;
  remote: StorySourceDocument;
  nonce: number;
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
  checkpoint: (snapshot?: EditorGraphState, label?: string) => void;
  restoreGraph: (graph: EditorGraphState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  undoEntries: readonly { label: string; steps: number }[];
  redoEntries: readonly { label: string; steps: number }[];
  travelHistory: (steps: number) => void;
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
  recoveries: readonly RecoveryCandidate[];
  recoveryError?: string;
  recoverStory: (storyId: string) => void;
  saveRecoveryAs: (storyId: string) => Promise<void>;
  discardRecovery: (storyId: string) => void;
  discardAllRecoveries: () => void;
  dismissRecoveryError: () => void;
  externalFileChanges: readonly ExternalWorkspaceFileChange[];
  externalStoryMergeRequest?: ExternalStoryMergeRequest;
  keepExternalEditorVersion: (relativePath: string) => void;
  reloadExternalFile: (relativePath: string) => Promise<void>;
  saveExternalStoryAs: (relativePath: string) => Promise<void>;
  mergeExternalStory: (relativePath: string) => void;
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
  inkImportReport?: InkImportReport;
  dismissInkImportReport: () => void;
  importInkFile: () => Promise<void>;
  storyMergePreview?: StoryMergePreview;
  storyMergePreviewGraphId?: ActiveGraphId;
  storyMergeDecisionRequest?: { id: string; choice: StoryMergeChoice; nonce: number };
  showStoryMergePreview: (
    merged: StorySourceDocument,
    conflicts: readonly StoryMergeConflict[],
    decisions: StoryMergeDecisions,
    remote?: StorySourceDocument,
  ) => void;
  clearStoryMergePreview: () => void;
  setStoryMergePreviewGraph: (graphId: ActiveGraphId) => void;
  chooseStoryMergePreviewConflict: (id: string, choice: StoryMergeChoice) => void;
  focusStoryMergePreviewNode: (graphId: ActiveGraphId, nodeId: NodeId) => boolean;
  variables: VariableDefinition[];
  availableVariables: readonly VariableDefinition[];
  projectVariables: readonly VariableDefinition[];
  characters: CharacterSource[];
  assets: AssetSource[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  engineTypes: readonly EngineTypeDefinition[];
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
  updateSubstory: (
    id: ChapterId,
    update: Partial<
      Pick<EditorChapter, 'name' | 'displayName' | 'parameters' | 'outputs' | 'localVariables'>
    >,
  ) => void;
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
  addVariable: (name?: string) => VariableId;
  addProjectVariable: (name?: string) => VariableId | undefined;
  findVariableReferences: (id: VariableId) => readonly VariableReference[];
  variableReferencesLoading: boolean;
  variableReferencesError?: string;
  refreshProjectVariableReferences: () => void;
  focusVariableReference: (reference: VariableReference) => Promise<boolean>;
  updateVariable: (id: VariableId, update: Partial<VariableDefinition>) => boolean;
  removeVariable: (
    id: VariableId,
  ) => { ok: true } | { ok: false; references: readonly VariableReference[] };
  addCharacter: (name?: string) => CharacterId;
  duplicateCharacter: (id: CharacterId) => CharacterId | undefined;
  addCharacterFromTemplate: (template: CharacterTemplateSource, name?: string) => CharacterId;
  saveCharacterAsTemplate: (id: CharacterId) => Promise<void>;
  findCharacterReferences: (id: CharacterId) => readonly StoryResourceReference[];
  findEmotionReferences: (id: CharacterId, emotion: string) => readonly StoryResourceReference[];
  findCharacterFieldReferences: (id: VariableId) => readonly StoryResourceReference[];
  findAssetReferences: (id: AssetId) => readonly StoryResourceReference[];
  focusStoryResourceReference: (reference: StoryResourceReference) => boolean;
  updateCharacter: (
    id: CharacterId,
    update: Partial<CharacterSource>,
    options?: { recordHistory?: boolean },
  ) => void;
  renameCharacterEmotion: (id: CharacterId, fromEmotion: string, toEmotion: string) => void;
  removeCharacterEmotion: (id: CharacterId, emotion: string) => void;
  removeCharacter: (id: CharacterId) => void;
  addAsset: (name?: string) => AssetId;
  updateAsset: (id: AssetId, update: Partial<AssetSource>) => void;
  removeAsset: (id: AssetId) => void;
  addEvent: (name?: string) => EventId | undefined;
  updateEvent: (id: EventId, update: Partial<EventSource>) => void;
  removeEvent: (id: EventId) => void;
  addSignal: (name?: string) => SignalId | undefined;
  updateSignal: (id: SignalId, update: Partial<SignalSource>) => void;
  removeSignal: (id: SignalId) => void;
  addEngineType: (name?: string) => string | undefined;
  updateEngineType: (name: string, update: EngineTypeDefinition) => boolean;
  removeEngineType: (name: string) => void;
  engineTypeMigrationPreview?: EngineTypeMigrationPreview;
  confirmEngineTypeMigration: () => void;
  cancelEngineTypeMigration: () => void;
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
  extractProjectLocalization: (sourceLocale: string) => Promise<void>;
  updateProjectLocalization: (document: StoryLocalizationDocument) => void;
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
  const activeChapter = chapters.find((chapter) => chapter.id === activeGraphId);
  const availableVariables = useMemo(
    () => [
      ...variables,
      ...(activeChapter?.parameters.map((parameter) => parameter.variable) ?? []),
      ...(activeChapter?.localVariables ?? []),
    ],
    [activeChapter?.localVariables, activeChapter?.parameters, variables],
  );
  const revisionRef = useRef(0);
  const [document, setDocument] = useState<StoryDocumentInfo>(initialDocument);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const events = workspace?.project?.events ?? [];
  const signals = workspace?.project?.signals ?? [];
  const engineTypes = workspace?.project?.engineTypes ?? [];
  const projectVariables = workspace?.project?.variables ?? [];
  const [workspaceError, setWorkspaceError] = useState<string>();
  useEffect(() => {
    if (!workspaceError) return;
    void window.electronAPI?.reportRendererError('workspace-error', workspaceError);
  }, [workspaceError]);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [problems, setProblems] = useState<readonly ProjectCompilerDiagnostic[]>([]);
  const [lastBuildPath, setLastBuildPath] = useState<string>();
  const [problemFocus, setProblemFocus] = useState<{ nodeId: NodeId; nonce: number }>();
  const [aiChanges, setAIChanges] = useState<AIEditorChanges>();
  const [aiProposal, setAIProposal] = useState<AIEditorProposal>();
  const [inkImportReport, setInkImportReport] = useState<InkImportReport>();
  const [storyMergePreview, setStoryMergePreview] = useState<StoryMergePreview>();
  const [storyMergePreviewGraphId, setStoryMergePreviewGraphIdState] = useState<ActiveGraphId>();
  const [storyMergeDecisionRequest, setStoryMergeDecisionRequest] = useState<{
    id: string;
    choice: StoryMergeChoice;
    nonce: number;
  }>();
  const [workspaceStories, setWorkspaceStories] = useState<EditorStoryWorkspaceItem[]>([]);
  const [storyDataSelection, setStoryDataSelection] = useState<StoryDataSelection>();
  const [engineTypeMigrationPreview, setEngineTypeMigrationPreview] =
    useState<EngineTypeMigrationPreview>();
  const engineTypeMigrationApplyRef = useRef<(() => void) | undefined>(undefined);
  const [projectVariableReferenceScan, setProjectVariableReferenceScan] = useState<{
    variableId?: VariableId;
    loading: boolean;
    references: readonly VariableReference[];
    stories?: readonly ProjectStoryFile[];
    projectRevision?: string;
    error?: string;
  }>({ loading: false, references: [] });
  const [projectVariableReferenceRefreshNonce, setProjectVariableReferenceRefreshNonce] =
    useState(0);
  const projectStoryTextCacheRef = useRef<{
    key: string;
    stories: readonly ProjectStoryFile[];
    projectRevision: string;
  }>();
  const [sessionReady, setSessionReady] = useState(false);
  const [recoveries, setRecoveries] = useState<RecoveryCandidate[]>([]);
  const [recoveryError, setRecoveryError] = useState<string>();
  const [externalFileChanges, setExternalFileChanges] = useState<ExternalWorkspaceFileChange[]>([]);
  const [externalStoryMergeRequest, setExternalStoryMergeRequest] =
    useState<ExternalStoryMergeRequest>();
  const restoredSessionRef = useRef(false);
  const projectResourceWritesRef = useRef(new Map<string, Promise<WorkspaceInfo>>());
  const managedStoryFilesRef = useRef(new Map<string, string>());
  const storyHistoryWriteRef = useRef<Promise<void>>(Promise.resolve());
  const currentStoryItemsRef = useRef<() => EditorStoryWorkspaceItem[]>(() => []);
  const updateCharacterRef = useRef<(id: CharacterId, update: Partial<CharacterSource>) => void>(
    () => undefined,
  );
  const resourceReferenceIndexRef = useRef<StoryResourceReferenceIndex | undefined>(undefined);
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
      engineTypes,
      characterTemplates: [
        ...BUILTIN_CHARACTER_TEMPLATES,
        ...(workspace?.characterTemplates.map((item) => item.template) ?? []),
      ],
    }),
    [
      engineTypes,
      events,
      resolvedAssets,
      resolvedCharacters,
      signals,
      workspace?.characterTemplates,
    ],
  );
  const semanticSnapshot = useMemo(
    () =>
      createStorySemanticSnapshot(
        {
          ...source,
          ...aiSemanticContext,
          variables: [...source.variables, ...projectVariables],
        },
        aiSemanticContext.characterTemplates,
        engineTypes,
      ),
    [aiSemanticContext, engineTypes, projectVariables, source],
  );
  const selectedProjectVariable =
    storyDataSelection?.kind === 'variable'
      ? projectVariables.find((variable) => variable.id === storyDataSelection.id)
      : undefined;
  const selectedProjectVariableScanTarget = useMemo(
    () =>
      selectedProjectVariable
        ? { id: selectedProjectVariable.id, name: selectedProjectVariable.name }
        : undefined,
    [selectedProjectVariable?.id, selectedProjectVariable?.name],
  );
  const projectStoryIndexKey = [
    workspace?.project?.stories.map((story) => `${story.id}:${story.path}`).join('|') ?? '',
    workspace?.git.headRevision ?? '',
    workspace?.git.conflictRevision ?? '',
    String(projectVariableReferenceRefreshNonce),
  ].join('::');
  const variableReferencesLoading =
    selectedProjectVariable !== undefined &&
    (projectVariableReferenceScan.loading ||
      projectVariableReferenceScan.variableId !== selectedProjectVariable.id);
  const variableReferencesError =
    projectVariableReferenceScan.variableId === selectedProjectVariable?.id
      ? projectVariableReferenceScan.error
      : undefined;

  useEffect(() => {
    if (!selectedProjectVariableScanTarget || !window.electronAPI || !workspace?.project) {
      setProjectVariableReferenceScan({ loading: false, references: [] });
      return;
    }
    let canceled = false;
    setProjectVariableReferenceScan({
      variableId: selectedProjectVariableScanTarget.id,
      loading: true,
      references: [],
    });
    const cached = projectStoryTextCacheRef.current;
    if (cached?.key === projectStoryIndexKey) {
      setProjectVariableReferenceScan({
        variableId: selectedProjectVariableScanTarget.id,
        loading: false,
        references: findProjectVariableReferences(
          selectedProjectVariableScanTarget,
          cached.stories,
        ),
        stories: cached.stories,
        projectRevision: cached.projectRevision,
      });
      return;
    }
    void window.electronAPI
      .readWorkspaceProjectStories()
      .then((snapshot) => {
        if (canceled) return;
        projectStoryTextCacheRef.current = { key: projectStoryIndexKey, ...snapshot };
        setProjectVariableReferenceScan({
          variableId: selectedProjectVariableScanTarget.id,
          loading: false,
          references: findProjectVariableReferences(
            selectedProjectVariableScanTarget,
            snapshot.stories,
          ),
          stories: snapshot.stories,
          projectRevision: snapshot.projectRevision,
        });
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setProjectVariableReferenceScan({
          variableId: selectedProjectVariableScanTarget.id,
          loading: false,
          references: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      canceled = true;
    };
  }, [projectStoryIndexKey, selectedProjectVariableScanTarget]);

  const refreshProjectVariableReferences = useCallback(() => {
    projectStoryTextCacheRef.current = undefined;
    setProjectVariableReferenceRefreshNonce((current) => current + 1);
  }, []);

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

  const restoreCharactersFromHistory = useCallback(
    (nextCharacters: readonly CharacterSource[], resources: ProjectResourceSnapshot) => {
      const externalIds = new Set(resources.characters.map(({ character }) => character.id));
      setCharacters(
        nextCharacters
          .filter((character) => !externalIds.has(character.id))
          .map((character) => structuredClone(character)),
      );
    },
    [],
  );

  const projectResourceSnapshot = useMemo<ProjectResourceSnapshot>(
    () => ({
      characters:
        workspace?.characterResources.map((resource) => ({
          relativePath: resource.relativePath,
          character: resource.character,
        })) ?? [],
      assets:
        workspace?.assetResources.map((resource) => ({
          relativePath: resource.relativePath,
          asset: resource.asset,
        })) ?? [],
    }),
    [workspace?.assetResources, workspace?.characterResources],
  );

  const restoreProjectResourcesFromHistory = useCallback(
    (snapshot: ProjectResourceSnapshot) => {
      if (!workspace?.project || !window.electronAPI) return;
      const characters = structuredClone(snapshot.characters);
      const assets = structuredClone(snapshot.assets);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              characterResources: characters,
              assetResources: assets,
            }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.restoreProjectResources({ characters, assets }),
      );
    },
    [queueProjectResourceWrite, workspace],
  );

  const writeProjectVariables = useCallback(
    (nextVariables: readonly VariableDefinition[]) => {
      if (!workspace?.project || !window.electronAPI) return;
      setWorkspace((current) =>
        current?.project
          ? {
              ...current,
              project: { ...current.project, variables: structuredClone(nextVariables) },
            }
          : current,
      );
      queueProjectResourceWrite(async () => {
        const nextWorkspace = await window.electronAPI!.updateProjectSettings({
          variables: nextVariables,
        });
        if (nextWorkspace.projectRevision) {
          if (projectStoryTextCacheRef.current) {
            projectStoryTextCacheRef.current.projectRevision = nextWorkspace.projectRevision;
          }
          setProjectVariableReferenceScan((current) => ({
            ...current,
            projectRevision: nextWorkspace.projectRevision,
          }));
        }
        return nextWorkspace;
      });
    },
    [queueProjectResourceWrite, workspace?.project],
  );

  const restoreProjectSettingsFromHistory = useCallback(
    (
      state: Pick<
        EditorHistoryState,
        | 'projectVariables'
        | 'events'
        | 'signals'
        | 'engineTypes'
        | 'projectSettings'
        | 'localization'
      >,
    ) => {
      if (!workspace?.project || !window.electronAPI) return;
      const projectVariables = [...structuredClone(state.projectVariables)];
      const events = [...structuredClone(state.events)];
      const signals = [...structuredClone(state.signals)];
      const engineTypes = [...structuredClone(state.engineTypes)];
      const projectSettings = structuredClone(state.projectSettings);
      setWorkspace((current) =>
        current?.project
          ? {
              ...current,
              project: {
                ...current.project,
                variables: projectVariables,
                events,
                signals,
                engineTypes,
                ...(projectSettings ?? {}),
              },
            }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.updateProjectSettings({
          variables: projectVariables,
          events,
          signals,
          engineTypes,
          ...projectSettings,
        }),
      );
      if (state.localization && workspace.project.localizationPath) {
        queueProjectResourceWrite(() =>
          window.electronAPI!.updateProjectLocalization(structuredClone(state.localization!)),
        );
      }
    },
    [queueProjectResourceWrite, workspace?.project],
  );

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
    (snapshot?: EditorGraphState, label = 'Edit Node') => {
      setAIChanges(undefined);
      setAIProposal(undefined);
      history.checkpoint(
        {
          document,
          hasActiveStory,
          activeGraphId,
          graph: snapshot ?? graph,
          rootGraph: rootGraphRef.current,
          chapters,
          variables,
          characters: resolvedCharacters,
          assets,
          projectResources: projectResourceSnapshot,
          workspaceStories,
          projectVariables,
          events,
          signals,
          engineTypes,
          projectSettings: workspace?.project
            ? {
                entryStoryId: workspace.project.entryStoryId,
                outputDirectory: workspace.project.outputDirectory,
              }
            : undefined,
          localization: workspace?.localization
            ? structuredClone(workspace.localization.document)
            : undefined,
          storyFiles: [...managedStoryFilesRef.current].map(([relativePath, content]) => ({
            relativePath,
            content,
          })),
        },
        label,
      );
    },
    [
      activeGraphId,
      assets,
      chapters,
      document,
      events,
      graph,
      history,
      hasActiveStory,
      projectVariables,
      projectResourceSnapshot,
      resolvedCharacters,
      signals,
      engineTypes,
      variables,
      workspace?.localization,
      workspace?.project,
      workspaceStories,
    ],
  );

  const restoreStoryFilesFromHistory = useCallback(
    (files: readonly { relativePath: string; content: string }[]) => {
      if (!window.electronAPI) return;
      const target = new Map(files.map((file) => [file.relativePath, file.content]));
      const paths = new Set([...managedStoryFilesRef.current.keys(), ...target.keys()]);
      managedStoryFilesRef.current = new Map(target);
      for (const relativePath of paths) {
        const content = target.get(relativePath);
        storyHistoryWriteRef.current = storyHistoryWriteRef.current
          .catch(() => undefined)
          .then(async () => {
            const result = await window.electronAPI!.restoreWorkspaceStory(relativePath, content);
            setWorkspace(result.workspace);
            if (!result.story) return;
            const restoredSource = parseStorySource(result.story.content);
            const updateDocument = (candidate: StoryDocumentInfo): StoryDocumentInfo =>
              candidate.id === restoredSource.id
                ? {
                    ...candidate,
                    filePath: result.story!.filePath,
                    fileToken: result.story!.fileToken,
                  }
                : candidate;
            setDocument(updateDocument);
            setWorkspaceStories((current) =>
              current.map((story) => ({ ...story, document: updateDocument(story.document) })),
            );
          })
          .catch((error: unknown) => {
            setWorkspaceError(error instanceof Error ? error.message : String(error));
          });
      }
    },
    [],
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
      remote?: StorySourceDocument,
    ) => {
      const preview = buildStoryMergePreview(source, merged, conflicts, decisions, remote);
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

  const currentHistoryState = useCallback(
    (): EditorHistoryState => ({
      document,
      hasActiveStory,
      activeGraphId,
      graph,
      rootGraph: rootGraphRef.current,
      chapters,
      variables,
      characters: resolvedCharacters,
      assets,
      projectResources: projectResourceSnapshot,
      workspaceStories,
      projectVariables,
      events,
      signals,
      engineTypes,
      projectSettings: workspace?.project
        ? {
            entryStoryId: workspace.project.entryStoryId,
            outputDirectory: workspace.project.outputDirectory,
          }
        : undefined,
      localization: workspace?.localization
        ? structuredClone(workspace.localization.document)
        : undefined,
      storyFiles: [...managedStoryFilesRef.current].map(([relativePath, content]) => ({
        relativePath,
        content,
      })),
    }),
    [
      activeGraphId,
      assets,
      chapters,
      document,
      events,
      graph,
      hasActiveStory,
      projectResourceSnapshot,
      projectVariables,
      resolvedCharacters,
      signals,
      variables,
      workspace?.localization,
      workspace?.project,
      workspaceStories,
    ],
  );

  const applyHistoryState = useCallback(
    (next: EditorHistoryState) => {
      setDocument(next.document);
      setHasActiveStory(next.hasActiveStory);
      setActiveGraphId(next.activeGraphId);
      rootGraphRef.current = next.rootGraph;
      setChapters(next.chapters);
      restoreGraph(next.graph);
      setVariables(next.variables);
      restoreCharactersFromHistory(next.characters, next.projectResources);
      setAssets(structuredClone(next.assets));
      restoreProjectResourcesFromHistory(next.projectResources);
      setWorkspaceStories(structuredClone(next.workspaceStories));
      restoreProjectSettingsFromHistory(next);
      restoreStoryFilesFromHistory(next.storyFiles);
      setAIChanges(undefined);
      setAIProposal(undefined);
      markDirty();
    },
    [
      markDirty,
      restoreCharactersFromHistory,
      restoreGraph,
      restoreProjectResourcesFromHistory,
      restoreProjectSettingsFromHistory,
      restoreStoryFilesFromHistory,
    ],
  );

  const undo = useCallback(() => {
    const entry = history.undo(currentHistoryState());
    if (entry) applyHistoryState(entry.state);
  }, [applyHistoryState, currentHistoryState, history]);

  const redo = useCallback(() => {
    const entry = history.redo(currentHistoryState());
    if (entry) applyHistoryState(entry.state);
  }, [applyHistoryState, currentHistoryState, history]);

  const travelHistory = useCallback(
    (steps: number) => {
      const entry = history.travel(currentHistoryState(), steps);
      if (entry) applyHistoryState(entry.state);
    },
    [applyHistoryState, currentHistoryState, history],
  );

  const clearAIChanges = useCallback(() => setAIChanges(undefined), []);
  const discardAIProposal = useCallback(() => {
    setAIProposal((current) => {
      if (current?.origin === 'ink') setInkImportReport(undefined);
      return undefined;
    });
  }, []);
  const dismissInkImportReport = useCallback(() => setInkImportReport(undefined), []);
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
      options: { dryRun?: boolean; stage?: boolean; origin?: 'ai' | 'ink' } = {},
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
      const commandSource = {
        ...source,
        variables: [...source.variables, ...projectVariables],
      };
      const result = executeBlueprintCommandTransaction(commandSource, transactionValue, {
        dryRun: options.dryRun,
        semanticContext: aiSemanticContext,
      });
      if (!result.ok) return result;
      const hasCharacterOperations =
        typeof transactionValue === 'object' &&
        transactionValue !== null &&
        Array.isArray((transactionValue as Partial<BlueprintCommandTransaction>).operations) &&
        (transactionValue as BlueprintCommandTransaction).operations.some(
          (operation) =>
            operation.kind === 'add-character' || operation.kind === 'update-character',
        );
      const resultCharacters = hasCharacterOperations
        ? result.document.characters
        : resolvedCharacters;
      const compiled = compileStory({
        ...result.document,
        characters: resultCharacters,
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
      const unboundProposalGraph = applyBlueprintLayoutRequests(
        fromSourceGraph(nextSourceGraph),
        result.layoutRequests,
      );
      const proposalGraph = {
        ...unboundProposalGraph,
        nodes: unboundProposalGraph.nodes.map((node) =>
          bindCharacterFieldReferencesInNode(
            bindVariableReferencesInNode(node, result.document.variables),
            resultCharacters,
          ),
        ),
      };
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
      const beforeVariables = new Map(
        [...source.variables, ...projectVariables].map((variable) => [variable.id, variable]),
      );
      const afterVariables = new Map(
        result.document.variables.map((variable) => [variable.id, variable]),
      );
      const variableIds = new Set([...beforeVariables.keys(), ...afterVariables.keys()]);
      const variableChangeCount = [...variableIds].filter(
        (id) => JSON.stringify(beforeVariables.get(id)) !== JSON.stringify(afterVariables.get(id)),
      ).length;
      const beforeCharacters = new Map(
        resolvedCharacters.map((character) => [character.id, character]),
      );
      const afterCharacters = new Map(
        resultCharacters.map((character) => [character.id, character]),
      );
      const characterIds = new Set([...beforeCharacters.keys(), ...afterCharacters.keys()]);
      const characterChangeCount = [...characterIds].filter(
        (id) =>
          JSON.stringify(beforeCharacters.get(id)) !== JSON.stringify(afterCharacters.get(id)),
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
          origin: options.origin ?? 'ai',
          addedNodeIds: prepared.addedNodeIds,
          changedNodeIds,
          removedNodeIds: prepared.removedNodeIds,
          layoutNodeIds: movedNodeIds,
          variableChangeCount,
          characterChangeCount,
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
      checkpoint(
        undefined,
        stagedProposal?.origin === 'ink' ? 'Import Ink as Nodes' : 'Apply AI Changes',
      );
      restoreGraph(committedGraph);
      setChapters(
        result.document.chapters.map((chapter) => ({
          ...chapter,
          graph: fromSourceGraph(chapter.graph),
        })),
      );
      const nextProjectVariables = result.document.variables.filter(
        (variable) => variable.scope === 'project',
      );
      setVariables(
        structuredClone(
          result.document.variables.filter((variable) => variable.scope !== 'project'),
        ),
      );
      if (JSON.stringify(nextProjectVariables) !== JSON.stringify(projectVariables)) {
        writeProjectVariables(nextProjectVariables);
      }
      for (const [id, character] of afterCharacters) {
        const previous = beforeCharacters.get(id);
        if (previous && JSON.stringify(previous) === JSON.stringify(character)) continue;
        if (previous) {
          updateCharacterRef.current(id, structuredClone(character));
        } else if (workspace?.project && window.electronAPI) {
          queueProjectResourceWrite(() =>
            window.electronAPI!.createProjectCharacter(structuredClone(character)),
          );
        } else {
          setCharacters((current) => [...current, structuredClone(character)]);
        }
      }
      setAIProposal(undefined);
      if (stagedProposal?.origin === 'ink') setInkImportReport(undefined);
      setAIChanges(
        stagedProposal?.origin === 'ink'
          ? undefined
          : stagedProposal
            ? undefined
            : {
                nonce: Date.now(),
                addedNodeIds: prepared.addedNodeIds,
                changedNodeIds,
                removedNodeIds: prepared.removedNodeIds,
                layoutNodeIds: movedNodeIds,
                variableChangeCount,
                characterChangeCount,
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
      projectVariables,
      resolvedAssets,
      resolvedCharacters,
      restoreGraph,
      setChapters,
      queueProjectResourceWrite,
      signals,
      source,
      workspace?.project,
      writeProjectVariables,
    ],
  );

  const applyAIProposal = useCallback(
    () =>
      aiProposal
        ? executeBlueprintCommands(aiProposal.transaction, { origin: aiProposal.origin })
        : undefined,
    [aiProposal, executeBlueprintCommands],
  );

  const importInkFile = useCallback(async () => {
    if (!hasActiveStory || !window.electronAPI) return;
    try {
      const opened = await window.electronAPI.openInkFile();
      if (opened.canceled) return;
      const imported = buildInkImportTransaction(opened.content, {
        revision: semanticSnapshot.revision,
        chapterId: activeGraphId === 'root' ? undefined : activeGraphId,
        characters: resolvedCharacters,
        assets: resolvedAssets,
        variables: [...availableVariables, ...projectVariables],
      });
      if (!imported.ok) {
        setInkImportReport({ filePath: opened.filePath, diagnostics: imported.diagnostics });
        setAIProposal(undefined);
        return;
      }
      const result = executeBlueprintCommands(imported.transaction, {
        dryRun: true,
        stage: true,
        origin: 'ink',
      });
      if (!result.ok) {
        setInkImportReport({
          filePath: opened.filePath,
          diagnostics: result.diagnostics.map((item) => ({
            severity: 'error' as const,
            line: 1,
            column: 1,
            message: item.message,
          })),
          summary: imported.summary,
        });
        return;
      }
      setInkImportReport({
        filePath: opened.filePath,
        diagnostics: imported.diagnostics,
        summary: imported.summary,
      });
    } catch (error) {
      setInkImportReport({
        diagnostics: [
          {
            severity: 'error',
            line: 1,
            column: 1,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }, [
    activeGraphId,
    availableVariables,
    executeBlueprintCommands,
    hasActiveStory,
    projectVariables,
    resolvedAssets,
    resolvedCharacters,
    semanticSnapshot.revision,
  ]);

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

      checkpoint(undefined, `Add ${nodeRegistry.get(type)?.label ?? 'Node'}`);
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
      outputs: [],
      localVariables: [],
      graph: createNewSubstoryGraph(),
    };
    checkpoint(undefined, 'Add Substory');
    if (activeGraphId === 'root') rootGraphRef.current = structuredClone(graph);
    setChapters((current) => [
      ...current.map((item) =>
        item.id === activeGraphId ? { ...item, graph: structuredClone(graph) } : item,
      ),
      chapter,
    ]);
    setActiveGraphId(id);
    restoreGraph(structuredClone(chapter.graph));
    markDirty();
    return id;
  }, [activeGraphId, checkpoint, graph, markDirty, nextSubstoryIdentity, restoreGraph]);

  const updateSubstory = useCallback(
    (
      id: ChapterId,
      update: Partial<
        Pick<EditorChapter, 'name' | 'displayName' | 'parameters' | 'outputs' | 'localVariables'>
      >,
    ) => {
      const previous = chapters.find((chapter) => chapter.id === id);
      if (!previous) return;
      const next = { ...previous, ...update, id };
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      const editsInterface =
        update.parameters !== undefined ||
        update.outputs !== undefined ||
        update.localVariables !== undefined;
      checkpoint(undefined, editsInterface ? 'Edit Substory Interface' : 'Rename Substory');
      const rewriteReturns = (candidate: EditorGraphState): EditorGraphState => ({
        ...candidate,
        nodes: candidate.nodes.map((node) => {
          if (node.type !== StoryNodeType.Return) return node;
          const data = node.data as StoryNodeDataMap[StoryNodeType.Return];
          return {
            ...node,
            data: {
              ...data,
              values: Object.fromEntries(
                next.outputs.map((output) => {
                  const previousOutput = previous.outputs.find(
                    (candidate) => candidate.variable.id === output.variable.id,
                  );
                  const fallback =
                    output.variable.valueType.kind === 'boolean'
                      ? 'false'
                      : output.variable.valueType.kind === 'number'
                        ? '0'
                        : '""';
                  return [
                    output.variable.id,
                    previousOutput?.variable.valueType.kind === output.variable.valueType.kind &&
                    data.values?.[output.variable.id]
                      ? data.values[output.variable.id]
                      : { source: fallback, bindings: {} },
                  ];
                }),
              ),
            },
          };
        }),
      });
      const previousInterfaceVariables = new Map(
        [
          ...previous.parameters.map((parameter) => parameter.variable),
          ...previous.outputs.map((output) => output.variable),
          ...previous.localVariables,
        ].map((variable) => [variable.id, variable]),
      );
      const renamedInterfaceVariables = [
        ...next.parameters.map((parameter) => parameter.variable),
        ...next.outputs.map((output) => output.variable),
        ...next.localVariables,
      ].flatMap((variable) => {
        const oldVariable = previousInterfaceVariables.get(variable.id);
        return oldVariable && oldVariable.name !== variable.name
          ? [{ id: variable.id, oldName: oldVariable.name, newName: variable.name }]
          : [];
      });
      const rewriteInterfaceGraph = (candidate: EditorGraphState): EditorGraphState =>
        rewriteReturns({
          ...candidate,
          nodes: candidate.nodes.map((node) =>
            renamedInterfaceVariables.reduce(
              (current, rename) =>
                renameVariableReferencesInNode(current, rename.id, rename.oldName, rename.newName),
              node,
            ),
          ),
        });
      setChapters((current) =>
        current.map((chapter) =>
          chapter.id === id
            ? {
                ...chapter,
                ...update,
                id,
                graph:
                  editsInterface && activeGraphId !== id
                    ? rewriteInterfaceGraph(chapter.graph)
                    : chapter.graph,
              }
            : chapter,
        ),
      );
      if (editsInterface) {
        if (activeGraphId === id) {
          setNodes((current) => rewriteInterfaceGraph({ nodes: current, edges }).nodes);
        }
        const parameterIds = new Set(next.parameters.map((parameter) => parameter.variable.id));
        const outputIds = new Set(next.outputs.map((output) => output.variable.id));
        const rewriteCalls = (candidate: EditorGraphState): EditorGraphState => ({
          ...candidate,
          nodes: candidate.nodes.map((node) => {
            if (node.type !== StoryNodeType.CallSubstory || node.data.chapterId !== id) return node;
            const data = node.data as StoryNodeDataMap[StoryNodeType.CallSubstory];
            return {
              ...node,
              data: {
                ...data,
                arguments: Object.fromEntries(
                  Object.entries(data.arguments ?? {}).filter(([parameterId]) =>
                    parameterIds.has(parameterId as VariableId),
                  ),
                ),
                resultVariableIds: Object.fromEntries(
                  Object.entries(data.resultVariableIds ?? {}).filter(([outputId]) =>
                    outputIds.has(outputId as VariableId),
                  ),
                ),
              },
            };
          }),
        });
        setNodes((current) => rewriteCalls({ nodes: current, edges }).nodes);
        updateInactiveGraphs(rewriteCalls);
      }
      markDirty();
    },
    [activeGraphId, chapters, checkpoint, edges, markDirty, setNodes, updateInactiveGraphs],
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
      checkpoint(undefined, 'Delete Substory');
      if (activeGraphId === id) {
        setActiveGraphId('root');
        restoreGraph(structuredClone(rootGraphRef.current));
      }
      setChapters((current) => current.filter((chapter) => chapter.id !== id));
      markDirty();
      return undefined;
    },
    [activeGraphId, chapters, checkpoint, graph, markDirty, restoreGraph],
  );

  const extractSelectionToSubstory = useCallback(():
    { ok: true; chapterId: ChapterId } | { ok: false; message: string } => {
    const id = createStableId('chapter');
    const extracted = extractGraphSelection(graph, id);
    if (!extracted.ok) return extracted;
    const identity = nextSubstoryIdentity();
    checkpoint(undefined, 'Extract to Substory');
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
        outputs: [],
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
    checkpoint(undefined, 'Merge Dialogue Nodes');
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
      checkpoint(undefined, 'Split Dialogue Lines');
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
        const graphs = [
          { name: 'Main Story', graph: merged.root },
          ...merged.chapters.map((chapter) => ({
            name: chapter.displayName,
            graph: chapter.graph,
          })),
        ];
        for (const candidate of graphs) {
          const entryCount = candidate.graph.nodes.filter(
            (node) => node.type === StoryNodeType.Start,
          ).length;
          if (entryCount > 1) {
            return {
              ok: false,
              message: `${candidate.name} contains multiple Start nodes. Keep exactly one entry before applying the merge.`,
            };
          }
        }
        fromSourceGraph(merged.root);
        for (const chapter of merged.chapters) fromSourceGraph(chapter.graph);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      const compiled = compileStory({
        ...merged,
        variables: [...merged.variables, ...projectVariables],
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
    [events, projectVariables, resolvedAssets, resolvedCharacters, signals, source.id],
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
      checkpoint(undefined, 'Apply Story Merge');
      rootGraphRef.current = structuredClone(nextRoot);
      setChapters(nextChapters);
      setActiveGraphId(nextActiveGraphId);
      restoreGraph(structuredClone(nextGraph));
      setVariables([...structuredClone(merged.variables)]);
      revisionRef.current += 1;
      window.electronAPI.setStoryDirty(false);
      if (gitConflictRevision) {
        setWorkspace(await window.electronAPI.refreshWorkspace());
      }
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

  const addVariable = useCallback((requestedName?: string): VariableId => {
    const id = createStableId('variable');
    checkpoint(undefined, 'Add Variable');
    setVariables((current) => {
      const used = new Set(current.map((variable) => variable.name));
      let index = current.length + 1;
      let name = requestedName?.trim() || `variable${index}`;
      if (used.has(name)) name = `variable${index}`;
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

  const addProjectVariable = useCallback((requestedName?: string): VariableId | undefined => {
    if (!workspace?.project) return undefined;
    const id = createStableId('variable');
    const used = new Set([...variables, ...projectVariables].map((variable) => variable.name));
    let index = projectVariables.length + 1;
    let name = requestedName?.trim() || `projectVariable${index}`;
    if (used.has(name)) name = `projectVariable${index}`;
    while (used.has(name)) name = `projectVariable${++index}`;
    checkpoint(undefined, 'Add Project Variable');
    writeProjectVariables([
      ...projectVariables,
      {
        id,
        name,
        displayName: name,
        scope: 'project',
        valueType: { kind: 'string' },
        defaultValue: '',
      },
    ]);
    return id;
  }, [checkpoint, projectVariables, variables, workspace?.project, writeProjectVariables]);

  const variableReferenceGraphs = useCallback((): VariableReferenceGraph[] => {
    const root = activeGraphId === 'root' ? graph : rootGraphRef.current;
    return [
      { id: 'root', label: 'Main Story', graph: root },
      ...chapters.map((chapter) => ({
        id: chapter.id,
        label: chapter.displayName,
        graph: activeGraphId === chapter.id ? graph : chapter.graph,
      })),
    ];
  }, [activeGraphId, chapters, graph]);

  const findVariableReferencesById = useCallback(
    (id: VariableId): readonly VariableReference[] => {
      const variable =
        variables.find((candidate) => candidate.id === id) ??
        projectVariables.find((candidate) => candidate.id === id) ??
        chapters
          .flatMap((chapter) => [
            ...chapter.parameters.map((parameter) => parameter.variable),
            ...chapter.outputs.map((output) => output.variable),
            ...chapter.localVariables,
          ])
          .find((candidate) => candidate.id === id) ??
        resolvedCharacters
          .flatMap((character) => character.fields ?? [])
          .find((candidate) => candidate.id === id);
      if (!variable) return [];
      if (variable.scope !== 'project') {
        return collectVariableReferences(variable, variableReferenceGraphs());
      }
      const loadedStories = currentStoryItemsRef.current();
      const loadedStoryIds = new Set(loadedStories.map((story) => story.document.id));
      const liveReferences = loadedStories.flatMap((story) =>
        collectVariableReferences(variable, [
          {
            storyId: story.document.id,
            storyPath: workspace?.project?.stories.find(
              (candidate) => candidate.id === story.document.id,
            )?.path,
            id: 'root',
            label: `${story.document.displayName} / Main Story`,
            graph: story.rootGraph,
          },
          ...story.chapters.map((chapter) => ({
            storyId: story.document.id,
            storyPath: workspace?.project?.stories.find(
              (candidate) => candidate.id === story.document.id,
            )?.path,
            id: chapter.id,
            label: `${story.document.displayName} / ${chapter.displayName}`,
            graph: chapter.graph,
          })),
        ]),
      );
      const indexedReferences =
        projectVariableReferenceScan.variableId === id
          ? projectVariableReferenceScan.references.filter(
              (reference) => !reference.storyId || !loadedStoryIds.has(reference.storyId),
            )
          : [];
      return [...liveReferences, ...indexedReferences];
    },
    [
      projectVariableReferenceScan.references,
      projectVariableReferenceScan.variableId,
      projectVariables,
      chapters,
      resolvedCharacters,
      variableReferenceGraphs,
      variables,
      workspace?.project?.stories,
    ],
  );

  const updateVariable = useCallback(
    (id: VariableId, update: Partial<VariableDefinition>): boolean => {
      const projectVariable = projectVariables.find((variable) => variable.id === id);
      const substory = chapters.find((chapter) =>
        [
          ...chapter.parameters.map((parameter) => parameter.variable),
          ...chapter.outputs.map((output) => output.variable),
          ...chapter.localVariables,
        ].some((variable) => variable.id === id),
      );
      const substoryVariables = substory
        ? [
            ...substory.parameters.map((parameter) => parameter.variable),
            ...substory.outputs.map((output) => output.variable),
            ...substory.localVariables,
          ]
        : [];
      const allNamedVariables = [...variables, ...projectVariables, ...substoryVariables];
      if (
        update.name !== undefined &&
        (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(update.name) ||
          allNamedVariables.some((variable) => variable.id !== id && variable.name === update.name))
      ) {
        return false;
      }
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const previous =
        projectVariable ??
        variables.find((variable) => variable.id === id) ??
        substoryVariables.find((variable) => variable.id === id);
      if (!previous) return false;
      if (substory) {
        const normalized = { ...nextUpdate, scope: 'local' as const };
        updateSubstory(substory.id, {
          parameters: substory.parameters.map((parameter) =>
            parameter.variable.id === id
              ? { ...parameter, variable: { ...parameter.variable, ...normalized, id } }
              : parameter,
          ),
          outputs: substory.outputs.map((output) =>
            output.variable.id === id
              ? { ...output, variable: { ...output.variable, ...normalized, id } }
              : output,
          ),
          localVariables: substory.localVariables.map((variable) =>
            variable.id === id ? { ...variable, ...normalized, id } : variable,
          ),
        });
        return true;
      }
      if (projectVariable) {
        const requiresCompleteIndex = update.name !== undefined || update.valueType !== undefined;
        if (
          requiresCompleteIndex &&
          (projectVariableReferenceScan.loading ||
            projectVariableReferenceScan.variableId !== id ||
            projectVariableReferenceScan.error ||
            !projectVariableReferenceScan.stories ||
            !projectVariableReferenceScan.projectRevision)
        ) {
          setWorkspaceError(
            projectVariableReferenceScan.error ??
              'Wait for the full project variable reference scan before renaming or changing type.',
          );
          return false;
        }
        const references = findVariableReferencesById(id);
        if (
          update.valueType !== undefined &&
          update.valueType.kind !== previous.valueType.kind &&
          references.length > 0
        ) {
          setWorkspaceError('Remove or migrate all references before changing this variable type.');
          return false;
        }
        const normalized = { ...nextUpdate, scope: 'project' as const };
        const nextProjectVariables = projectVariables.map((variable) =>
          variable.id === id ? { ...variable, ...normalized, id } : variable,
        );
        checkpoint(undefined, 'Edit Project Variable');
        if (normalized.name && normalized.name !== previous.name) {
          const affectedStoryIds = new Set(
            references
              .filter((reference) => reference.kind !== 'target')
              .flatMap((reference) => (reference.storyId ? [reference.storyId] : [])),
          );
          const loadedStoryIds = new Set(
            currentStoryItemsRef.current().map((story) => story.document.id),
          );
          const unopenedStoryIds = new Set(
            [...affectedStoryIds].filter((storyId) => !loadedStoryIds.has(storyId)),
          );
          const rewrite = (candidate: EditorGraphState): EditorGraphState => ({
            ...candidate,
            nodes: candidate.nodes.map((node) =>
              renameVariableReferencesInNode(node, id, previous.name, normalized.name!),
            ),
          });
          if (affectedStoryIds.has(document.id)) {
            setNodes((current) => rewrite({ nodes: current, edges }).nodes);
            updateInactiveGraphs(rewrite);
            markDirty();
          }
          if (affectedStoryIds.size > 0) {
            setWorkspaceStories((current) =>
              current.map((story) =>
                affectedStoryIds.has(story.document.id)
                  ? {
                      ...story,
                      rootGraph: rewrite(story.rootGraph),
                      chapters: story.chapters.map((chapter) => ({
                        ...chapter,
                        graph: rewrite(chapter.graph),
                      })),
                      document: { ...story.document, dirty: true },
                      revision: story.revision + 1,
                    }
                  : story,
              ),
            );
          }
          const scannedStories = projectVariableReferenceScan.stories!;
          const rewritten = rewriteProjectVariableReferences(
            scannedStories,
            unopenedStoryIds,
            id,
            previous.name,
            normalized.name,
          );
          const revisionsByPath = new Map(
            scannedStories.map((story) => [story.path, story.revision]),
          );
          projectStoryTextCacheRef.current = undefined;
          queueProjectResourceWrite(async () => {
            try {
              return await window.electronAPI!.updateWorkspaceProjectStories({
                files: rewritten.map((file) => ({
                  ...file,
                  expectedRevision: revisionsByPath.get(file.path)!,
                })),
                projectVariables: nextProjectVariables,
                expectedProjectRevision: projectVariableReferenceScan.projectRevision!,
              });
            } catch (error) {
              setProjectVariableReferenceScan((current) => ({
                ...current,
                loading: false,
                error: `${error instanceof Error ? error.message : String(error)} Rescan project Stories and try again.`,
              }));
              throw error;
            }
          });
          return true;
        }
        writeProjectVariables(nextProjectVariables);
        return true;
      }
      checkpoint(undefined, 'Edit Variable');
      if (previous && nextUpdate.name && nextUpdate.name !== previous.name) {
        setNodes((current) =>
          current.map((node) =>
            renameVariableReferencesInNode(node, id, previous.name, nextUpdate.name!),
          ),
        );
        updateInactiveGraphs((candidate) => ({
          ...candidate,
          nodes: candidate.nodes.map((node) =>
            renameVariableReferencesInNode(node, id, previous.name, nextUpdate.name!),
          ),
        }));
      }
      setVariables((current) =>
        current.map((variable) =>
          variable.id === id ? { ...variable, ...nextUpdate, id } : variable,
        ),
      );
      markDirty();
      return true;
    },
    [
      checkpoint,
      chapters,
      document.id,
      edges,
      findVariableReferencesById,
      markDirty,
      projectVariables,
      projectVariableReferenceScan.error,
      projectVariableReferenceScan.loading,
      projectVariableReferenceScan.stories,
      projectVariableReferenceScan.variableId,
      queueProjectResourceWrite,
      rewriteProjectVariableReferences,
      setNodes,
      updateInactiveGraphs,
      updateSubstory,
      variables,
      writeProjectVariables,
    ],
  );

  const removeVariable = useCallback(
    (id: VariableId): { ok: true } | { ok: false; references: readonly VariableReference[] } => {
      if (
        projectVariables.some((variable) => variable.id === id) &&
        (projectVariableReferenceScan.loading ||
          projectVariableReferenceScan.variableId !== id ||
          projectVariableReferenceScan.error)
      ) {
        setWorkspaceError(
          projectVariableReferenceScan.error ??
            'Wait for the full project variable reference scan before deleting this variable.',
        );
        return { ok: false, references: [] };
      }
      const references = findVariableReferencesById(id);
      if (references.length > 0) return { ok: false, references };
      if (projectVariables.some((variable) => variable.id === id)) {
        checkpoint(undefined, 'Delete Project Variable');
        setStoryDataSelection((current) =>
          current?.kind === 'variable' && current.id === id ? undefined : current,
        );
        writeProjectVariables(projectVariables.filter((variable) => variable.id !== id));
        return { ok: true };
      }
      const substory = chapters.find((chapter) =>
        [
          ...chapter.parameters.map((parameter) => parameter.variable),
          ...chapter.outputs.map((output) => output.variable),
          ...chapter.localVariables,
        ].some((variable) => variable.id === id),
      );
      if (substory) {
        setStoryDataSelection((current) =>
          current?.kind === 'variable' && current.id === id ? undefined : current,
        );
        updateSubstory(substory.id, {
          parameters: substory.parameters.filter((parameter) => parameter.variable.id !== id),
          outputs: substory.outputs.filter((output) => output.variable.id !== id),
          localVariables: substory.localVariables.filter((variable) => variable.id !== id),
        });
        return { ok: true };
      }
      checkpoint(undefined, 'Delete Variable');
      setStoryDataSelection((current) =>
        current?.kind === 'variable' && current.id === id ? undefined : current,
      );
      setVariables((current) => current.filter((variable) => variable.id !== id));
      markDirty();
      return { ok: true };
    },
    [
      checkpoint,
      chapters,
      findVariableReferencesById,
      markDirty,
      projectVariableReferenceScan.error,
      projectVariableReferenceScan.loading,
      projectVariableReferenceScan.variableId,
      projectVariables,
      updateSubstory,
      writeProjectVariables,
    ],
  );

  const addCharacter = useCallback((requestedName?: string): CharacterId => {
    const id = createStableId('character');
    const index = resolvedCharacters.length + 1;
    const usedNames = new Set(resolvedCharacters.map((character) => character.name));
    let name = requestedName?.trim() || `character${index}`;
    let suffix = index;
    while (usedNames.has(name)) name = `character${++suffix}`;
    const character: CharacterSource = {
      id,
      name,
      displayName: name,
      emotions: { neutral: { displayName: 'Neutral' } },
    };
    if (workspace?.project && window.electronAPI) {
      checkpoint(undefined, 'Add Character');
      queueProjectResourceWrite(() => window.electronAPI!.createProjectCharacter(character));
      return id;
    }
    checkpoint(undefined, 'Add Character');
    setCharacters((current) => {
      return [...current, character];
    });
    markDirty();
    return id;
  }, [
    checkpoint,
    markDirty,
    queueProjectResourceWrite,
    resolvedCharacters,
    workspace?.project,
  ]);

  const duplicateCharacter = useCallback(
    (id: CharacterId): CharacterId | undefined => {
      const source = resolvedCharacters.find((candidate) => candidate.id === id);
      if (!source) return undefined;
      const usedNames = new Set(resolvedCharacters.map((candidate) => candidate.name));
      const character = duplicateCharacterDefinition(
        source,
        usedNames,
        () => createStableId('character'),
        () => createStableId('variable'),
      );
      if (workspace?.project && window.electronAPI) {
        checkpoint(undefined, 'Duplicate Character');
        queueProjectResourceWrite(() => window.electronAPI!.createProjectCharacter(character));
      } else {
        checkpoint(undefined, 'Duplicate Character');
        setCharacters((current) => [...current, character]);
        markDirty();
      }
      return character.id;
    },
    [checkpoint, markDirty, queueProjectResourceWrite, resolvedCharacters, workspace?.project],
  );

  const addCharacterFromTemplate = useCallback(
    (template: CharacterTemplateSource, requestedName?: string): CharacterId => {
      const id = createStableId('character');
      const index = resolvedCharacters.length + 1;
      const usedNames = new Set(resolvedCharacters.map((character) => character.name));
      let name = requestedName?.trim() || `character${index}`;
      let suffix = index;
      while (usedNames.has(name)) name = `character${++suffix}`;
      const character = characterFromTemplate(
        template,
        id,
        name,
        name,
        () => createStableId('variable'),
      );
      if (workspace?.project && window.electronAPI) {
        checkpoint(undefined, 'Add Character from Template');
        queueProjectResourceWrite(() => window.electronAPI!.createProjectCharacter(character));
      } else {
        checkpoint(undefined, 'Add Character from Template');
        setCharacters((current) => [...current, character]);
        markDirty();
      }
      return id;
    },
    [
      checkpoint,
      markDirty,
      queueProjectResourceWrite,
      resolvedCharacters,
      workspace?.project,
    ],
  );

  const saveCharacterAsTemplate = useCallback(
    async (id: CharacterId) => {
      const character = resolvedCharacters.find((candidate) => candidate.id === id);
      if (!character || !window.electronAPI || !workspace?.project) return;
      const baseName = `${character.name}_template`;
      const used = new Set(workspace.characterTemplates.map((item) => item.template.name));
      let name = baseName;
      let suffix = 2;
      while (used.has(name)) name = `${baseName}${suffix++}`;
      try {
        setWorkspace(
          await window.electronAPI.saveCharacterTemplate(
            characterToTemplate(character, name, `${character.displayName} Template`),
          ),
        );
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [resolvedCharacters, workspace?.characterTemplates, workspace?.project],
  );

  const rewriteCharacterFieldReferences = useCallback(
    (
      renames: readonly {
        fieldId: VariableId;
        oldQualifiedName: string;
        newQualifiedName: string;
      }[],
    ) => {
      if (renames.length === 0) return;
      const rewrite = (candidate: EditorGraphState): EditorGraphState => ({
        ...candidate,
        nodes: candidate.nodes.map((node) =>
          renames.reduce(
            (current, rename) =>
              renameCharacterFieldReferencesInNode(
                current,
                rename.fieldId,
                rename.oldQualifiedName,
                rename.newQualifiedName,
              ),
            node,
          ),
        ),
      });
      setNodes((current) => rewrite({ nodes: current, edges }).nodes);
      updateInactiveGraphs(rewrite);
      setWorkspaceStories((current) =>
        current.map((story) => ({
          ...story,
          rootGraph: rewrite(story.rootGraph),
          chapters: story.chapters.map((chapter) => ({
            ...chapter,
            graph: rewrite(chapter.graph),
          })),
          document: { ...story.document, dirty: true },
          revision: story.revision + 1,
        })),
      );
      markDirty();
    },
    [edges, markDirty, setNodes, updateInactiveGraphs],
  );

  const updateCharacter = useCallback(
    (
      id: CharacterId,
      update: Partial<CharacterSource>,
      options: { recordHistory?: boolean } = {},
    ) => {
      const nextUpdate =
        update.name !== undefined && update.displayName === undefined
          ? { ...update, displayName: update.name }
          : update;
      const previous = resolvedCharacters.find((candidate) => candidate.id === id);
      if (previous) {
        const nextName = nextUpdate.name ?? previous.name;
        const nextFields = nextUpdate.fields ?? previous.fields ?? [];
        const referenceIndex =
          resourceReferenceIndexRef.current ??
          buildStoryResourceReferenceIndex(
            resourceReferenceStories(currentStoryItemsRef.current()),
            resourceReferenceCharacters(
              currentStoryItemsRef.current(),
              workspace?.characterResources.map((candidate) => candidate.character) ?? [],
            ),
          );
        const unsafeField = (previous.fields ?? []).find((field) => {
          const nextField = nextFields.find((candidate) => candidate.id === field.id);
          return (
            (!nextField || nextField.valueType.kind !== field.valueType.kind) &&
            (referenceIndex.characterFields.get(field.id)?.length ?? 0) > 0
          );
        });
        if (unsafeField) {
          setWorkspaceError(
            `Character field ${previous.name}.${unsafeField.name} is referenced. Remove its references before deleting it or changing its type.`,
          );
          return;
        }
        const renames = (previous.fields ?? []).flatMap((field) => {
          const nextField = nextFields.find((candidate) => candidate.id === field.id);
          if (!nextField) return [];
          const oldQualifiedName = `${previous.name}.${field.name}`;
          const newQualifiedName = `${nextName}.${nextField.name}`;
          return oldQualifiedName === newQualifiedName
            ? []
            : [{ fieldId: field.id, oldQualifiedName, newQualifiedName }];
        });
        if (options.recordHistory !== false) checkpoint(undefined, 'Edit Character');
        rewriteCharacterFieldReferences(renames);
      }
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
    [
      markDirty,
      checkpoint,
      queueProjectResourceWrite,
      resolvedCharacters,
      rewriteCharacterFieldReferences,
      workspace?.characterResources,
    ],
  );
  updateCharacterRef.current = updateCharacter;

  const rewriteCharacterEmotionReferences = useCallback(
    (id: CharacterId, fromEmotion: string, toEmotion?: string) => {
      const rewrite = (candidate: EditorGraphState) =>
        replaceCharacterEmotionReferences(candidate, id, fromEmotion, toEmotion);
      setNodes((current) => rewrite({ nodes: current, edges }).nodes);
      updateInactiveGraphs(rewrite);
      setWorkspaceStories((current) =>
        current.map((story) => ({
          ...story,
          rootGraph: rewrite(story.rootGraph),
          chapters: story.chapters.map((chapter) => ({
            ...chapter,
            graph: rewrite(chapter.graph),
          })),
          document: { ...story.document, dirty: true },
          revision: story.revision + 1,
        })),
      );
      markDirty();
    },
    [edges, markDirty, setNodes, updateInactiveGraphs],
  );

  const renameCharacterEmotion = useCallback(
    (id: CharacterId, fromEmotion: string, toEmotion: string) => {
      if (fromEmotion === toEmotion) return;
      const character = resolvedCharacters.find((candidate) => candidate.id === id);
      const definition = character?.emotions[fromEmotion];
      if (!character || !definition || !toEmotion || character.emotions[toEmotion]) return;
      const emotions = Object.fromEntries(
        Object.entries(character.emotions).map(([key, value]) =>
          key === fromEmotion ? [toEmotion, value] : [key, value],
        ),
      );
      checkpoint(undefined, 'Rename Emotion');
      rewriteCharacterEmotionReferences(id, fromEmotion, toEmotion);
      updateCharacter(id, { emotions }, { recordHistory: false });
    },
    [checkpoint, resolvedCharacters, rewriteCharacterEmotionReferences, updateCharacter],
  );

  const removeCharacterEmotion = useCallback(
    (id: CharacterId, emotion: string) => {
      const character = resolvedCharacters.find((candidate) => candidate.id === id);
      if (!character?.emotions[emotion]) return;
      const references =
        resourceReferenceIndexRef.current?.emotions.get(emotionReferenceKey(id, emotion)) ??
        collectEmotionReferences(
          id,
          emotion,
          resourceReferenceStories(currentStoryItemsRef.current()),
        );
      if (references.length > 0) {
        setWorkspaceError('Emotion is used by Dialogue lines. Remove its references first.');
        return;
      }
      const emotions = Object.fromEntries(
        Object.entries(character.emotions).filter(([key]) => key !== emotion),
      );
      checkpoint(undefined, 'Delete Emotion');
      rewriteCharacterEmotionReferences(id, emotion);
      updateCharacter(id, { emotions }, { recordHistory: false });
    },
    [checkpoint, resolvedCharacters, rewriteCharacterEmotionReferences, updateCharacter],
  );

  const removeCharacter = useCallback(
    (id: CharacterId) => {
      const characterDefinition = resolvedCharacters.find((candidate) => candidate.id === id);
      const referenceIndex =
        resourceReferenceIndexRef.current ??
        buildStoryResourceReferenceIndex(
          resourceReferenceStories(currentStoryItemsRef.current()),
          resourceReferenceCharacters(
            currentStoryItemsRef.current(),
            workspace?.characterResources.map((candidate) => candidate.character) ?? [],
          ),
        );
      const references = [
        ...(referenceIndex.characters.get(id) ?? []),
        ...(characterDefinition?.fields ?? []).flatMap(
          (field) => referenceIndex.characterFields.get(field.id) ?? [],
        ),
      ];
      if (references.length > 0) {
        setWorkspaceError(
          'Character is used by Story data, relationships, or Engine JSON. Remove its references first.',
        );
        return;
      }
      const resource = workspace?.characterResources.find(
        (candidate) => candidate.character.id === id,
      );
      if (resource && window.electronAPI) {
        queueProjectResourceWrite(async () => {
          const result = await window.electronAPI!.deleteProjectCharacter(resource.relativePath);
          if (!result.canceled) {
            checkpoint(undefined, 'Delete Character');
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
      checkpoint(undefined, 'Delete Character');
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
      checkpoint,
      queueProjectResourceWrite,
      resolvedCharacters,
      setNodes,
      updateInactiveGraphs,
      characters,
      workspace?.characterResources,
    ],
  );

  const addAsset = useCallback((requestedName?: string): AssetId => {
    const id = createStableId('asset');
    const index = resolvedAssets.length + 1;
    const usedNames = new Set(resolvedAssets.map((asset) => asset.name));
    let name = requestedName?.trim() || `voice${index}`;
    let suffix = index;
    while (usedNames.has(name)) name = `voice${++suffix}`;
    const asset: AssetSource = {
      id,
      name,
      displayName: name,
      kind: 'audio',
      locales: { default: '' },
    };
    if (workspace?.project && window.electronAPI) {
      checkpoint(undefined, 'Add Asset');
      queueProjectResourceWrite(() => window.electronAPI!.createProjectAsset(asset));
      return id;
    }
    checkpoint(undefined, 'Add Asset');
    setAssets((current) => {
      return [...current, asset];
    });
    markDirty();
    return id;
  }, [checkpoint, markDirty, queueProjectResourceWrite, resolvedAssets, workspace?.project]);

  const updateAsset = useCallback(
    (id: AssetId, update: Partial<AssetSource>) => {
      const resource = workspace?.assetResources.find((candidate) => candidate.asset.id === id);
      if (resource && window.electronAPI) {
        const asset = { ...resource.asset, ...update, id };
        if (JSON.stringify(asset) === JSON.stringify(resource.asset)) return;
        checkpoint(undefined, 'Edit Asset');
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
      const previous = assets.find((asset) => asset.id === id);
      if (!previous) return;
      const next = { ...previous, ...update, id };
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      checkpoint(undefined, 'Edit Asset');
      setAssets((current) => current.map((asset) => (asset.id === id ? next : asset)));
      markDirty();
    },
    [assets, checkpoint, markDirty, queueProjectResourceWrite, workspace?.assetResources],
  );

  const removeAsset = useCallback(
    (id: AssetId) => {
      const items = currentStoryItemsRef.current();
      const references =
        resourceReferenceIndexRef.current?.assets.get(id) ??
        collectAssetReferences(
          id,
          resourceReferenceStories(items),
          resourceReferenceCharacters(
            items,
            workspace?.characterResources.map((candidate) => candidate.character) ?? [],
          ),
        );
      if (references.length > 0) {
        setWorkspaceError('Asset is used by a Story or Character. Remove its references first.');
        return;
      }
      const resource = workspace?.assetResources.find((candidate) => candidate.asset.id === id);
      if (resource && window.electronAPI) {
        if (!window.confirm(`Delete asset "${resource.asset.displayName}"?`)) return;
        checkpoint(undefined, 'Delete Asset');
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
      checkpoint(undefined, 'Delete Asset');
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
      checkpoint,
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

  const addEvent = useCallback((requestedName?: string): EventId | undefined => {
    if (!workspace?.project) {
      setWorkspaceError('Open or create a Story project before adding events.');
      return undefined;
    }
    const id = createStableId('event');
    const used = new Set(events.map((event) => event.name));
    let index = events.length + 1;
    let name = requestedName?.trim() || `event${index}`;
    if (used.has(name)) name = `event${index}`;
    while (used.has(name)) name = `event${++index}`;
    checkpoint(undefined, 'Add Event');
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
  }, [checkpoint, events, workspace?.project, writeProjectEvents]);

  const updateEvent = useCallback(
    (id: EventId, update: Partial<EventSource>) => {
      const previous = events.find((event) => event.id === id);
      if (!previous) return;
      checkpoint(undefined, 'Edit Event');
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
                        : parameter.valueType.kind === 'json'
                          ? '{}'
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
    [checkpoint, edges, events, markDirty, setNodes, updateInactiveGraphs, writeProjectEvents],
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
      if (!window.confirm(`Delete event "${event.displayName}"?`)) return;
      checkpoint(undefined, 'Delete Event');
      setStoryDataSelection((current) =>
        current?.kind === 'event' && current.id === id ? undefined : current,
      );
      writeProjectEvents(events.filter((candidate) => candidate.id !== id));
    },
    [checkpoint, events, writeProjectEvents],
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

  const addSignal = useCallback((requestedName?: string): SignalId | undefined => {
    if (!workspace?.project) {
      setWorkspaceError('Open or create a Story project before adding signals.');
      return undefined;
    }
    const id = createStableId('signal');
    const used = new Set(signals.map((signal) => signal.name));
    let index = signals.length + 1;
    let name = requestedName?.trim() || `signal${index}`;
    if (used.has(name)) name = `signal${index}`;
    while (used.has(name)) name = `signal${++index}`;
    checkpoint(undefined, 'Add Signal');
    writeProjectSignals([...signals, { id, name, displayName: name, parameters: [] }]);
    return id;
  }, [checkpoint, signals, workspace?.project, writeProjectSignals]);

  const updateSignal = useCallback(
    (id: SignalId, update: Partial<SignalSource>) => {
      const previous = signals.find((signal) => signal.id === id);
      if (!previous) return;
      checkpoint(undefined, 'Edit Signal');
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
    [checkpoint, edges, markDirty, setNodes, signals, updateInactiveGraphs, writeProjectSignals],
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
      if (!window.confirm(`Delete signal "${signal.displayName}"?`)) return;
      checkpoint(undefined, 'Delete Signal');
      setStoryDataSelection((current) =>
        current?.kind === 'signal' && current.id === id ? undefined : current,
      );
      writeProjectSignals(signals.filter((candidate) => candidate.id !== id));
    },
    [checkpoint, signals, writeProjectSignals],
  );

  const writeEngineTypes = useCallback(
    (
      nextEngineTypes: readonly EngineTypeDefinition[],
      nextProjectVariables?: readonly VariableDefinition[],
    ) => {
      if (!workspace?.project || !window.electronAPI) return;
      setWorkspace((current) =>
        current?.project
          ? {
              ...current,
              project: {
                ...current.project,
                engineTypes: nextEngineTypes,
                ...(nextProjectVariables ? { variables: nextProjectVariables } : {}),
              },
            }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.updateProjectSettings({
          engineTypes: nextEngineTypes,
          ...(nextProjectVariables ? { variables: nextProjectVariables } : {}),
        }),
      );
    },
    [queueProjectResourceWrite, workspace?.project],
  );

  const addEngineType = useCallback((requestedName?: string): string | undefined => {
    if (!workspace?.project) {
      setWorkspaceError('Open or create a Story project before adding Engine Types.');
      return undefined;
    }
    const used = new Set(engineTypes.map((item) => item.name));
    let index = engineTypes.length + 1;
    let name = requestedName?.trim() || `EngineType${index}`;
    if (used.has(name)) name = `EngineType${index}`;
    while (used.has(name)) name = `EngineType${++index}`;
    checkpoint(undefined, 'Add Engine Type');
    writeEngineTypes([
      ...engineTypes,
      { id: createStableId('engineType'), name, displayName: name, fields: [] },
    ]);
    return name;
  }, [checkpoint, engineTypes, workspace?.project, writeEngineTypes]);

  const updateEngineType = useCallback(
    (name: string, update: EngineTypeDefinition): boolean => {
      const previous = engineTypes.find((item) => item.name === name);
      if (!previous) return false;
      if (update.name !== name) {
        const typeUsed = (valueType: VariableDefinition['valueType']) =>
          valueType.kind === 'json' && valueType.name === name;
        const referenced =
          engineTypes.some(
            (candidate) =>
              candidate.name !== name &&
              candidate.fields.some((field) => engineFieldTypeReferences(field.type, name)),
          ) ||
          [...variables, ...projectVariables].some((variable) => typeUsed(variable.valueType)) ||
          resolvedCharacters.some((character) =>
            character.fields?.some((field) => typeUsed(field.valueType)),
          ) ||
          events.some((event) =>
            event.parameters.some((parameter) => typeUsed(parameter.valueType)),
          ) ||
          signals.some((signal) =>
            signal.parameters.some((parameter) => typeUsed(parameter.valueType)),
          );
        if (referenced) {
          setWorkspaceError(
            'Rename this Engine Type before using it, or remove its references first.',
          );
          return false;
        }
        if (engineTypes.some((item) => item.name === update.name)) {
          setWorkspaceError(`Engine Type ${update.name} already exists.`);
          return false;
        }
      }
      const summary = summarizeEngineSchemaMigration(previous, update);
      const structuralChanges =
        summary.addedFields.length +
        summary.removedFields.length +
        summary.renamedFields.length +
        summary.changedTypeFields.length;
      if (structuralChanges === 0) {
        checkpoint(undefined, 'Edit Engine Type');
        writeEngineTypes(engineTypes.map((item) => (item.name === name ? update : item)));
        if (update.name !== name) {
          setStoryDataSelection({ kind: 'engine-type', name: update.name });
        }
        return true;
      }
      const nextEngineTypes = engineTypes.map((item) => (item.name === name ? update : item));
      const affectedTypeNames = new Set([name]);
      let discoveredParent = true;
      while (discoveredParent) {
        discoveredParent = false;
        for (const candidate of engineTypes) {
          if (
            !affectedTypeNames.has(candidate.name) &&
            candidate.fields.some((field) =>
              [...affectedTypeNames].some((affectedName) =>
                engineFieldTypeReferences(field.type, affectedName),
              ),
            )
          ) {
            affectedTypeNames.add(candidate.name);
            discoveredParent = true;
          }
        }
      }
      const migrateVariable = (variable: VariableDefinition): VariableDefinition => {
        if (variable.valueType.kind !== 'json' || !affectedTypeNames.has(variable.valueType.name)) {
          return variable;
        }
        const valueTypeName = variable.valueType.name;
        const previousDefinition = engineTypes.find((item) => item.name === valueTypeName);
        const nextDefinition = nextEngineTypes.find((item) => item.name === valueTypeName);
        if (!previousDefinition || !nextDefinition) return variable;
        const defaultValue = migrateEngineJsonValue(
          variable.defaultValue,
          previousDefinition,
          nextDefinition,
          engineTypes,
          nextEngineTypes,
        );
        return JSON.stringify(defaultValue) === JSON.stringify(variable.defaultValue)
          ? variable
          : { ...variable, defaultValue };
      };
      const nextVariables = variables.map(migrateVariable);
      const nextProjectVariables = projectVariables.map(migrateVariable);
      const nextChapters = chapters.map((chapter) => ({
        ...chapter,
        parameters: chapter.parameters.map((parameter) => ({
          ...parameter,
          variable: migrateVariable(parameter.variable),
        })),
        outputs: chapter.outputs.map((output) => ({
          ...output,
          variable: migrateVariable(output.variable),
        })),
        localVariables: chapter.localVariables.map(migrateVariable),
      }));
      const affectedLocations = new Set<string>();
      let migratedNodeValues = 0;
      const migrateJsonSource = (
        expression: { source: string; bindings?: Readonly<Record<string, VariableId>> },
        valueType: VariableDefinition['valueType'] | undefined,
        location: string,
      ) => {
        if (valueType?.kind !== 'json' || !affectedTypeNames.has(valueType.name)) return expression;
        const previousDefinition = engineTypes.find((item) => item.name === valueType.name);
        const nextDefinition = nextEngineTypes.find((item) => item.name === valueType.name);
        if (!previousDefinition || !nextDefinition) return expression;
        let value: RuntimeValue;
        try {
          value = JSON.parse(expression.source) as RuntimeValue;
        } catch {
          return expression;
        }
        const migrated = migrateEngineJsonValue(
          value,
          previousDefinition,
          nextDefinition,
          engineTypes,
          nextEngineTypes,
        );
        if (JSON.stringify(migrated) === JSON.stringify(value)) return expression;
        const source = JSON.stringify(migrated);
        migratedNodeValues += 1;
        affectedLocations.add(location);
        return { ...expression, source };
      };
      const migrateGraph = (
        candidate: EditorGraphState,
        ownerChapter?: EditorChapter,
      ): EditorGraphState => {
        const visibleVariables = [
          ...variables,
          ...projectVariables,
          ...(ownerChapter?.parameters.map((parameter) => parameter.variable) ?? []),
          ...(ownerChapter?.outputs.map((output) => output.variable) ?? []),
          ...(ownerChapter?.localVariables ?? []),
        ];
        return {
          ...candidate,
          nodes: candidate.nodes.map((node) => {
            if (node.type === StoryNodeType.SetVariable) {
              const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
              const variable = visibleVariables.find((item) => item.id === data.variableId);
              const value = migrateJsonSource(
                data.value,
                variable?.valueType,
                `Node ${node.id} · Set Variable`,
              );
              return value === data.value ? node : { ...node, data: { ...data, value } };
            }
            if (node.type === StoryNodeType.CallEvent) {
              const data = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
              const event = events.find((item) => item.id === data.eventId);
              if (!event) return node;
              const argumentsByName = Object.fromEntries(
                Object.entries(data.arguments).map(([argumentName, expression]) => [
                  argumentName,
                  migrateJsonSource(
                    expression,
                    event.parameters.find((parameter) => parameter.name === argumentName)
                      ?.valueType,
                    `Node ${node.id} · Event ${argumentName}`,
                  ),
                ]),
              );
              return JSON.stringify(argumentsByName) === JSON.stringify(data.arguments)
                ? node
                : { ...node, data: { ...data, arguments: argumentsByName } };
            }
            if (node.type === StoryNodeType.WaitSignal) {
              const data = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
              const signal = signals.find((item) => item.id === data.signalId);
              if (!signal) return node;
              const matches = Object.fromEntries(
                Object.entries(data.matches).map(([parameterName, expression]) => [
                  parameterName,
                  migrateJsonSource(
                    expression,
                    signal.parameters.find((parameter) => parameter.name === parameterName)
                      ?.valueType,
                    `Node ${node.id} · Signal ${parameterName}`,
                  ),
                ]),
              );
              return JSON.stringify(matches) === JSON.stringify(data.matches)
                ? node
                : { ...node, data: { ...data, matches } };
            }
            if (node.type === StoryNodeType.CallSubstory) {
              const data = node.data as StoryNodeDataMap[StoryNodeType.CallSubstory];
              const called = chapters.find((item) => item.id === data.chapterId);
              if (!called) return node;
              const argumentsById = Object.fromEntries(
                Object.entries(data.arguments ?? {}).map(([parameterId, expression]) => [
                  parameterId,
                  migrateJsonSource(
                    expression,
                    called.parameters.find((parameter) => parameter.variable.id === parameterId)
                      ?.variable.valueType,
                    `Node ${node.id} · Substory input`,
                  ),
                ]),
              );
              return JSON.stringify(argumentsById) === JSON.stringify(data.arguments ?? {})
                ? node
                : { ...node, data: { ...data, arguments: argumentsById } };
            }
            if (node.type === StoryNodeType.Return && ownerChapter) {
              const data = node.data as StoryNodeDataMap[StoryNodeType.Return];
              const values = Object.fromEntries(
                Object.entries(data.values ?? {}).map(([outputId, expression]) => [
                  outputId,
                  migrateJsonSource(
                    expression,
                    ownerChapter.outputs.find((output) => output.variable.id === outputId)?.variable
                      .valueType,
                    `Node ${node.id} · Return output`,
                  ),
                ]),
              );
              return JSON.stringify(values) === JSON.stringify(data.values ?? {})
                ? node
                : { ...node, data: { ...data, values } };
            }
            return node;
          }),
        };
      };
      const activeOwner =
        activeGraphId === 'root'
          ? undefined
          : chapters.find((chapter) => chapter.id === activeGraphId);
      const migratedActiveGraph = migrateGraph({ nodes, edges }, activeOwner);
      const migratedRootGraph =
        activeGraphId === 'root' ? migratedActiveGraph : migrateGraph(rootGraphRef.current);
      const migratedChapters = nextChapters.map((chapter) => ({
        ...chapter,
        graph:
          chapter.id === activeGraphId
            ? chapter.graph
            : migrateGraph(
                chapter.graph,
                chapters.find((item) => item.id === chapter.id),
              ),
      }));
      const migratedWorkspaceStories = workspaceStories.map((story) => {
        const storyVariables = story.variables.map(migrateVariable);
        const storyChapters = story.chapters.map((chapter) => ({
          ...chapter,
          parameters: chapter.parameters.map((parameter) => ({
            ...parameter,
            variable: migrateVariable(parameter.variable),
          })),
          outputs: chapter.outputs.map((output) => ({
            ...output,
            variable: migrateVariable(output.variable),
          })),
          localVariables: chapter.localVariables.map(migrateVariable),
          graph: migrateGraph(chapter.graph, chapter),
        }));
        const rootGraph = migrateGraph(story.rootGraph);
        const changed =
          JSON.stringify(storyVariables) !== JSON.stringify(story.variables) ||
          JSON.stringify(storyChapters) !== JSON.stringify(story.chapters) ||
          JSON.stringify(rootGraph) !== JSON.stringify(story.rootGraph);
        return {
          ...story,
          variables: storyVariables,
          chapters: storyChapters,
          rootGraph,
          document: changed ? { ...story.document, dirty: true } : story.document,
          revision: changed ? story.revision + 1 : story.revision,
        };
      });
      const characterChanges = resolvedCharacters.flatMap((character) => {
        const fields = character.fields?.map(migrateVariable);
        return fields && JSON.stringify(fields) !== JSON.stringify(character.fields)
          ? [{ character, fields }]
          : [];
      });
      nextVariables.forEach((variable, index) => {
        if (variable !== variables[index]) affectedLocations.add(`Story variable ${variable.name}`);
      });
      nextProjectVariables.forEach((variable, index) => {
        if (variable !== projectVariables[index]) {
          affectedLocations.add(`Project variable ${variable.name}`);
        }
      });
      nextChapters.forEach((chapter, chapterIndex) => {
        const previousChapter = chapters[chapterIndex];
        const before = [
          ...(previousChapter?.parameters.map((item) => item.variable) ?? []),
          ...(previousChapter?.outputs.map((item) => item.variable) ?? []),
          ...(previousChapter?.localVariables ?? []),
        ];
        const after = [
          ...chapter.parameters.map((item) => item.variable),
          ...chapter.outputs.map((item) => item.variable),
          ...chapter.localVariables,
        ];
        after.forEach((variable, index) => {
          if (JSON.stringify(variable) !== JSON.stringify(before[index])) {
            affectedLocations.add(`Substory ${chapter.displayName} · ${variable.name}`);
          }
        });
      });
      characterChanges.forEach(({ character }) =>
        affectedLocations.add(`Character ${character.displayName}`),
      );
      const affectedValues =
        nextVariables.filter((variable, index) => variable !== variables[index]).length +
        nextProjectVariables.filter((variable, index) => variable !== projectVariables[index])
          .length +
        nextChapters.reduce(
          (count, chapter, index) =>
            count +
            (JSON.stringify(chapter.parameters) !== JSON.stringify(chapters[index]?.parameters)
              ? 1
              : 0) +
            (JSON.stringify(chapter.outputs) !== JSON.stringify(chapters[index]?.outputs) ? 1 : 0) +
            (JSON.stringify(chapter.localVariables) !==
            JSON.stringify(chapters[index]?.localVariables)
              ? 1
              : 0),
          0,
        ) +
        characterChanges.length +
        migratedWorkspaceStories.filter(
          (story, index) => story.revision !== workspaceStories[index]?.revision,
        ).length +
        migratedNodeValues;
      engineTypeMigrationApplyRef.current = () => {
        checkpoint(undefined, 'Edit Engine Type');
        setVariables(nextVariables);
        setNodes(migratedActiveGraph.nodes);
        setEdges(migratedActiveGraph.edges);
        rootGraphRef.current = migratedRootGraph;
        setChapters(migratedChapters);
        setWorkspaceStories(migratedWorkspaceStories);
        for (const { character, fields } of characterChanges) {
          updateCharacter(character.id, { fields }, { recordHistory: false });
        }
        if (affectedValues > 0) markDirty();
        writeEngineTypes(nextEngineTypes, nextProjectVariables);
        if (update.name !== name) {
          setStoryDataSelection({ kind: 'engine-type', name: update.name });
        }
      };
      setEngineTypeMigrationPreview({
        typeName: previous.displayName,
        summary,
        affectedValues,
        affectedLocations: [...affectedLocations],
      });
      return false;
    },
    [
      activeGraphId,
      checkpoint,
      chapters,
      edges,
      engineTypes,
      events,
      markDirty,
      nodes,
      projectVariables,
      resolvedCharacters,
      signals,
      updateCharacter,
      variables,
      workspaceStories,
      writeEngineTypes,
    ],
  );

  const confirmEngineTypeMigration = useCallback(() => {
    const apply = engineTypeMigrationApplyRef.current;
    engineTypeMigrationApplyRef.current = undefined;
    setEngineTypeMigrationPreview(undefined);
    apply?.();
  }, []);

  const cancelEngineTypeMigration = useCallback(() => {
    engineTypeMigrationApplyRef.current = undefined;
    setEngineTypeMigrationPreview(undefined);
  }, []);

  const removeEngineType = useCallback(
    (name: string) => {
      const engineType = engineTypes.find((item) => item.name === name);
      if (!engineType) return;
      const typeUsed = (valueType: VariableDefinition['valueType']) =>
        valueType.kind === 'json' && valueType.name === name;
      const used =
        [...variables, ...projectVariables].some((variable) => typeUsed(variable.valueType)) ||
        resolvedCharacters.some((character) =>
          character.fields?.some((field) => typeUsed(field.valueType)),
        ) ||
        events.some((event) =>
          event.parameters.some((parameter) => typeUsed(parameter.valueType)),
        ) ||
        signals.some((signal) =>
          signal.parameters.some((parameter) => typeUsed(parameter.valueType)),
        ) ||
        engineTypes.some(
          (candidate) =>
            candidate.name !== name &&
            candidate.fields.some((field) => engineFieldTypeReferences(field.type, name)),
        );
      if (used) {
        setWorkspaceError(`Engine Type ${name} is still referenced.`);
        return;
      }
      if (!window.confirm(`Delete Engine Type "${engineType.displayName}"?`)) return;
      checkpoint(undefined, 'Delete Engine Type');
      setStoryDataSelection((current) =>
        current?.kind === 'engine-type' && current.name === name ? undefined : current,
      );
      writeEngineTypes(engineTypes.filter((item) => item.name !== name));
    },
    [
      checkpoint,
      engineTypes,
      events,
      projectVariables,
      resolvedCharacters,
      signals,
      variables,
      writeEngineTypes,
    ],
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
            ? bindCharacterFieldReferencesInNode(
                bindVariableReferencesInNode({ ...node, data: { ...node.data, ...update } }, [
                  ...availableVariables,
                  ...projectVariables,
                ]),
                resolvedCharacters,
              )
            : node,
        ),
      );
      markDirty();
    },
    [availableVariables, markDirty, projectVariables, resolvedCharacters, setNodes],
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

  const resourceReferenceIndex = useMemo(() => {
    if (storyDataSelection?.kind !== 'character' && storyDataSelection?.kind !== 'asset') {
      return undefined;
    }
    const items = currentStoryItems();
    return buildStoryResourceReferenceIndex(
      resourceReferenceStories(items),
      resourceReferenceCharacters(
        items,
        workspace?.characterResources.map((candidate) => candidate.character) ?? [],
      ),
      { engineTypes, projectVariables, events, signals },
    );
  }, [
    currentStoryItems,
    engineTypes,
    events,
    projectVariables,
    signals,
    storyDataSelection?.kind,
    workspace?.characterResources,
  ]);
  resourceReferenceIndexRef.current = resourceReferenceIndex;

  const findCharacterReferencesById = useCallback(
    (id: CharacterId): readonly StoryResourceReference[] =>
      resourceReferenceIndex?.characters.get(id) ?? [],
    [resourceReferenceIndex],
  );

  const findEmotionReferencesByKey = useCallback(
    (id: CharacterId, emotion: string): readonly StoryResourceReference[] =>
      resourceReferenceIndex?.emotions.get(emotionReferenceKey(id, emotion)) ?? [],
    [resourceReferenceIndex],
  );

  const findCharacterFieldReferencesById = useCallback(
    (id: VariableId): readonly StoryResourceReference[] =>
      resourceReferenceIndex?.characterFields.get(id) ?? [],
    [resourceReferenceIndex],
  );

  const findAssetReferencesById = useCallback(
    (id: AssetId): readonly StoryResourceReference[] =>
      resourceReferenceIndex?.assets.get(id) ?? [],
    [resourceReferenceIndex],
  );

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

  const clearStorySession = useCallback(
    (preserveHistory = false) => {
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
      if (!preserveHistory) history.clear();
    },
    [history, initialDocument, restoreGraph],
  );

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
    (story: EditorStoryWorkspaceItem, graphId: ActiveGraphId = 'root', preserveHistory = false) => {
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
      if (!preserveHistory) history.clear();
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

  const focusStoryResourceReference = useCallback(
    (reference: StoryResourceReference): boolean => {
      if (reference.target.kind === 'engine-type') {
        setStoryDataSelection({ kind: 'engine-type', name: reference.target.name });
        return true;
      }
      if (reference.target.kind === 'variable') {
        const variableTarget = reference.target;
        if (variableTarget.storyId && variableTarget.storyId !== document.id) {
          const target = currentStoryItemsRef
            .current()
            .find((story) => story.document.id === variableTarget.storyId);
          if (!target) return false;
          loadStory(target);
        }
        setStoryDataSelection({ kind: 'variable', id: variableTarget.variableId });
        return true;
      }
      if (reference.target.kind === 'character') {
        const characterTarget = reference.target;
        if (characterTarget.storyId && characterTarget.storyId !== document.id) {
          const target = currentStoryItemsRef
            .current()
            .find((story) => story.document.id === characterTarget.storyId);
          if (!target) return false;
          loadStory(target);
        }
        setStoryDataSelection({ kind: 'character', id: characterTarget.characterId });
        return true;
      }
      const nodeTarget = reference.target;
      if (nodeTarget.storyId === document.id) {
        return focusGraphNode(nodeTarget.graphId, nodeTarget.nodeId);
      }
      let target = currentStoryItemsRef
        .current()
        .find((story) => story.document.id === nodeTarget.storyId);
      if (!target) return false;
      const selectNode = (candidate: EditorGraphState): EditorGraphState => ({
        ...candidate,
        nodes: candidate.nodes.map((node) => ({
          ...node,
          selected: node.id === nodeTarget.nodeId,
        })),
        edges: candidate.edges.map((edge) => ({ ...edge, selected: false })),
      });
      target = {
        ...target,
        rootGraph: nodeTarget.graphId === 'root' ? selectNode(target.rootGraph) : target.rootGraph,
        chapters: target.chapters.map((chapter) =>
          chapter.id === nodeTarget.graphId
            ? { ...chapter, graph: selectNode(chapter.graph) }
            : chapter,
        ),
      };
      setWorkspaceStories((current) =>
        current.map((story) => (story.document.id === target!.document.id ? target! : story)),
      );
      loadStory(target, nodeTarget.graphId);
      setProblemFocus({ nodeId: nodeTarget.nodeId, nonce: Date.now() });
      return true;
    },
    [document.id, focusGraphNode, loadStory],
  );

  const focusVariableReference = useCallback(
    async (reference: VariableReference): Promise<boolean> => {
      if (!reference.storyId || reference.storyId === document.id) {
        return focusGraphNode(reference.graphId, reference.nodeId);
      }
      let target = currentStoryItemsRef
        .current()
        .find((story) => story.document.id === reference.storyId);
      if (!target && reference.storyPath && window.electronAPI) {
        try {
          const opened = await window.electronAPI.openWorkspaceStory(reference.storyPath);
          if (!opened.canceled) target = editorStoryItemFromOpenedStory(opened);
        } catch (error) {
          setWorkspaceError(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
      if (!target) return false;
      const selectNode = (candidate: EditorGraphState): EditorGraphState => ({
        ...candidate,
        nodes: candidate.nodes.map((node) => ({
          ...node,
          selected: node.id === reference.nodeId,
        })),
        edges: candidate.edges.map((edge) => ({ ...edge, selected: false })),
      });
      target = {
        ...target,
        rootGraph: reference.graphId === 'root' ? selectNode(target.rootGraph) : target.rootGraph,
        chapters: target.chapters.map((chapter) =>
          chapter.id === reference.graphId
            ? { ...chapter, graph: selectNode(chapter.graph) }
            : chapter,
        ),
      };
      const active = hasActiveStory ? captureActiveStory() : undefined;
      setWorkspaceStories((current) => {
        const next = current.map((story) =>
          active && story.document.id === active.document.id ? active : story,
        );
        const index = next.findIndex((story) => story.document.id === target!.document.id);
        if (index < 0) return [...next, target!];
        return next.map((story) => (story.document.id === target!.document.id ? target! : story));
      });
      loadStory(target, reference.graphId);
      setProblemFocus({ nodeId: reference.nodeId, nonce: Date.now() });
      return true;
    },
    [captureActiveStory, document.id, focusGraphNode, hasActiveStory, loadStory],
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
    checkpoint(undefined, 'New Story');
    setWorkspaceStories((items) => [
      ...items.map((story) =>
        current && story.document.id === current.document.id ? current : story,
      ),
      next,
    ]);
    loadStory(next, 'root', true);
  }, [captureActiveStory, checkpoint, hasActiveStory, loadStory, workspaceStories]);

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
      preserveHistory = false,
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
      loadStory(opened, 'root', preserveHistory);
      return opened;
    },
    [captureActiveStory, hasActiveStory, loadStory, storyItemFromOpenedStory],
  );

  const persistRecoveryCandidates = useCallback((next: readonly RecoveryCandidate[]) => {
    const snapshots = next.map(({ storyId, displayName, filePath, content, savedAt }) => ({
      storyId,
      displayName,
      filePath,
      content,
      savedAt,
    }));
    void window.electronAPI
      ?.writeRecoverySnapshots(snapshots)
      .catch((error: unknown) =>
        setRecoveryError(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  const removeRecoveryCandidate = useCallback(
    (storyId: string) => {
      setRecoveries((current) => {
        const next = current.filter((candidate) => candidate.storyId !== storyId);
        persistRecoveryCandidates(next);
        return next;
      });
    },
    [persistRecoveryCandidates],
  );

  const recoverStory = useCallback(
    (storyId: string) => {
      const recovery = recoveries.find((candidate) => candidate.storyId === storyId);
      if (!recovery) return;
      let diskItem: EditorStoryWorkspaceItem | undefined;
      if (recovery.diskContent && recovery.filePath && recovery.fileToken) {
        diskItem = storyItemFromOpenedStory({
          canceled: false,
          filePath: recovery.filePath,
          fileToken: recovery.fileToken,
          content: recovery.diskContent,
        });
      }
      acceptOpenedStory(
        {
          canceled: false,
          filePath: recovery.filePath ?? '',
          fileToken: recovery.fileToken ?? '',
          content: recovery.content,
        },
        {
          dirty: true,
          filePath: recovery.filePath,
          fileToken: recovery.fileToken,
        },
      );
      if (diskItem) {
        history.checkpoint({
          document: structuredClone(diskItem.document),
          hasActiveStory: true,
          activeGraphId: 'root',
          graph: structuredClone(diskItem.rootGraph),
          rootGraph: structuredClone(diskItem.rootGraph),
          chapters: structuredClone(diskItem.chapters),
          variables: structuredClone(diskItem.variables),
          characters: structuredClone(diskItem.characters),
          assets: structuredClone(diskItem.assets),
          projectResources: structuredClone(projectResourceSnapshot),
          workspaceStories: structuredClone(workspaceStories),
          projectVariables: structuredClone(projectVariables),
          events: structuredClone(events),
          signals: structuredClone(signals),
          engineTypes: structuredClone(engineTypes),
          storyFiles: [...managedStoryFilesRef.current].map(([relativePath, content]) => ({
            relativePath,
            content,
          })),
        });
      }
      removeRecoveryCandidate(storyId);
    },
    [
      acceptOpenedStory,
      events,
      engineTypes,
      history,
      projectVariables,
      projectResourceSnapshot,
      recoveries,
      removeRecoveryCandidate,
      signals,
      storyItemFromOpenedStory,
      workspaceStories,
    ],
  );

  const saveRecoveryAs = useCallback(
    async (storyId: string) => {
      const recovery = recoveries.find((candidate) => candidate.storyId === storyId);
      if (!recovery || !window.electronAPI) return;
      try {
        const result = await window.electronAPI.saveRecoveryAs(recovery);
        if (result.canceled) return;
        acceptOpenedStory({ ...result, canceled: false, content: recovery.content });
        removeRecoveryCandidate(storyId);
      } catch (error) {
        setRecoveryError(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptOpenedStory, recoveries, removeRecoveryCandidate],
  );

  const discardRecovery = useCallback(
    (storyId: string) => removeRecoveryCandidate(storyId),
    [removeRecoveryCandidate],
  );

  const discardAllRecoveries = useCallback(() => {
    setRecoveries([]);
    void window.electronAPI
      ?.clearRecoverySnapshots()
      .catch((error: unknown) =>
        setRecoveryError(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  const dismissRecoveryError = useCallback(() => setRecoveryError(undefined), []);

  const absoluteWorkspacePath = useCallback(
    (relativePath: string) =>
      workspace
        ? `${workspace.rootPath.replace(/[\\/]$/, '')}\\${relativePath.replace(/\//g, '\\')}`
        : relativePath,
    [workspace],
  );

  const removeExternalFileChange = useCallback((relativePath: string) => {
    setExternalFileChanges((current) =>
      current.filter((change) => change.relativePath !== relativePath),
    );
  }, []);

  const keepExternalEditorVersion = useCallback(
    (relativePath: string) => {
      removeExternalFileChange(relativePath);
      setExternalStoryMergeRequest((current) =>
        current?.relativePath === relativePath ? undefined : current,
      );
    },
    [removeExternalFileChange],
  );

  const reloadExternalFile = useCallback(
    async (relativePath: string) => {
      const change = externalFileChanges.find(
        (candidate) => candidate.relativePath === relativePath,
      );
      if (!change || !window.electronAPI) return;
      try {
        if (change.kind === 'story' && change.change === 'deleted') {
          const targetPath = absoluteWorkspacePath(relativePath).toLowerCase();
          const items = currentStoryItems();
          const removed = items.find(
            (story) => story.document.filePath?.toLowerCase() === targetPath,
          );
          if (removed) {
            const remaining = items.filter((story) => story.document.id !== removed.document.id);
            setWorkspaceStories(remaining);
            if (removed.document.id === document.id) {
              if (remaining.length > 0) loadStory(remaining[0], 'root', true);
              else clearStorySession(true);
            }
          }
        } else if (change.kind === 'story' && change.content) {
          const targetPath = absoluteWorkspacePath(relativePath);
          const existing = currentStoryItems().find(
            (story) => story.document.filePath?.toLowerCase() === targetPath.toLowerCase(),
          );
          if (existing?.document.fileToken) {
            const reloaded = storyItemFromOpenedStory({
              canceled: false,
              filePath: targetPath,
              fileToken: existing.document.fileToken,
              content: change.content,
            });
            setWorkspaceStories((items) =>
              items.map((story) => (story.document.id === existing.document.id ? reloaded : story)),
            );
            if (existing.document.id === document.id) loadStory(reloaded);
          }
        }
        setWorkspace(await window.electronAPI.refreshWorkspace());
        setProjectResourcesDirty(false);
        removeExternalFileChange(relativePath);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      absoluteWorkspacePath,
      clearStorySession,
      currentStoryItems,
      document.id,
      externalFileChanges,
      loadStory,
      removeExternalFileChange,
      storyItemFromOpenedStory,
    ],
  );

  const saveExternalStoryAs = useCallback(
    async (relativePath: string) => {
      const change = externalFileChanges.find(
        (candidate) => candidate.relativePath === relativePath,
      );
      if (!change || change.kind !== 'story' || !window.electronAPI) return;
      const targetPath = absoluteWorkspacePath(relativePath);
      const item = currentStoryItems().find(
        (story) => story.document.filePath?.toLowerCase() === targetPath.toLowerCase(),
      );
      if (!item) return;
      try {
        const content = serializeStorySource(storyItemToSource(item));
        const result = await window.electronAPI.saveStory({ content, saveAs: true });
        if (result.canceled) return;
        acceptOpenedStory({ ...result, canceled: false, content });
        removeExternalFileChange(relativePath);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      absoluteWorkspacePath,
      acceptOpenedStory,
      currentStoryItems,
      externalFileChanges,
      removeExternalFileChange,
      storyItemToSource,
    ],
  );

  const mergeExternalStory = useCallback(
    (relativePath: string) => {
      const change = externalFileChanges.find(
        (candidate) => candidate.relativePath === relativePath,
      );
      if (
        !change?.previousContent ||
        !change.content ||
        change.kind !== 'story' ||
        change.change !== 'modified'
      )
        return;
      const targetPath = absoluteWorkspacePath(relativePath);
      const item = currentStoryItems().find(
        (story) => story.document.filePath?.toLowerCase() === targetPath.toLowerCase(),
      );
      if (!item) return;
      try {
        setExternalStoryMergeRequest({
          relativePath,
          base: parseStorySource(change.previousContent),
          local: storyItemToSource(item),
          remote: parseStorySource(change.content),
          nonce: Date.now(),
        });
        loadStory(item);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [absoluteWorkspacePath, currentStoryItems, externalFileChanges, loadStory, storyItemToSource],
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let handling = false;
    return api.onWorkspaceFilesChanged((changes) => {
      if (handling) return;
      handling = true;
      void (async () => {
        try {
          const items = currentStoryItemsRef.current();
          const pending: ExternalWorkspaceFileChange[] = [];
          let refreshResources = false;
          for (const change of changes) {
            if (change.kind !== 'story') {
              const currentContent =
                change.kind === 'project' && workspace?.project
                  ? serializeStoryProject(workspace.project)
                  : change.kind === 'character'
                    ? (() => {
                        const resource = workspace?.characterResources.find(
                          (item) => item.relativePath === change.relativePath,
                        );
                        return resource
                          ? serializeCharacterResource(resource.character)
                          : undefined;
                      })()
                    : change.kind === 'asset'
                      ? (() => {
                          const resource = workspace?.assetResources.find(
                            (item) => item.relativePath === change.relativePath,
                          );
                          return resource ? serializeAssetResource(resource.asset) : undefined;
                        })()
                      : change.kind === 'localization'
                        ? workspace?.localization
                          ? serializeStoryLocalization(workspace.localization.document)
                          : undefined
                        : undefined;
              if (change.kind === 'character-template') {
                refreshResources = true;
                continue;
              }
              const action = planExternalFileChange({
                change,
                matchesEditorContent: Boolean(change.content && currentContent === change.content),
                openedStory: false,
                storyDirty: false,
                projectResourcesDirty,
              });
              if (action === 'review') pending.push(change);
              else if (action === 'refresh-workspace') refreshResources = true;
              continue;
            }
            const targetPath = absoluteWorkspacePath(change.relativePath).toLowerCase();
            const opened = items.find(
              (item) => item.document.filePath?.toLowerCase() === targetPath,
            );
            const action = planExternalFileChange({
              change,
              matchesEditorContent: Boolean(
                opened && change.content === serializeStorySource(storyItemToSource(opened)),
              ),
              openedStory: Boolean(opened),
              storyDirty: Boolean(opened?.document.dirty),
              projectResourcesDirty,
            });
            if (action === 'refresh-workspace') {
              refreshResources = true;
              continue;
            }
            if (action === 'review') {
              pending.push(change);
              continue;
            }
            if (action === 'ignore' || !opened || !change.content) continue;
            const reloaded = storyItemFromOpenedStory({
              canceled: false,
              filePath: opened.document.filePath!,
              fileToken: opened.document.fileToken!,
              content: change.content,
            });
            setWorkspaceStories((current) =>
              current.map((story) => (story.document.id === opened.document.id ? reloaded : story)),
            );
            if (opened.document.id === document.id) loadStory(reloaded);
          }
          if (refreshResources) setWorkspace(await api.refreshWorkspace());
          if (pending.length > 0) {
            setExternalFileChanges((current) => {
              const byPath = new Map(current.map((change) => [change.relativePath, change]));
              for (const change of pending) byPath.set(change.relativePath, change);
              return [...byPath.values()];
            });
          }
        } catch (error) {
          setWorkspaceError(error instanceof Error ? error.message : String(error));
        } finally {
          handling = false;
        }
      })();
    });
  }, [
    absoluteWorkspacePath,
    document.id,
    loadStory,
    projectResourcesDirty,
    storyItemToSource,
    storyItemFromOpenedStory,
    workspace?.assetResources,
    workspace?.characterResources,
    workspace?.project,
  ]);

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
              activeGraphId === 'root' ||
              next.chapters.some((chapter) => chapter.id === activeGraphId)
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

  const deleteWorkspaceStory = useCallback(
    async (relativePath: string) => {
      if (!window.electronAPI) return;
      if (!window.confirm(`Delete Story file "${relativePath}"?`)) return;
      try {
        const opened = await window.electronAPI.openWorkspaceStory(relativePath);
        if (opened.canceled) return;
        managedStoryFilesRef.current.set(relativePath, opened.content);
        checkpoint(undefined, 'Delete Story');
        setWorkspace(await window.electronAPI.deleteWorkspaceStory(relativePath));
        managedStoryFilesRef.current.delete(relativePath);
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [checkpoint],
  );

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
        acceptOpenedStory(result, {}, false, true);
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
        const relativePath = result.filePath
          .slice((workspace?.rootPath.length ?? 0) + 1)
          .replaceAll('\\', '/');
        checkpoint(undefined, 'Create Story');
        managedStoryFilesRef.current.set(relativePath, result.content);
        acceptOpenedStory(result, {}, false, true);
        setWorkspace(await window.electronAPI.refreshWorkspace());
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptOpenedStory, checkpoint, workspace?.rootPath],
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
            variables: [],
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
      const nextSettings = {
        entryStoryId: settings.entryStoryId ?? workspace.project.entryStoryId,
        outputDirectory:
          settings.outputDirectory === undefined
            ? workspace.project.outputDirectory
            : settings.outputDirectory,
      };
      if (
        nextSettings.entryStoryId === workspace.project.entryStoryId &&
        nextSettings.outputDirectory === workspace.project.outputDirectory
      )
        return;
      checkpoint(undefined, 'Edit Project Settings');
      setWorkspace((current) =>
        current?.project
          ? { ...current, project: { ...current.project, ...nextSettings } }
          : current,
      );
      queueProjectResourceWrite(() => window.electronAPI!.updateProjectSettings(nextSettings));
    },
    [checkpoint, queueProjectResourceWrite, workspace?.project],
  );

  const extractProjectLocalization = useCallback(
    async (sourceLocale: string) => {
      if (!window.electronAPI || !workspace?.project) return;
      if (!(await saveAllDirtyStories())) return;
      try {
        setWorkspace(await window.electronAPI.extractProjectLocalization(sourceLocale));
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [saveAllDirtyStories, workspace?.project],
  );

  const updateProjectLocalization = useCallback(
    (localization: StoryLocalizationDocument) => {
      if (!window.electronAPI || !workspace?.localization) return;
      if (JSON.stringify(localization) === JSON.stringify(workspace.localization.document)) return;
      checkpoint(undefined, 'Edit Localization');
      setWorkspace((current) =>
        current?.localization
          ? {
              ...current,
              localization: { ...current.localization, document: structuredClone(localization) },
            }
          : current,
      );
      queueProjectResourceWrite(() =>
        window.electronAPI!.updateProjectLocalization(structuredClone(localization)),
      );
    },
    [checkpoint, queueProjectResourceWrite, workspace?.localization],
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
      const snapshot = await window.electronAPI.readWorkspaceProjectStories();
      const projectSources = snapshot.stories.map((file) => {
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
      const result = compileProject(nextWorkspace.project, projectSources, {
        localization: nextWorkspace.localization?.document,
      });
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
      if (!window.confirm(`Delete Story file "${target.document.displayName}"?${dirtyWarning}`)) {
        return;
      }
      try {
        const relativePath = target.document.filePath
          .slice((workspace?.rootPath.length ?? 0) + 1)
          .replaceAll('\\', '/');
        managedStoryFilesRef.current.set(
          relativePath,
          serializeStorySource(storyItemToSource(target)),
        );
        checkpoint(undefined, 'Delete Story');
        const nextWorkspace = await window.electronAPI.deleteStory(
          target.document.filePath,
          target.document.fileToken,
        );
        if (nextWorkspace) setWorkspace(nextWorkspace);
        managedStoryFilesRef.current.delete(relativePath);
        const remaining = items.filter((story) => story.document.id !== id);
        setWorkspaceStories(remaining);
        if (id === document.id) {
          if (remaining.length > 0) loadStory(remaining[0], 'root', true);
          else clearStorySession(true);
        }
        setWorkspaceError(undefined);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      checkpoint,
      clearStorySession,
      currentStoryItems,
      document.id,
      loadStory,
      storyItemToSource,
      workspace?.rootPath,
    ],
  );

  const updateStory = useCallback(
    (update: { name?: string; displayName?: string }) => {
      if (!hasActiveStory) return;
      const changed = Object.entries(update).some(
        ([key, value]) => document[key as 'name' | 'displayName'] !== value,
      );
      if (!changed) return;
      checkpoint(undefined, 'Rename Story');
      setDocument((current) => ({ ...current, ...update, id: current.id }));
      markDirty();
    },
    [checkpoint, document, hasActiveStory, markDirty],
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
        setRecoveries(restored.recoveries);
        setRecoveryError(restored.recoveryError);
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
    if (!sessionReady || !window.electronAPI || recoveries.length > 0) return;
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
    if (!sessionReady || !window.electronAPI || recoveries.length > 0) return;
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
  }, [currentStoryItems, recoveries.length, sessionReady, storyItemToSource]);

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
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      undoEntries: history.undoEntries,
      redoEntries: history.redoEntries,
      travelHistory,
      addNode,
      addSubstory,
      updateNode,
      updateNodeData,
      variables,
      availableVariables,
      projectVariables,
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
      addProjectVariable,
      findVariableReferences: findVariableReferencesById,
      variableReferencesLoading,
      variableReferencesError,
      refreshProjectVariableReferences,
      focusVariableReference,
      updateVariable,
      removeVariable,
      addCharacter,
      duplicateCharacter,
      addCharacterFromTemplate,
      saveCharacterAsTemplate,
      findCharacterReferences: findCharacterReferencesById,
      findEmotionReferences: findEmotionReferencesByKey,
      findCharacterFieldReferences: findCharacterFieldReferencesById,
      findAssetReferences: findAssetReferencesById,
      focusStoryResourceReference,
      updateCharacter,
      renameCharacterEmotion,
      removeCharacterEmotion,
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
      engineTypes,
      addEngineType,
      updateEngineType,
      removeEngineType,
      engineTypeMigrationPreview,
      confirmEngineTypeMigration,
      cancelEngineTypeMigration,
      document,
      stories,
      hasActiveStory,
      activeStoryId: hasActiveStory ? document.id : undefined,
      workspace,
      workspaceError,
      recoveries,
      recoveryError,
      recoverStory,
      saveRecoveryAs,
      discardRecovery,
      discardAllRecoveries,
      dismissRecoveryError,
      externalFileChanges,
      externalStoryMergeRequest,
      keepExternalEditorVersion,
      reloadExternalFile,
      saveExternalStoryAs,
      mergeExternalStory,
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
      inkImportReport,
      dismissInkImportReport,
      importInkFile,
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
      extractProjectLocalization,
      updateProjectLocalization,
    }),
    [
      addNode,
      addVariable,
      addProjectVariable,
      findVariableReferencesById,
      variableReferencesLoading,
      variableReferencesError,
      refreshProjectVariableReferences,
      focusVariableReference,
      addCharacter,
      duplicateCharacter,
      addCharacterFromTemplate,
      saveCharacterAsTemplate,
      findCharacterReferencesById,
      findEmotionReferencesByKey,
      findCharacterFieldReferencesById,
      findAssetReferencesById,
      focusStoryResourceReference,
      addAsset,
      addEvent,
      addSignal,
      addEngineType,
      cancelEngineTypeMigration,
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
      recoveries,
      recoveryError,
      recoverStory,
      saveRecoveryAs,
      discardRecovery,
      discardAllRecoveries,
      dismissRecoveryError,
      externalFileChanges,
      externalStoryMergeRequest,
      keepExternalEditorVersion,
      reloadExternalFile,
      saveExternalStoryAs,
      mergeExternalStory,
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
      inkImportReport,
      dismissInkImportReport,
      importInkFile,
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
      history.canUndo,
      history.canRedo,
      history.undoLabel,
      history.redoLabel,
      history.undoEntries,
      history.redoEntries,
      activeGraphId,
      nodes,
      markDirty,
      newStory,
      onEdgesChange,
      onNodesChange,
      redo,
      travelHistory,
      removeCharacter,
      removeCharacterEmotion,
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
      extractProjectLocalization,
      updateProjectLocalization,
      source,
      switchGraph,
      focusGraphNode,
      undo,
      updateCharacter,
      renameCharacterEmotion,
      updateAsset,
      updateEvent,
      updateSignal,
      updateNode,
      updateNodeData,
      updateSubstory,
      updateVariable,
      variables,
      availableVariables,
      projectVariables,
      assets,
      events,
      engineTypes,
      engineTypeMigrationPreview,
      signals,
      removeEngineType,
      confirmEngineTypeMigration,
      updateEngineType,
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
