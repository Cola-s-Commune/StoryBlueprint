export type OpenStoryResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      fileToken: string;
      content: string;
      gitConflict?: boolean;
    };

export interface StoryGitConflictStages {
  repositoryRoot: string;
  relativePath: string;
  revision: string;
  base: string;
  local: string;
  remote: string;
}

export type WorkspaceMergeResourceKind = 'project' | 'character' | 'asset';

export interface WorkspaceGitConflictStages {
  repositoryRoot: string;
  relativePath: string;
  kind: WorkspaceMergeResourceKind;
  revision: string;
  base?: string;
  local?: string;
  remote?: string;
}

export interface ApplyWorkspaceMergeFile {
  relativePath: string;
  kind: WorkspaceMergeResourceKind;
  conflictRevision: string;
  content?: string;
  delete?: boolean;
}

export interface SaveStoryRequest {
  filePath?: string;
  fileToken?: string;
  content: string;
  saveAs?: boolean;
  gitConflictRevision?: string;
}

export type SaveStoryResult =
  { canceled: true } | { canceled: false; filePath: string; fileToken: string };

export interface WorkspaceEntry {
  kind:
    | 'directory'
    | 'story'
    | 'project'
    | 'character'
    | 'character-template'
    | 'asset'
    | 'localization';
  name: string;
  relativePath: string;
  children?: WorkspaceEntry[];
}

export interface WorkspaceGitRepository {
  available: boolean;
  initialized: boolean;
  repositoryRoot?: string;
  branch?: string;
  headRevision?: string;
  conflictRevision?: string;
}

export interface ReloadWorkspaceAfterGitChangeResult {
  workspace: WorkspaceInfo;
  stories: Exclude<OpenStoryResult, { canceled: true }>[];
  missingStoryPaths: string[];
}

export interface ExternalWorkspaceFileChange {
  relativePath: string;
  kind: 'story' | 'project' | 'character' | 'character-template' | 'asset' | 'localization';
  change: 'created' | 'modified' | 'deleted';
  previousContent?: string;
  content?: string;
}

export interface WorkspaceInfo {
  name: string;
  rootPath: string;
  entries: WorkspaceEntry[];
  project?: StoryProjectDocument;
  projectRevision?: string;
  projectError?: string;
  characterResources: { relativePath: string; character: CharacterSource }[];
  characterTemplates: { relativePath: string; template: CharacterTemplateSource }[];
  assetResources: { relativePath: string; asset: AssetSource }[];
  localization?: { relativePath: string; document: StoryLocalizationDocument };
  resourceErrors: { relativePath: string; message: string }[];
  git: WorkspaceGitRepository;
  gitConflicts?: { relativePath: string; kind: WorkspaceMergeResourceKind }[];
}

export type OpenWorkspaceResult =
  | { canceled: true }
  | {
      canceled: false;
      workspace: WorkspaceInfo;
      initialStory?: Exclude<OpenStoryResult, { canceled: true }>;
    };

export interface CreatedWorkspaceProject {
  workspace: WorkspaceInfo;
  initialStory: Exclude<OpenStoryResult, { canceled: true }>;
}

export interface DeleteProjectResourceResult {
  canceled: boolean;
  workspace: WorkspaceInfo;
}

export interface ProjectResourceSnapshot {
  characters: { relativePath: string; character: CharacterSource }[];
  assets: { relativePath: string; asset: AssetSource }[];
}

export interface RestoreWorkspaceStoryResult {
  workspace: WorkspaceInfo;
  story?: Exclude<OpenStoryResult, { canceled: true }>;
}

