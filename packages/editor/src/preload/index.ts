import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';

const electronAPI = {
  platform: process.platform,
  isElectron: true,
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  setWindowZoom: (action) => ipcRenderer.invoke('app:set-window-zoom', action),
  openStory: () => ipcRenderer.invoke('story:open'),
  readStoryGitConflict: (filePath, fileToken) =>
    ipcRenderer.invoke('story:read-git-conflict', filePath, fileToken),
  readWorkspaceGitConflicts: () => ipcRenderer.invoke('workspace:read-git-conflicts'),
  applyWorkspaceMerge: (files) => ipcRenderer.invoke('workspace:apply-merge', files),
  saveStory: (request) => ipcRenderer.invoke('story:save', request),
  revealStory: (filePath, fileToken) => ipcRenderer.invoke('story:reveal', filePath, fileToken),
  deleteStory: (filePath, fileToken) => ipcRenderer.invoke('story:delete', filePath, fileToken),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  openProject: () => ipcRenderer.invoke('workspace:open-project'),
  openRecentProject: (filePath) => ipcRenderer.invoke('workspace:open-recent-project', filePath),
  newProject: () => ipcRenderer.invoke('workspace:new-project'),
  getRecentProjects: () => ipcRenderer.invoke('workspace:get-recent-projects'),
  removeRecentProject: (filePath) =>
    ipcRenderer.invoke('workspace:remove-recent-project', filePath),
  confirmUnsavedStories: (storyNames, action) =>
    ipcRenderer.invoke('story:confirm-unsaved', storyNames, action),
  restoreEditorSession: () => ipcRenderer.invoke('session:restore'),
  updateEditorSession: (session) => ipcRenderer.invoke('session:update', session),
  writeRecoverySnapshots: (snapshots) => ipcRenderer.invoke('recovery:write', snapshots),
  readWorkspaceProjectStories: () => ipcRenderer.invoke('workspace:read-project-stories'),
  exportCompiledProject: (content) => ipcRenderer.invoke('workspace:export-compiled', content),
  openCompiledProject: () => ipcRenderer.invoke('workspace:open-compiled'),
  updateProjectSettings: (settings) =>
    ipcRenderer.invoke('workspace:update-project-settings', settings),
  getAIProviderSettings: () => ipcRenderer.invoke('ai:get-provider-settings'),
  updateAIProviderSettings: (settings) =>
    ipcRenderer.invoke('ai:update-provider-settings', settings),
  generateAICommand: (request) => ipcRenderer.invoke('ai:generate-command', request),
  cancelAICommand: (requestId) => ipcRenderer.send('ai:cancel-command', requestId),
  listAIChatSessions: (scopeKey) => ipcRenderer.invoke('ai:list-chat-sessions', scopeKey),
  saveAIChatSession: (session) => ipcRenderer.invoke('ai:save-chat-session', session),
  deleteAIChatSession: (scopeKey, sessionId) =>
    ipcRenderer.invoke('ai:delete-chat-session', scopeKey, sessionId),
  createProjectCharacter: (character) =>
    ipcRenderer.invoke('workspace:create-character', character),
  updateProjectCharacter: (relativePath, character) =>
    ipcRenderer.invoke('workspace:update-character', relativePath, character),
  deleteProjectCharacter: (relativePath) =>
    ipcRenderer.invoke('workspace:delete-character', relativePath),
  createProjectAsset: (asset) => ipcRenderer.invoke('workspace:create-asset', asset),
  updateProjectAsset: (relativePath, asset) =>
    ipcRenderer.invoke('workspace:update-asset', relativePath, asset),
  deleteProjectAsset: (relativePath) => ipcRenderer.invoke('workspace:delete-asset', relativePath),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  revealWorkspaceItem: (relativePath) => ipcRenderer.invoke('workspace:reveal-item', relativePath),
  deleteWorkspaceStory: (relativePath) =>
    ipcRenderer.invoke('workspace:delete-story', relativePath),
  deleteWorkspaceProject: (relativePath) =>
    ipcRenderer.invoke('workspace:delete-project', relativePath),
  openWorkspaceStory: (relativePath) => ipcRenderer.invoke('workspace:open-story', relativePath),
  createWorkspaceDirectory: (parent, name) =>
    ipcRenderer.invoke('workspace:create-directory', parent, name),
  createWorkspaceStory: (request) => ipcRenderer.invoke('workspace:create-story', request),
  createWorkspaceProject: (request) => ipcRenderer.invoke('workspace:create-project', request),
  syncWorkspaceProject: () => ipcRenderer.invoke('workspace:sync-project'),
  setStoryDirty: (dirty) => ipcRenderer.send('story:set-dirty', dirty),
  onSaveBeforeClose: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:save-before-close', handler);
    return () => ipcRenderer.removeListener('app:save-before-close', handler);
  },
  finishClose: (saved) => ipcRenderer.send('app:finish-close', saved),
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
