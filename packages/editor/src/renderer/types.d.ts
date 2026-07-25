declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

interface Window {
  electronAPI?: {
    platform: string;
    isElectron: boolean;
    send: (channel: string, ...args: unknown[]) => void;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => void;
    openStory: () => Promise<
      { canceled: true } | { canceled: false; filePath: string; content: string }
    >;
    saveStory: (request: {
      filePath?: string;
      content: string;
      saveAs?: boolean;
    }) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
    setStoryDirty: (dirty: boolean) => void;
  };
}
