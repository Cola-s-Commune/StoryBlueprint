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

export interface ElectronAPI {
  platform: string;
  isElectron: true;
  openStory: () => Promise<OpenStoryResult>;
  saveStory: (request: SaveStoryRequest) => Promise<SaveStoryResult>;
  setStoryDirty: (dirty: boolean) => void;
}
