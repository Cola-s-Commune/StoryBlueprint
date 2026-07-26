import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';

const electronAPI = {
  platform: process.platform,
  isElectron: true,
  openStory: () => ipcRenderer.invoke('story:open'),
  saveStory: (request) => ipcRenderer.invoke('story:save', request),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  openProject: () => ipcRenderer.invoke('workspace:open-project'),
  openRecentProject: (filePath) => ipcRenderer.invoke('workspace:open-recent-project', filePath),
  newProject: () => ipcRenderer.invoke('workspace:new-project'),
  getRecentProjects: () => ipcRenderer.invoke('workspace:get-recent-projects'),
  removeRecentProject: (filePath) => ipcRenderer.invoke('workspace:remove-recent-project', filePath),
  confirmUnsavedStories: (storyNames, action) =>
    ipcRenderer.invoke('story:confirm-unsaved', storyNames, action),
  restoreEditorSession: () => ipcRenderer.invoke('session:restore'),
  updateEditorSession: (session) => ipcRenderer.invoke('session:update', session),
  writeRecoverySnapshots: (snapshots) => ipcRenderer.invoke('recovery:write', snapshots),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
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
