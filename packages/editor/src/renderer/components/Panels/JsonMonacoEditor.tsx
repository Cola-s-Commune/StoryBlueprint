import Editor, { type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import { useRef } from 'react';
import './monacoSetup';

let jsonLanguageRegistered = false;

const registerJsonLanguage: BeforeMount = (monaco) => {
  if (jsonLanguageRegistered) return;
  jsonLanguageRegistered = true;
  monaco.languages.register({ id: 'story-json' });
  monaco.languages.setLanguageConfiguration('story-json', {
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });
  monaco.languages.setMonarchTokensProvider('story-json', {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type.identifier'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false)\b/, 'keyword'],
        [/\bnull\b/, 'constant'],
        [/[{}\[\]]/, '@brackets'],
        [/[,:]/, 'delimiter'],
      ],
    },
  });
};

function selectedText(editor: Parameters<OnMount>[0]): string {
  const model = editor.getModel();
  const selections = editor.getSelections();
  if (!model || !selections) return '';
  return selections.map((selection) => model.getValueInRange(selection)).join('');
}

async function copySelection(editor: Parameters<OnMount>[0]): Promise<void> {
  const text = selectedText(editor);
  if (window.electronAPI?.copyText) await window.electronAPI.copyText(text);
  else await navigator.clipboard?.writeText?.(text);
}

async function pasteSelection(editor: Parameters<OnMount>[0]): Promise<void> {
  const text = window.electronAPI?.readClipboardText
    ? await window.electronAPI.readClipboardText()
    : await navigator.clipboard?.readText?.();
  const selections = editor.getSelections();
  if (text === undefined || !selections?.length) return;
  editor.pushUndoStop();
  editor.executeEdits(
    'story-json.clipboard',
    selections.map((selection) => ({ range: selection, text, forceMoveMarkers: true })),
  );
  editor.pushUndoStop();
  editor.focus();
}

export function JsonMonacoEditor({
  value,
  onChange,
  onCommit,
  onRevert,
  onDiagnostic,
  validateValue,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onRevert: () => void;
  onDiagnostic: (message?: string) => void;
  validateValue: (value: unknown) => string | undefined;
  onSave: () => void;
}) {
  const editorRef = useRef<Parameters<OnMount>[0]>();
  const monacoRef = useRef<Monaco>();
  const commitRef = useRef(onCommit);
  const revertRef = useRef(onRevert);
  const saveRef = useRef(onSave);
  commitRef.current = onCommit;
  revertRef.current = onRevert;
  saveRef.current = onSave;

  const validate = (source: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    try {
      const parsed = JSON.parse(source) as unknown;
      const semanticError = validateValue(parsed);
      if (semanticError) throw new Error(semanticError);
      monaco.editor.setModelMarkers(model, 'story-json', []);
      onDiagnostic(undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const offsetMatch = /position\s+(\d+)/i.exec(message);
      const lineColumnMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
      const reservedMarkerOffset = source.indexOf('$storyBlueprintType');
      const position = reservedMarkerOffset >= 0 && message.includes('$storyBlueprintType')
        ? model.getPositionAt(reservedMarkerOffset)
        : offsetMatch
        ? model.getPositionAt(Math.min(Number(offsetMatch[1]), model.getValueLength()))
        : lineColumnMatch
          ? {
              lineNumber: Number(lineColumnMatch[1]),
              column: Number(lineColumnMatch[2]),
            }
          : { lineNumber: 1, column: 1 };
      const lineNumber = Math.max(1, Math.min(position.lineNumber, model.getLineCount()));
      const startColumn = Math.max(
        1,
        Math.min(position.column, model.getLineMaxColumn(lineNumber)),
      );
      monaco.editor.setModelMarkers(model, 'story-json', [
        {
          severity: monaco.MarkerSeverity.Error,
          message,
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn: Math.min(startColumn + 1, model.getLineMaxColumn(lineNumber)),
        },
      ]);
      onDiagnostic(message);
    }
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidBlurEditorWidget(() => commitRef.current());
    editor.addAction({
      id: 'story-json.revert',
      label: 'Revert JSON Edit',
      keybindings: [monaco.KeyCode.Escape],
      run: () => {
        revertRef.current();
        editor.getDomNode()?.blur();
      },
    });
    editor.addAction({
      id: 'story-json.copy',
      label: 'Copy',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
      run: () => copySelection(editor),
    });
    editor.addAction({
      id: 'story-json.paste',
      label: 'Paste',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV],
      run: () => pasteSelection(editor),
    });
    editor.addAction({
      id: 'story-json.format',
      label: 'Format JSON',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => {
        try {
          const formatted = JSON.stringify(JSON.parse(editor.getValue()), null, 2);
          editor.setValue(formatted);
        } catch {
          validate(editor.getValue());
        }
      },
    });
    editor.addAction({
      id: 'story-json.save',
      label: 'Apply JSON and Save All',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        commitRef.current();
        setTimeout(() => saveRef.current(), 0);
      },
    });
    validate(editor.getValue());
  };

  return (
    <Editor
      height="100%"
      beforeMount={registerJsonLanguage}
      language="story-json"
      theme="vs-dark"
      value={value}
      onChange={(next) => {
        const source = next ?? '';
        onChange(source);
        requestAnimationFrame(() => validate(source));
      }}
      onMount={handleMount}
      options={{
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        colorDecorators: true,
        contextmenu: true,
        folding: true,
        fontFamily: "Consolas, 'Cascadia Mono', monospace",
        fontSize: 12,
        formatOnPaste: true,
        formatOnType: true,
        glyphMargin: false,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
        wordWrap: 'on',
      }}
    />
  );
}
