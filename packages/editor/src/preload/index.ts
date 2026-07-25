import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/electronApi';

const electronAPI = {
  platform: process.platform,
  isElectron: true,
  openStory: () => ipcRenderer.invoke('story:open'),
  saveStory: (request) => ipcRenderer.invoke('story:save', request),
  setStoryDirty: (dirty) => ipcRenderer.send('story:set-dirty', dirty),
} satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
