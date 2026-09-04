import type { ExpressionSource, ValueType } from '@story-blueprint/common';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { readStoryDataDrag } from '../../graph/storyDataDrag';
import {
  expressionCandidates,
  expressionDiagnostic,
  expressionTokenRange,
  insertExpressionCandidate,
  insertExpressionOperator,
} from './expressionAuthoring';
import styles from './ExpressionField.module.css';

interface ExpressionFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  expectedType?: ValueType;
  bindings?: ExpressionSource['bindings'];
  onBeginEdit: () => void;
  onChange: (value: string) => void;
}

function operatorsFor(expectedType?: ValueType): readonly string[] {
  if (expectedType?.kind === 'boolean') return ['&&', '||', '!', '==', '!=', '<', '>', '(', ')'];
  if (expectedType?.kind === 'number') return ['+', '-', '*', '/', '%', '(', ')'];
  if (expectedType?.kind === 'string') return ['+', '(', ')'];
  return ['&&', '||', '!', '==', '!=', '<', '>', '+', '-', '(', ')'];
}

export function ExpressionField({
  label,
  value,
  multiline,
  expectedType,
  bindings,
  onBeginEdit,
  onChange,
}: ExpressionFieldProps) {
  const { availableVariables, projectVariables, characters } = useStoryGraphStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const editing = useRef(false);
  const pendingCursor = useRef<number>();
  const [focused, setFocused] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredValue = useDeferredValue(value);
  const token = expressionTokenRange(value, cursor);
  const query = value.slice(token.start, cursor);
  const candidates = useMemo(
    () =>
      suggestionsOpen
        ? expressionCandidates(
            availableVariables,
            projectVariables,
            characters,
            query,
            expectedType,
          )
        : { results: [], total: 0 },
    [availableVariables, characters, expectedType, projectVariables, query, suggestionsOpen],
  );
  const diagnostic = useMemo(
    () =>
      expressionDiagnostic(
        bindings ? { source: deferredValue, bindings } : deferredValue,
        availableVariables,
        projectVariables,
        characters,
        expectedType,
      ),
    [availableVariables, characters, deferredValue, expectedType, projectVariables],
  );

  useEffect(() => {
    if (pendingCursor.current === undefined) return;
    const nextCursor = pendingCursor.current;
    pendingCursor.current = undefined;
    requestAnimationFrame(() => {
      controlRef.current?.focus();
      controlRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  }, [value]);

  useEffect(() => setActiveIndex(0), [query]);

  const beginEdit = () => {
    if (editing.current) return;
    onBeginEdit();
    editing.current = true;
  };
  const apply = (nextValue: string, nextCursor?: number) => {
    beginEdit();
    if (nextCursor !== undefined) pendingCursor.current = nextCursor;
    onChange(nextValue);
  };
  const updateCursor = () => setCursor(controlRef.current?.selectionStart ?? value.length);
  const chooseCandidate = (index: number) => {
    const candidate = candidates.results[index];
    const control = controlRef.current;
    if (!candidate || !control) return;
    const inserted = insertExpressionCandidate(
      value,
      control.selectionStart ?? cursor,
      control.selectionEnd ?? cursor,
      candidate.insertion,
    );
    apply(inserted.source, inserted.cursor);
    setSuggestionsOpen(false);
  };
  const insertOperator = (operator: string) => {
    const control = controlRef.current;
    if (!control) return;
    const inserted = insertExpressionOperator(
      value,
      control.selectionStart ?? cursor,
      control.selectionEnd ?? cursor,
      operator,
    );
    apply(inserted.source, inserted.cursor);
    setSuggestionsOpen(false);
  };
  const insertLiteral = (literal: string) => {
    const control = controlRef.current;
    if (!control) return;
    const inserted = insertExpressionCandidate(
      value,
      control.selectionStart ?? cursor,
      control.selectionEnd ?? cursor,
      literal,
    );
    apply(inserted.source, inserted.cursor);
    setSuggestionsOpen(false);
  };
  const handleDrop = (event: DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const payload = readStoryDataDrag(event.dataTransfer);
    if (payload?.kind !== 'variable') return;
    const variable =
      availableVariables.find((candidate) => candidate.id === payload.id) ??
      projectVariables.find((candidate) => candidate.id === payload.id);
    let insertion = variable?.name;
    if (!insertion) {
      for (const character of characters) {
        const field = character.fields?.find((candidate) => candidate.id === payload.id);
        if (field) insertion = `${character.name}.${field.name}`;
      }
    }
    if (!insertion) return;
    event.preventDefault();
    const control = event.currentTarget;
    const inserted = insertExpressionCandidate(
      value,
      control.selectionStart ?? value.length,
      control.selectionEnd ?? value.length,
      insertion,
    );
    apply(inserted.source, inserted.cursor);
  };
  const common = {
    ref: controlRef as React.Ref<HTMLInputElement> & React.Ref<HTMLTextAreaElement>,
    value,
    spellCheck: false,
    onPointerDown: (event: React.PointerEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      event.stopPropagation(),
    onFocus: () => {
      setFocused(true);
      updateCursor();
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (rootRef.current?.contains(event.relatedTarget as Node)) return;
      editing.current = false;
      setFocused(false);
      setSuggestionsOpen(false);
    },
    onSelect: updateCursor,
    onClick: updateCursor,
    onDragOver: (event: DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (readStoryDataDrag(event.dataTransfer)?.kind === 'variable') event.preventDefault();
    },
    onDrop: handleDrop,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      apply(event.target.value);
      const nextCursor = event.target.selectionStart ?? event.target.value.length;
      setCursor(nextCursor);
      setSuggestionsOpen(/[A-Za-z0-9_.]$/.test(event.target.value.slice(0, nextCursor)));
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === ' ' && event.ctrlKey) {
        event.preventDefault();
        setSuggestionsOpen(true);
        return;
      }
      if (!suggestionsOpen || candidates.results.length === 0) {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => Math.min(candidates.results.length - 1, current + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        chooseCandidate(activeIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setSuggestionsOpen(false);
      }
    },
  };

  return (
    <div className={styles.field} ref={rootRef}>
      <span>{label}</span>
      <div className={styles.editor}>
        {multiline ? <textarea {...common} rows={4} /> : <input {...common} />}
        {focused && (
          <div className={styles.tools}>
            <button
              type="button"
              className={suggestionsOpen ? styles.activeTool : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSuggestionsOpen((current) => !current)}
              title="Variables (Ctrl+Space)"
            >
              Variable
            </button>
            {expectedType?.kind === 'boolean' && (
              <>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertLiteral('true')}
                >
                  True
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertLiteral('false')}
                >
                  False
                </button>
              </>
            )}
            {operatorsFor(expectedType).map((operator) => (
              <button
                key={operator}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertOperator(operator)}
              >
                {operator}
              </button>
            ))}
          </div>
        )}
        {focused && suggestionsOpen && (
          <div className={styles.suggestions} role="listbox">
            {candidates.results.map((candidate, index) => (
              <button
                key={candidate.variableId}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? styles.activeSuggestion : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseCandidate(index)}
              >
                <span>{candidate.label}</span>
                <small>{candidate.detail}</small>
                <em>{candidate.group}</em>
              </button>
            ))}
            {candidates.results.length === 0 && (
              <div className={styles.empty}>No matching variables.</div>
            )}
            {candidates.total > candidates.results.length && (
              <div className={styles.limit}>
                Showing {candidates.results.length} of {candidates.total}. Keep typing to narrow the
                list.
              </div>
            )}
          </div>
        )}
      </div>
      {diagnostic && (
        <small className={diagnostic.kind === 'error' ? styles.error : styles.valid}>
          {diagnostic.message}
        </small>
      )}
      <small>Drag a variable here, or press Ctrl+Space for suggestions.</small>
    </div>
  );
}
