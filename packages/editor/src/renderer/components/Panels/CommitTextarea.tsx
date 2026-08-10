import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from './CopyButton';
import styles from './StoryData.module.css';

export interface CommitTextareaProps {
  label: string;
  value: string;
  rows: number;
  placeholder?: string;
  saveError?: string;
  delayMs?: number;
  onCommit: (value: string) => void;
}

export function CommitTextarea({
  label,
  value,
  rows,
  placeholder,
  saveError,
  delayMs = 600,
  onCommit,
}: CommitTextareaProps) {
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const cancelingRef = useRef(false);
  const beforeEditRef = useRef(value);
  const lastAttemptedRef = useRef<string>();
  const committedDuringEditRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const commit = useCallback(
    (nextValue: string) => {
      if (nextValue === value || lastAttemptedRef.current === nextValue) return;
      lastAttemptedRef.current = nextValue;
      if (editingRef.current) committedDuringEditRef.current = true;
      onCommitRef.current(nextValue);
    },
    [value],
  );

  useEffect(() => {
    if (editingRef.current || saveError) return;
    setDraft(value);
    lastAttemptedRef.current = undefined;
  }, [saveError, value]);

  useEffect(() => {
    if (draft === value || lastAttemptedRef.current === draft) return;
    const timeout = window.setTimeout(() => commit(draft), delayMs);
    return () => window.clearTimeout(timeout);
  }, [commit, delayMs, draft, value]);

  return (
    <label>
      <span>{label}</span>
      <textarea
        rows={rows}
        placeholder={placeholder}
        value={draft}
        onFocus={() => {
          editingRef.current = true;
          beforeEditRef.current = value;
          committedDuringEditRef.current = false;
        }}
        onChange={(event) => {
          lastAttemptedRef.current = undefined;
          setDraft(event.target.value);
        }}
        onBlur={() => {
          editingRef.current = false;
          if (cancelingRef.current) {
            cancelingRef.current = false;
            return;
          }
          commit(draft);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            commit(draft);
            return;
          }
          if (event.key !== 'Escape') return;
          const beforeEdit = beforeEditRef.current;
          cancelingRef.current = true;
          lastAttemptedRef.current = undefined;
          setDraft(beforeEdit);
          if (committedDuringEditRef.current && beforeEdit !== value) {
            onCommitRef.current(beforeEdit);
          }
          event.currentTarget.blur();
        }}
      />
      {saveError && lastAttemptedRef.current !== undefined && (
        <span className={styles.draftSaveError}>
          <span>{saveError}</span>
          <CopyButton text={saveError} label="Copy Error" />
        </span>
      )}
    </label>
  );
}
