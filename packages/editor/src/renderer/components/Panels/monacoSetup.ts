import { loader } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

loader.config({ monaco: monacoApi });

(
  globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
  }
).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
