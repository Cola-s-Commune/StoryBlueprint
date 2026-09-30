import {
  createContext,
  useCallback,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
} from './editorSettings';

interface EditorSettingsContextValue {
  settings: EditorSettings;
  updateSettings: (updater: (prev: EditorSettings) => EditorSettings) => void;
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

const EditorSettingsContext = createContext<EditorSettingsContextValue | undefined>(undefined);

export function EditorSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<EditorSettings>(() => loadEditorSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const updateSettings = useCallback((updater: (prev: EditorSettings) => EditorSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      saveEditorSettings(next);
      return next;
    });
  }, []);

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  return (
    <EditorSettingsContext.Provider
      value={{
        settings,
        updateSettings,
        isSettingsOpen,
        openSettings,
        closeSettings,
      }}
    >
      {children}
    </EditorSettingsContext.Provider>
  );
}

export function useEditorSettings(): EditorSettingsContextValue {
  const context = useContext(EditorSettingsContext);
  if (!context) {
    throw new Error('useEditorSettings must be used within an EditorSettingsProvider');
  }
  return context;
}
