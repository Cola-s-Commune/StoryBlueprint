import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';

const electronAPI = {
  platform: process.platform,
  isElectron: true,
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  setWindowZoom: (action) => ipcRenderer.invoke('app:set-window-zoom', action),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  revealLogs: () => ipcRenderer.invoke('app:reveal-logs'),
  reportRendererError: (scope, message) =>
    ipcRenderer.invoke('app:report-renderer-error', scope, message),
  getUpdateSettings: () => ipcRenderer.invoke('app:get-update-settings'),
  updateUpdateSettings: (settings) => ipcRenderer.invoke('app:update-update-settings', settings),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: (kind) => ipcRenderer.invoke('app:download-update', kind),
  cancelUpdateDownload: () => ipcRenderer.invoke('app:cancel-update-download'),
  revealDownloadedUpdate: (path) => ipcRenderer.invoke('app:reveal-downloaded-update', path),
  installDownloadedUpdate: (path) => ipcRenderer.invoke('app:install-downloaded-update', path),
  onUpdateDownloadProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('app:update-download-progress', handler);
    return () => ipcRenderer.removeListener('app:update-download-progress', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getWindowState: () => ipcRenderer.invoke('app:get-window-state'),
  minimizeWindow: () => ipcRenderer.invoke('app:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('app:close-window'),
  onWindowStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on('app:window-state-changed', handler);
    return () => ipcRenderer.removeListener('app:window-state-changed', handler);
  },
  openStory: () => ipcRenderer.invoke('story:open'),
  readStoryGitConflict: (filePath, fileToken) =>
    ipcRenderer.invoke('story:read-git-conflict', filePath, fileToken),
  readWorkspaceGitConflicts: () => ipcRenderer.invoke('workspace:read-git-conflicts'),
  validateWorkspaceMerge: (files) => ipcRenderer.invoke('workspace:validate-merge', files),
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
  clearRecoverySnapshots: () => ipcRenderer.invoke('recovery:clear'),
  saveRecoveryAs: (snapshot) => ipcRenderer.invoke('recovery:save-as', snapshot),
  readWorkspaceProjectStories: () => ipcRenderer.invoke('workspace:read-project-stories'),
  updateWorkspaceProjectStories: (request) =>
    ipcRenderer.invoke('workspace:update-project-stories', request),
  exportCompiledProject: (content) => ipcRenderer.invoke('workspace:export-compiled', content),
  openCompiledProject: () => ipcRenderer.invoke('workspace:open-compiled'),
  openInkFile: () => ipcRenderer.invoke('workspace:open-ink'),
  updateProjectSettings: (settings) =>
    ipcRenderer.invoke('workspace:update-project-settings', settings),
  extractProjectLocalization: (sourceLocale) =>
    ipcRenderer.invoke('workspace:extract-localization', sourceLocale),
  updateProjectLocalization: (document) =>
    ipcRenderer.invoke('workspace:update-localization', document),
  getAIProviderRegistry: () => ipcRenderer.invoke('ai:get-provider-registry'),
  getAIInstructionsStatus: () => ipcRenderer.invoke('ai:get-instructions-status'),
  saveAIProviderProfile: (settings) => ipcRenderer.invoke('ai:save-provider-profile', settings),
  deleteAIProviderProfile: (providerId) =>
    ipcRenderer.invoke('ai:delete-provider-profile', providerId),
  selectAIProvider: (providerId) => ipcRenderer.invoke('ai:select-provider', providerId),
  generateAICommand: (request) => ipcRenderer.invoke('ai:generate-command', request),
  onAIStreamProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('ai:stream-progress', handler);
    return () => ipcRenderer.removeListener('ai:stream-progress', handler);
  },
  pickAIContextFiles: () => ipcRenderer.invoke('ai:pick-context-files'),
  cancelAICommand: (requestId) => ipcRenderer.send('ai:cancel-command', requestId),
  listAIChatSessions: (scopeKey) => ipcRenderer.invoke('ai:list-chat-sessions', scopeKey),
  saveAIChatSession: (session) => ipcRenderer.invoke('ai:save-chat-session', session),
  deleteAIChatSession: (scopeKey, sessionId) =>
    ipcRenderer.invoke('ai:delete-chat-session', scopeKey, sessionId),
  createProjectCharacter: (character) =>
    ipcRenderer.invoke('workspace:create-character', character),
  saveCharacterTemplate: (template) =>
    ipcRenderer.invoke('workspace:save-character-template', template),
  updateProjectCharacter: (relativePath, character) =>
    ipcRenderer.invoke('workspace:update-character', relativePath, character),
  deleteProjectCharacter: (relativePath) =>
    ipcRenderer.invoke('workspace:delete-character', relativePath),
  createProjectAsset: (asset) => ipcRenderer.invoke('workspace:create-asset', asset),
  updateProjectAsset: (relativePath, asset) =>
    ipcRenderer.invoke('workspace:update-asset', relativePath, asset),
  deleteProjectAsset: (relativePath) => ipcRenderer.invoke('workspace:delete-asset', relativePath),
  restoreProjectResources: (snapshot) =>
    ipcRenderer.invoke('workspace:restore-project-resources', snapshot),
  restoreWorkspaceStory: (relativePath, content) =>
    ipcRenderer.invoke('workspace:restore-story', relativePath, content),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  initializeWorkspaceGit: () => ipcRenderer.invoke('workspace:initialize-git'),
  reloadWorkspaceAfterGitChange: (stories) =>
    ipcRenderer.invoke('workspace:reload-after-git-change', stories),
  confirmGitReload: (storyNames) => ipcRenderer.invoke('workspace:confirm-git-reload', storyNames),
  onWorkspaceGitChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, git: Parameters<typeof listener>[0]) =>
      listener(git);
    ipcRenderer.on('workspace:git-changed', handler);
    return () => ipcRenderer.removeListener('workspace:git-changed', handler);
  },
  onWorkspaceFilesChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, changes: Parameters<typeof listener>[0]) =>
      listener(changes);
    ipcRenderer.on('workspace:files-changed', handler);
    return () => ipcRenderer.removeListener('workspace:files-changed', handler);
  },
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
