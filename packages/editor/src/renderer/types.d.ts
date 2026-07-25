import type { ElectronAPI } from '../shared/electronApi';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
