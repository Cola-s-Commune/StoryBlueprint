import Editor, { loader, type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { useEffect, useRef } from 'react';
import type { DialogueInkDiagnostic } from '../../dialogue/dialogueInk';
import styles from './Inspector.module.css';

let languageRegistered = false;

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
        [/#\s*(?:speaker|emotion|voice)\s*:/, 'keyword'],
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
  onApply,
  onRevert,
}: {
  nodeId: string;
  value: string;
  diagnostics: readonly DialogueInkDiagnostic[];
  dirty: boolean;
  focusLine?: number;
  onChange: (value: string) => void;
  onApply: () => void;
  onRevert: () => void;
}) {
  const editorRef = useRef<Parameters<OnMount>[0]>();
  const monacoRef = useRef<Monaco>();
  const applyRef = useRef(onApply);
  const focusLineRef = useRef(focusLine);
  applyRef.current = onApply;
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
      id: 'story-dialogue-ink.apply',
      label: 'Apply Dialogue Ink',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => applyRef.current(),
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
      void copyEditorSelection(editor);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
      void pasteIntoEditor(editor);
    });
    requestAnimationFrame(() => revealLine(editor, focusLineRef.current));
  };

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
      <div className={styles.inkHelp}>
        One physical line is one dialogue line. Metadata uses <code># speaker:name</code>,{' '}
        <code># emotion:name</code>, and <code># voice:name</code>.
      </div>
      <div className={styles.inkEditor}>
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
            fontSize: 12,
            lineHeight: 20,
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
        <span>{dirty ? 'Unapplied changes' : 'Lines and Ink are synchronized'}</span>
        <button type="button" disabled={!dirty} onClick={onRevert}>
          Revert
        </button>
        <button type="button" disabled={!dirty || diagnostics.length > 0} onClick={onApply}>
          Apply · Ctrl+Enter
        </button>
      </div>
    </div>
  );
}