export interface RecentProject {
  name: string;
  filePath: string;
  lastOpenedAt: string;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface EditorSessionState {
  workspaceRoot?: string;
  storyFilePaths: string[];
  activeStoryFilePath?: string;
}

export interface RecoverySnapshot {
  storyId: string;
  displayName: string;
  filePath?: string;
  content: string;
  savedAt: string;
}

export interface RecoveryCandidate extends RecoverySnapshot {
  diskStatus: 'unsaved' | 'unchanged' | 'changed' | 'missing';
  diskContent?: string;
  fileToken?: string;
}

export interface RestoredEditorSession {
  workspace?: WorkspaceInfo;
  stories: Exclude<OpenStoryResult, { canceled: true }>[];
  recoveries: RecoveryCandidate[];
  recoveryError?: string;
}

export interface ProjectStoryFile {
  path: string;
  content: string;
  revision: string;
}

export interface ProjectStorySnapshot {
  stories: readonly ProjectStoryFile[];
  projectRevision: string;
}

export interface UpdateProjectStoryFile {
  path: string;
  content: string;
  expectedRevision: string;
}

export interface UpdateProjectStoryFilesRequest {
  files: readonly UpdateProjectStoryFile[];
  projectVariables?: readonly VariableDefinition[];
  expectedProjectRevision?: string;
}

export type ExportCompiledProjectResult =
  { canceled: true } | { canceled: false; filePath: string };

export type OpenCompiledProjectResult =
  { canceled: true } | { canceled: false; filePath: string; content: string };

export type OpenInkFileResult =
  { canceled: true } | { canceled: false; filePath: string; content: string };

export interface CreateWorkspaceStoryRequest {
  directory: string;
  name: string;
  content: string;
}

export interface CreateWorkspaceProjectRequest {
  fileName: string;
  content: string;
}

export interface UpdateProjectSettingsRequest {
  entryStoryId?: string;
  outputDirectory?: string;
  variables?: readonly VariableDefinition[];
  events?: readonly EventSource[];
  signals?: readonly SignalSource[];
  engineTypes?: readonly EngineTypeDefinition[];
}

export type AIStructuredOutputMode = 'json-schema' | 'json-object';
export type AIThinkingMode = 'auto' | 'enabled' | 'disabled';
export type AIReasoningEffort = 'high' | 'max';
export type AIStreamingMode = 'auto' | 'required' | 'disabled';
export type AIToolsMode = 'enabled' | 'disabled';
export type AIContextMode = 'full' | 'compact' | 'manifest-first';

export interface AIProviderSettings {
  provider: 'openai-compatible';
  endpoint: string;
  model: string;
  timeoutMs: number;
  structuredOutput: AIStructuredOutputMode;
  thinkingMode: AIThinkingMode;
  reasoningEffort: AIReasoningEffort;
  streaming: AIStreamingMode;
  tools: AIToolsMode;
  contextMode: AIContextMode;
  hasApiKey: boolean;
}

export interface AIProviderProfile extends AIProviderSettings {
  id: string;
  name: string;
}

export interface AIProviderRegistry {
  activeProviderId: string;
  providers: readonly AIProviderProfile[];
}

export interface AIInstructionsStatus {
  builtInVersion: number;
  projectAgents: 'loaded' | 'missing' | 'oversized';
  projectAgentsPath?: string;
}

export interface SaveAIProviderProfileRequest {
  /** Omit when creating a new provider profile. */
  id?: string;
  name: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  structuredOutput: AIStructuredOutputMode;
  thinkingMode: AIThinkingMode;
  reasoningEffort: AIReasoningEffort;
  streaming: AIStreamingMode;
  tools: AIToolsMode;
  contextMode: AIContextMode;
  /** Omitted keeps the existing key; an empty string removes it. */
  apiKey?: string;
}

export interface GenerateAICommandRequest {
  requestId: string;
  providerId: string;
  instruction: string;
  context: string;
  schema: unknown;
  history?: readonly AIConversationMessage[];
  attachments?: readonly AIFileAttachment[];
}

export interface AIStreamProgress {
  requestId: string;
  phase: 'connecting' | 'thinking' | 'writing' | 'completed';
  reasoningDelta?: string;
  contentDelta?: string;
  model?: string;
}

export interface AIFileAttachment {
  id: string;
  name: string;
  content: string;
}

export interface AIConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatSession {
  id: string;
  scopeKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: readonly AIConversationMessage[];
  /** Raw provider envelopes retained so follow-up turns remember proposed commands. */
  history: readonly AIConversationMessage[];
}

export interface GenerateAICommandResult {
  content: string;
  model: string;
  /** Provider-supplied reasoning, kept only in the current renderer session. */
  reasoning?: string;
}

export interface EditorWindowState {
  maximized: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateManifestSignature {
  algorithm: 'ed25519';
  keyId: string;
  value: string;
}

export interface UpdateSettings {
  enabled: boolean;
  feedUrl: string;
  channel: UpdateChannel;
  autoCheck: boolean;
}

export interface UpdateManifest {
  format: 'story-blueprint-update';
  version: 1;
  channel: UpdateChannel;
  latestVersion: string;
  releaseDate?: string;
  notes?: string;
  installerUrl?: string;
  portableUrl?: string;
  installerSha512?: string;
  portableSha512?: string;
  installerSize?: number;
  portableSize?: number;
  signature?: UpdateManifestSignature;
}

export interface UpdateDownloadProgress {
  received: number;
  total: number;
}

export interface UpdateDownloadResult {
  path: string;
  kind: 'installer' | 'portable';
}

export interface UpdateAvailableResult {
  status: 'available';
  currentVersion: string;
  latestVersion: string;
  releaseDate?: string;
  notes?: string;
  installerUrl?: string;
  portableUrl?: string;
  installerSha512?: string;
  portableSha512?: string;
  installerSize?: number;
  portableSize?: number;
  checkedAt: string;
}

export type UpdateCheckResult =
  | UpdateAvailableResult
  | {
      status: 'disabled' | 'up-to-date';
      currentVersion: string;
      latestVersion?: string;
      releaseDate?: string;
      notes?: string;
      installerUrl?: string;
      portableUrl?: string;
      checkedAt: string;
    }
  | {
      status: 'error';
      currentVersion: string;
      checkedAt: string;
      error: string;
    };

export interface ElectronAPI {
  platform: string;
  isElectron: true;
  copyText: (text: string) => Promise<void>;
  readClipboardText: () => Promise<string>;
  setWindowZoom: (action: 'in' | 'out' | 'reset') => Promise<number>;
  getAppInfo: () => Promise<AppInfo>;
  revealLogs: () => Promise<void>;
  reportRendererError: (scope: string, message: string) => Promise<void>;
  getUpdateSettings: () => Promise<UpdateSettings>;
  updateUpdateSettings: (settings: UpdateSettings) => Promise<UpdateSettings>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: (kind: 'installer' | 'portable') => Promise<UpdateDownloadResult>;
  cancelUpdateDownload: () => Promise<void>;
  revealDownloadedUpdate: (path: string) => Promise<void>;
  installDownloadedUpdate: (path: string) => Promise<void>;
  onUpdateDownloadProgress: (listener: (progress: UpdateDownloadProgress) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  getWindowState: () => Promise<EditorWindowState>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<EditorWindowState>;
  closeWindow: () => Promise<void>;
  onWindowStateChanged: (listener: (state: EditorWindowState) => void) => () => void;
  openStory: () => Promise<OpenStoryResult>;
  readStoryGitConflict: (
    filePath: string,
    fileToken: string,
  ) => Promise<StoryGitConflictStages | undefined>;
  readWorkspaceGitConflicts: () => Promise<WorkspaceGitConflictStages[]>;
  validateWorkspaceMerge: (files: ApplyWorkspaceMergeFile[]) => Promise<void>;
  applyWorkspaceMerge: (files: ApplyWorkspaceMergeFile[]) => Promise<WorkspaceInfo>;
  saveStory: (request: SaveStoryRequest) => Promise<SaveStoryResult>;
  revealStory: (filePath: string, fileToken: string) => Promise<void>;
  deleteStory: (filePath: string, fileToken: string) => Promise<WorkspaceInfo | undefined>;
  openWorkspace: () => Promise<OpenWorkspaceResult>;
  openProject: () => Promise<OpenWorkspaceResult>;
  openRecentProject: (filePath: string) => Promise<OpenWorkspaceResult>;
  newProject: () => Promise<OpenWorkspaceResult>;
  getRecentProjects: () => Promise<RecentProject[]>;
  removeRecentProject: (filePath: string) => Promise<RecentProject[]>;
  confirmUnsavedStories: (storyNames: string[], action: string) => Promise<UnsavedChoice>;
  restoreEditorSession: () => Promise<RestoredEditorSession>;
  updateEditorSession: (session: EditorSessionState) => Promise<void>;
  writeRecoverySnapshots: (snapshots: readonly RecoverySnapshot[]) => Promise<void>;
  clearRecoverySnapshots: () => Promise<void>;
  saveRecoveryAs: (snapshot: RecoverySnapshot) => Promise<SaveStoryResult>;
  readWorkspaceProjectStories: () => Promise<ProjectStorySnapshot>;
  updateWorkspaceProjectStories: (
    request: UpdateProjectStoryFilesRequest,
  ) => Promise<WorkspaceInfo>;
  exportCompiledProject: (content: string) => Promise<ExportCompiledProjectResult>;
  openCompiledProject: () => Promise<OpenCompiledProjectResult>;
  openInkFile: () => Promise<OpenInkFileResult>;
  updateProjectSettings: (settings: UpdateProjectSettingsRequest) => Promise<WorkspaceInfo>;
  extractProjectLocalization: (sourceLocale: string) => Promise<WorkspaceInfo>;
  updateProjectLocalization: (document: StoryLocalizationDocument) => Promise<WorkspaceInfo>;
  getAIProviderRegistry: () => Promise<AIProviderRegistry>;
  getAIInstructionsStatus: () => Promise<AIInstructionsStatus>;
  saveAIProviderProfile: (settings: SaveAIProviderProfileRequest) => Promise<AIProviderRegistry>;
  deleteAIProviderProfile: (providerId: string) => Promise<AIProviderRegistry>;
  selectAIProvider: (providerId: string) => Promise<AIProviderRegistry>;
  generateAICommand: (request: GenerateAICommandRequest) => Promise<GenerateAICommandResult>;
  onAIStreamProgress: (listener: (progress: AIStreamProgress) => void) => () => void;
  pickAIContextFiles: () => Promise<AIFileAttachment[]>;
  cancelAICommand: (requestId: string) => void;
  listAIChatSessions: (scopeKey: string) => Promise<AIChatSession[]>;
  saveAIChatSession: (session: AIChatSession) => Promise<void>;
  deleteAIChatSession: (scopeKey: string, sessionId: string) => Promise<void>;
  createProjectCharacter: (character: CharacterSource) => Promise<WorkspaceInfo>;
  saveCharacterTemplate: (template: CharacterTemplateSource) => Promise<WorkspaceInfo>;
  updateProjectCharacter: (
    relativePath: string,
    character: CharacterSource,
  ) => Promise<WorkspaceInfo>;
  deleteProjectCharacter: (relativePath: string) => Promise<DeleteProjectResourceResult>;
  createProjectAsset: (asset: AssetSource) => Promise<WorkspaceInfo>;
  updateProjectAsset: (relativePath: string, asset: AssetSource) => Promise<WorkspaceInfo>;
  deleteProjectAsset: (relativePath: string) => Promise<WorkspaceInfo>;
  restoreProjectResources: (snapshot: ProjectResourceSnapshot) => Promise<WorkspaceInfo>;
  restoreWorkspaceStory: (
    relativePath: string,
    content?: string,
  ) => Promise<RestoreWorkspaceStoryResult>;
  refreshWorkspace: () => Promise<WorkspaceInfo | undefined>;
  initializeWorkspaceGit: () => Promise<WorkspaceInfo>;
  reloadWorkspaceAfterGitChange: (
    stories: { filePath: string; fileToken: string }[],
  ) => Promise<ReloadWorkspaceAfterGitChangeResult>;
  confirmGitReload: (storyNames: string[]) => Promise<'reload' | 'keep'>;
  onWorkspaceGitChanged: (listener: (git: WorkspaceGitRepository) => void) => () => void;
  onWorkspaceFilesChanged: (
    listener: (changes: ExternalWorkspaceFileChange[]) => void,
  ) => () => void;
  revealWorkspaceItem: (relativePath: string) => Promise<void>;
  deleteWorkspaceStory: (relativePath: string) => Promise<WorkspaceInfo>;
  deleteWorkspaceProject: (relativePath: string) => Promise<WorkspaceInfo>;
  openWorkspaceStory: (relativePath: string) => Promise<OpenStoryResult>;
  createWorkspaceDirectory: (parent: string, name: string) => Promise<WorkspaceInfo>;
  createWorkspaceStory: (request: CreateWorkspaceStoryRequest) => Promise<OpenStoryResult>;
  createWorkspaceProject: (
    request: CreateWorkspaceProjectRequest,
  ) => Promise<CreatedWorkspaceProject>;
  syncWorkspaceProject: () => Promise<WorkspaceInfo>;
  setStoryDirty: (dirty: boolean) => void;
  onSaveBeforeClose: (listener: () => void) => () => void;
  finishClose: (saved: boolean) => void;
}
import type {
  AssetSource,
  CharacterSource,
  CharacterTemplateSource,
  EventSource,
  EngineTypeDefinition,
  SignalSource,
  StoryProjectDocument,
  StoryLocalizationDocument,
  VariableDefinition,
} from '@story-blueprint/common';
