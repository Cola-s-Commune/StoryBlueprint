import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
} from '../packages/editor/src/renderer/settings/editorSettings';

const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, String(val)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

const originalWindow = (globalThis as unknown as { window?: unknown }).window;

describe('EditorSettings', () => {
  beforeEach(() => {
    storage.clear();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: mockLocalStorage,
    };
  });

  afterAll(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('defaults experimental.aiCommands to false', () => {
    expect(DEFAULT_EDITOR_SETTINGS.experimental.aiCommands).toBe(false);
    expect(loadEditorSettings().experimental.aiCommands).toBe(false);
  });

  it('persists and loads settings from localStorage', () => {
    const custom: EditorSettings = {
      experimental: {
        aiCommands: true,
      },
    };
    saveEditorSettings(custom);
    expect(mockLocalStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"aiCommands":true');

    const loaded = loadEditorSettings();
    expect(loaded.experimental.aiCommands).toBe(true);
  });

  it('handles malformed localStorage safely without throwing', () => {
    mockLocalStorage.setItem(SETTINGS_STORAGE_KEY, '{invalid json');
    const loaded = loadEditorSettings();
    expect(loaded).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('handles partial settings safely', () => {
    mockLocalStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({}));
    const loaded = loadEditorSettings();
    expect(loaded.experimental.aiCommands).toBe(false);
  });

  it('handles environment without window.localStorage gracefully', () => {
    (globalThis as unknown as { window: unknown }).window = undefined;
    expect(loadEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(() => saveEditorSettings(DEFAULT_EDITOR_SETTINGS)).not.toThrow();
  });
});
