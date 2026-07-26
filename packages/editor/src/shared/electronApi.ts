export type OpenStoryResult =
  { canceled: true } | { canceled: false; filePath: string; fileToken: string; content: string };

export interface SaveStoryRequest {
  filePath?: string;
  fileToken?: string;
  content: string;
  saveAs?: boolean;
}

export type SaveStoryResult =
  { canceled: true } | { canceled: false; filePath: string; fileToken: string };

export interface WorkspaceEntry {
  kind: 'directory' | 'story' | 'project';
  name: string;
  relativePath: string;
  children?: WorkspaceEntry[];
}

export interface WorkspaceInfo {
  name: string;
  rootPath: string;
  entries: WorkspaceEntry[];
  project?: StoryProjectDocument;
  projectError?: string;
}

export type OpenWorkspaceResult =
  { canceled: true } | { canceled: false; workspace: WorkspaceInfo };

export interface RecentProject {
  name: string;
  filePath: string;
  lastOpenedAt: string;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface CreateWorkspaceStoryRequest {
  directory: string;
  name: string;
  content: string;
}

export interface CreateWorkspaceProjectRequest {
  fileName: string;
  content: string;
}

export interface ElectronAPI {
  platform: string;
  isElectron: true;
  openStory: () => Promise<OpenStoryResult>;
  saveStory: (request: SaveStoryRequest) => Promise<SaveStoryResult>;
  openWorkspace: () => Promise<OpenWorkspaceResult>;
  openProject: () => Promise<OpenWorkspaceResult>;
  openRecentProject: (filePath: string) => Promise<OpenWorkspaceResult>;
  newProject: () => Promise<OpenWorkspaceResult>;
  getRecentProjects: () => Promise<RecentProject[]>;
  removeRecentProject: (filePath: string) => Promise<RecentProject[]>;
  confirmUnsavedStories: (storyNames: string[], action: string) => Promise<UnsavedChoice>;
  refreshWorkspace: () => Promise<WorkspaceInfo | undefined>;
  openWorkspaceStory: (relativePath: string) => Promise<OpenStoryResult>;
  createWorkspaceDirectory: (parent: string, name: string) => Promise<WorkspaceInfo>;
  createWorkspaceStory: (request: CreateWorkspaceStoryRequest) => Promise<OpenStoryResult>;
  createWorkspaceProject: (request: CreateWorkspaceProjectRequest) => Promise<WorkspaceInfo>;
  syncWorkspaceProject: () => Promise<WorkspaceInfo>;
  setStoryDirty: (dirty: boolean) => void;
  onSaveBeforeClose: (listener: () => void) => () => void;
  finishClose: (saved: boolean) => void;
}
import type { StoryProjectDocument } from '@story-blueprint/common';
