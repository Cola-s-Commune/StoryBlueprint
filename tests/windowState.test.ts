import { describe, expect, it } from 'vitest';
import {
  isPersistedWindowState,
  resolveWindowBounds,
  type PersistedWindowState,
} from '../packages/editor/src/main/windowState';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };

describe('window state', () => {
  it('restores and clamps a visible window to its display work area', () => {
    const stored: PersistedWindowState = {
      x: 1700,
      y: 900,
      width: 1400,
      height: 900,
      maximized: false,
    };
    expect(resolveWindowBounds(stored, [primary], primary, { width: 1400, height: 900 })).toEqual({
      x: 520,
      y: 140,
      width: 1400,
      height: 900,
    });
  });

  it('centers the window on the primary display after a monitor is removed', () => {
    const stored: PersistedWindowState = {
      x: 2600,
      y: 120,
      width: 1200,
      height: 800,
      maximized: true,
    };
    expect(resolveWindowBounds(stored, [primary], primary, { width: 1400, height: 900 })).toEqual({
      x: 260,
      y: 70,
      width: 1400,
      height: 900,
    });
  });

  it('rejects malformed persisted state', () => {
    expect(isPersistedWindowState({ x: 0, y: 0, width: 1400, height: 900 })).toBe(false);
    expect(isPersistedWindowState({ x: 0, y: 0, width: 1400, height: 900, maximized: false })).toBe(
      true,
    );
  });
});
