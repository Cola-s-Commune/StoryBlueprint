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
  };
}
