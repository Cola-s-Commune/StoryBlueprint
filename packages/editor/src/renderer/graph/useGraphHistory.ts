import { useCallback, useMemo, useRef, useState } from 'react';
import { GraphHistory } from './graphHistory';

export function useGraphHistory<State>(limit = 100) {
  const history = useRef(new GraphHistory<State>(limit));
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  const checkpoint = useCallback(
    (state: State, label = 'Edit') => {
      history.current.checkpoint(state, label);
      refresh();
    },
    [refresh],
  );
  const undo = useCallback(
    (current: State) => {
      const entry = history.current.undo(current);
      if (entry) refresh();
      return entry;
    },
    [refresh],
  );
  const redo = useCallback(
    (current: State) => {
      const entry = history.current.redo(current);
      if (entry) refresh();
      return entry;
    },
    [refresh],
  );
  const travel = useCallback(
    (current: State, steps: number) => {
      const entry = history.current.travel(current, steps);
      if (entry) refresh();
      return entry;
    },
    [refresh],
  );
  const clear = useCallback(() => {
    history.current.clear();
    refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      checkpoint,
      undo,
      redo,
      travel,
      clear,
      canUndo: history.current.canUndo,
      canRedo: history.current.canRedo,
      undoLabel: history.current.undoLabel,
      redoLabel: history.current.redoLabel,
      undoEntries: history.current.undoEntries,
      redoEntries: history.current.redoEntries,
    }),
    [checkpoint, clear, redo, travel, undo, revision],
  );
}
