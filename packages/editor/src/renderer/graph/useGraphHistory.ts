import { useCallback, useMemo, useRef } from 'react';

function cloneState<State>(state: State): State {
  return structuredClone(state);
}

export function useGraphHistory<State>(limit = 100) {
  const past = useRef<State[]>([]);
  const future = useRef<State[]>([]);

  const checkpoint = useCallback(
    (state: State) => {
      past.current.push(cloneState(state));
      if (past.current.length > limit) past.current.shift();
      future.current = [];
    },
    [limit],
  );

  const undo = useCallback((current: State): State | null => {
    const previous = past.current.pop();
    if (!previous) return null;
    future.current.push(cloneState(current));
    return cloneState(previous);
  }, []);

  const redo = useCallback((current: State): State | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push(cloneState(current));
    return cloneState(next);
  }, []);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
  }, []);

  return useMemo(() => ({ checkpoint, undo, redo, clear }), [checkpoint, undo, redo, clear]);
}
