import { useCallback, useMemo, useRef } from 'react';
import type { EditorGraphState } from './editorGraph';

function cloneGraph(graph: EditorGraphState): EditorGraphState {
  return structuredClone(graph);
}

export function useGraphHistory(limit = 100) {
  const past = useRef<EditorGraphState[]>([]);
  const future = useRef<EditorGraphState[]>([]);

  const checkpoint = useCallback(
    (graph: EditorGraphState) => {
      past.current.push(cloneGraph(graph));
      if (past.current.length > limit) past.current.shift();
      future.current = [];
    },
    [limit],
  );

  const undo = useCallback((current: EditorGraphState): EditorGraphState | null => {
    const previous = past.current.pop();
    if (!previous) return null;
    future.current.push(cloneGraph(current));
    return cloneGraph(previous);
  }, []);

  const redo = useCallback((current: EditorGraphState): EditorGraphState | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push(cloneGraph(current));
    return cloneGraph(next);
  }, []);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
  }, []);

  return useMemo(() => ({ checkpoint, undo, redo, clear }), [checkpoint, undo, redo, clear]);
}
