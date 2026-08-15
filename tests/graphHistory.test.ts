import { describe, expect, it } from 'vitest';
import { GraphHistory } from '../packages/editor/src/renderer/graph/graphHistory';

describe('named graph history', () => {
  it('carries operation names through undo and redo', () => {
    const history = new GraphHistory<{ value: number }>();
    history.checkpoint({ value: 1 }, 'Delete Character');
    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('Delete Character');
    expect(history.undo({ value: 2 })).toEqual({
      state: { value: 1 },
      label: 'Delete Character',
    });
    expect(history.redoLabel).toBe('Delete Character');
    expect(history.redo({ value: 1 })?.state).toEqual({ value: 2 });
  });

  it('clears redo after a new edit and evicts complete entries', () => {
    const history = new GraphHistory<number>(2);
    history.checkpoint(0, 'First');
    history.checkpoint(1, 'Second');
    history.checkpoint(2, 'Third');
    expect(history.undo(3)?.label).toBe('Third');
    history.checkpoint(2, 'Replacement');
    expect(history.canRedo).toBe(false);
    expect(history.undo(4)?.state).toBe(2);
    expect(history.undo(2)?.state).toBe(1);
    expect(history.undo(1)).toBeNull();
  });

  it('lists navigation targets and travels across several operations', () => {
    const history = new GraphHistory<number>();
    history.checkpoint(0, 'Add A');
    history.checkpoint(1, 'Add B');
    history.checkpoint(2, 'Add C');

    expect(history.undoEntries).toEqual([
      { label: 'Add C', steps: -1 },
      { label: 'Add B', steps: -2 },
      { label: 'Add A', steps: -3 },
    ]);
    expect(history.travel(3, -2)?.state).toBe(1);
    expect(history.undoLabel).toBe('Add A');
    expect(history.redoEntries).toEqual([
      { label: 'Add B', steps: 1 },
      { label: 'Add C', steps: 2 },
    ]);
    expect(history.travel(1, 2)?.state).toBe(3);
    expect(history.canRedo).toBe(false);
  });

  it('isolates nested project resource snapshots while traveling', () => {
    const history = new GraphHistory<{
      asset: { name: string; locales: Record<string, string> };
    }>();
    const before = { asset: { name: 'voice', locales: { default: 'old.wav' } } };
    history.checkpoint(before, 'Edit Asset');
    before.asset.locales.default = 'mutated-after-checkpoint.wav';

    const undone = history.travel(
      { asset: { name: 'voice', locales: { default: 'new.wav' } } },
      -1,
    );
    expect(undone?.state.asset.locales.default).toBe('old.wav');

    undone!.state.asset.locales.default = 'mutated-after-undo.wav';
    expect(history.travel(undone!.state, 1)?.state.asset.locales.default).toBe('new.wav');
  });
});
