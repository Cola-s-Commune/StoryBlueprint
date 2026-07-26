import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';

const electronAPI = {
  platform: process.platform,
  isElectron: true,
  openStory: () => ipcRenderer.invoke('story:open'),
  saveStory: (request) => ipcRenderer.invoke('story:save', request),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  openWorkspaceStory: (relativePath) => ipcRenderer.invoke('workspace:open-story', relativePath),
  createWorkspaceDirectory: (parent, name) =>
    ipcRenderer.invoke('workspace:create-directory', parent, name),
  createWorkspaceStory: (request) => ipcRenderer.invoke('workspace:create-story', request),
  createWorkspaceProject: (request) => ipcRenderer.invoke('workspace:create-project', request),
  syncWorkspaceProject: () => ipcRenderer.invoke('workspace:sync-project'),
  setStoryDirty: (dirty) => ipcRenderer.send('story:set-dirty', dirty),
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
