export interface EditorSettings {
  experimental: {
    aiCommands: boolean;
  };
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  experimental: {
    aiCommands: true,
  },
};

export const SETTINGS_STORAGE_KEY = 'story-blueprint:settings:v1';

export function loadEditorSettings(): EditorSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_EDITOR_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_EDITOR_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<EditorSettings>;
    return {
      experimental: {
        aiCommands:
          parsed.experimental?.aiCommands !== undefined
            ? Boolean(parsed.experimental.aiCommands)
            : DEFAULT_EDITOR_SETTINGS.experimental.aiCommands,
      },
    };
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }
}

export function saveEditorSettings(settings: EditorSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save editor settings:', error);
  }
}
