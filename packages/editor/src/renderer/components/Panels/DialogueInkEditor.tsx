import Editor, { loader, type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { useEffect, useRef, useState } from 'react';
import type { DialogueInkDiagnostic } from '../../dialogue/dialogueInk';
import styles from './Inspector.module.css';

let languageRegistered = false;
const INK_ZOOM_STORAGE_KEY = 'story-blueprint.dialogue-ink.zoom';
const MIN_ZOOM = 80;
const MAX_ZOOM = 200;

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value / 10) * 10));
}

function initialZoom(): number {
  const stored = Number.parseInt(localStorage.getItem(INK_ZOOM_STORAGE_KEY) ?? '', 10);
  return Number.isFinite(stored) ? clampZoom(stored) : 100;
}

loader.config({ monaco: monacoApi });
(
  globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker(): Worker } }
).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const registerLanguage: BeforeMount = (monaco) => {
  if (languageRegistered) return;
  languageRegistered = true;
  monaco.languages.register({ id: 'story-dialogue-ink' });
  monaco.languages.setMonarchTokensProvider('story-dialogue-ink', {
    tokenizer: {
      root: [
        [/\\#/, 'string.escape'],
        [/^[^:#]+(?=:)/, 'type.identifier'],
        [/#\s*(?:emotion|voice)\s*:/, 'keyword'],
        [/#\s*[^#]+/, 'comment'],
        [/\{[^{}]+\}/, 'variable'],
      ],
    },
  });
};

function selectedText(editor: Parameters<OnMount>[0]): string {
  const model = editor.getModel();
  const selections = editor.getSelections();
  if (!model || !selections || selections.length === 0) return '';
  return selections
    .map((selection) => {
      if (!selection.isEmpty()) return model.getValueInRange(selection);
      return `${model.getLineContent(selection.positionLineNumber)}\n`;
    })
    .join('');
}

async function copyEditorSelection(editor: Parameters<OnMount>[0]): Promise<void> {
  const text = selectedText(editor);
  if (window.electronAPI?.copyText) {
    await window.electronAPI.copyText(text);
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

async function pasteIntoEditor(editor: Parameters<OnMount>[0]): Promise<void> {
  const text = window.electronAPI?.readClipboardText
    ? await window.electronAPI.readClipboardText()
    : await navigator.clipboard?.readText?.();
  const selections = editor.getSelections();
  if (text === undefined || !selections || selections.length === 0) return;
  editor.pushUndoStop();
  editor.executeEdits(
    'story-dialogue-ink.clipboard',
    selections.map((selection) => ({ range: selection, text, forceMoveMarkers: true })),
  );
  editor.pushUndoStop();
  editor.focus();
}

export function DialogueInkEditor({
  nodeId,
  value,
  diagnostics,
  dirty,
  focusLine,
  onChange,
  onSave,
  onRevert,
}: {
  nodeId: string;
  value: string;
  diagnostics: readonly DialogueInkDiagnostic[];
  dirty: boolean;
  focusLine?: number;
  onChange: (value: string) => void;
  onSave: (saveAs?: boolean) => void;
  onRevert: () => void;
}) {
  const editorRef = useRef<Parameters<OnMount>[0]>();
  const monacoRef = useRef<Monaco>();
  const saveRef = useRef(onSave);
  const focusLineRef = useRef(focusLine);
  const [zoom, setZoom] = useState(initialZoom);
  const [expanded, setExpanded] = useState(false);
  saveRef.current = onSave;
  focusLineRef.current = focusLine;

  const revealLine = (editor: Parameters<OnMount>[0], requestedLine?: number) => {
    const model = editor.getModel();
    if (!model || requestedLine === undefined) return;
    const lineNumber = Math.max(1, Math.min(requestedLine, model.getLineCount()));
    const endColumn = model.getLineMaxColumn(lineNumber);
    editor.setSelection({
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn,
    });
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
    editor.focus();
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addAction({
      id: 'story-dialogue-ink.save',
      label: 'Save Dialogue Ink',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => saveRef.current(false),
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
      void copyEditorSelection(editor);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
      void pasteIntoEditor(editor);
    });
    editor.onKeyDown((event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.browserEvent.key;
      if (key.toLocaleLowerCase() === 's' && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        saveRef.current(event.shiftKey);
        return;
      }
      if (key !== '+' && key !== '=' && key !== '-' && key !== '0') return;
      event.preventDefault();
      event.stopPropagation();
      if (key === '0') setZoom(100);
      else setZoom((current) => clampZoom(current + (key === '-' ? -10 : 10)));
    });
    requestAnimationFrame(() => revealLine(editor, focusLineRef.current));
  };

  useEffect(() => {
    localStorage.setItem(INK_ZOOM_STORAGE_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    if (editorRef.current) revealLine(editorRef.current, focusLine);
  }, [focusLine]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'story-dialogue-ink',
      diagnostics.map((diagnostic) => ({
        severity: monaco.MarkerSeverity.Error,
        message: diagnostic.message,
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.line,
        endColumn: diagnostic.endColumn,
      })),
    );
  }, [diagnostics]);

  return (
    <div className={styles.inkEditorPanel}>
      <div className={styles.inkToolbar}>
        <strong>Dialogue Ink</strong>
        <div className={styles.inkZoomControls}>
          <button
            type="button"
            title="Zoom out · Ctrl+-"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current - 10))}
          >
            −
          </button>
          <button type="button" title="Reset zoom · Ctrl+0" onClick={() => setZoom(100)}>
            {zoom}%
          </button>
          <button
            type="button"
            title="Zoom in · Ctrl++"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current + 10))}
          >
            +
          </button>
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? 'Normal height' : 'Expand height'}
          </button>
        </div>
      </div>
      <div className={styles.inkHelp}>
        Write <code>Character: dialogue</code>. Line metadata uses <code># emotion:name</code> and{' '}
        <code># voice:name</code>; trailing speaker tags are invalid.
      </div>
      <div className={`${styles.inkEditor} ${expanded ? styles.inkEditorExpanded : ''}`}>
        <Editor
          beforeMount={registerLanguage}
          onMount={handleMount}
          path={`dialogue://${nodeId}.ink`}
          language="story-dialogue-ink"
          theme="vs-dark"
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? '')}
          options={{
            minimap: { enabled: false },
            overviewRulerLanes: 0,
            lineNumbersMinChars: 3,
            fontSize: Math.round((12 * zoom) / 100),
            lineHeight: Math.round((20 * zoom) / 100),
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'line',
          }}
        />
      </div>
      {diagnostics.length > 0 && (
        <div className={styles.inkDiagnostics}>
          {diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.line}:${diagnostic.column}:${index}`}>
              Line {diagnostic.line}: {diagnostic.message}
            </div>
          ))}
        </div>
      )}
      <div className={styles.inkActions}>
        <span>{dirty ? 'Unsaved changes' : 'Lines and Ink are synchronized'}</span>
        <button type="button" disabled={!dirty} onClick={onRevert}>
          Revert
        </button>
        <button type="button" disabled={diagnostics.length > 0} onClick={() => onSave(false)}>
          Save · Ctrl+S
        </button>
      </div>
    </div>
  );
}
