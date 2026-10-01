import type {
  ChapterId,
  CompiledStoryProject,
  NodeId,
  RuntimeProgram,
  StoryId,
  StoryLocalizationDocument,
  StoryProjectDocument,
  StorySourceDocument,
} from '@story-blueprint/common';

export type CompilerDiagnosticSeverity = 'warning' | 'error';

export type CompilerDiagnosticCode =
  | 'UNSUPPORTED_SOURCE_VERSION'
  | 'DUPLICATE_ID'
  | 'MISSING_ENTRY_BLOCK'
  | 'MISSING_BLOCK'
  | 'EMPTY_BLOCK'
  | 'MISSING_TERMINATOR'
  | 'EARLY_TERMINATOR'
  | 'INVALID_RETURN_LOCATION'
  | 'EMPTY_CHOICE'
  | 'DUPLICATE_OPTION_ID'
  | 'MISSING_CONNECTION'
  | 'EXPRESSION_ERROR'
  | 'INVALID_NODE'
  | 'INK_WARNING'
  | 'DANGLING_EDGE'
  | 'UNREACHABLE_NODE'
  | 'DEAD_END_NODE'
  | 'MULTIPLE_ENTRY_NODES'
  | 'INVALID_END_LOCATION'
  | 'SUBSTORY_CALL_CYCLE'
  | 'TIGHT_LOOP'
  | 'MISSING_STORY'
  | 'DATA_SOURCE_NOT_GUARANTEED'
  | 'PROJECT_ERROR';

export interface CompilerDiagnostic {
  code: CompilerDiagnosticCode;
  severity: CompilerDiagnosticSeverity;
  message: string;
  path?: string;
  sourceNodeId?: NodeId;
}

export interface CompileOptions {
  emitSourceMap?: boolean;
  contentVersion?: string;
  translations?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  sourceLocale?: string;
  localeFallbacks?: Readonly<Record<string, string>>;
  /** Project-relative linked Ink sources resolved by the editor/build host. */
  inkSources?: Readonly<Record<string, string>>;
  /** Story IDs available to Story Control nodes during a project build. */
  availableStoryIds?: readonly StoryId[];
  /** Story variable contracts used by Start/Switch Story argument validation. */
  storyVariablesById?: Readonly<
    Record<string, readonly import('@story-blueprint/common').VariableDefinition[]>
  >;
}

export type CompileResult =
  | { ok: true; program: RuntimeProgram; diagnostics: readonly CompilerDiagnostic[] }
  | { ok: false; diagnostics: readonly CompilerDiagnostic[] };

export interface StoryCompiler {
  compile(source: StorySourceDocument, options?: CompileOptions): CompileResult;
}

export interface ProjectStorySource {
  path: string;
  source: StorySourceDocument;
}

export interface ProjectCompilerDiagnostic extends CompilerDiagnostic {
  storyId?: StoryId;
  storyPath?: string;
  storyName?: string;
  sourceChapterId?: ChapterId;
}

export interface CompileProjectOptions extends CompileOptions {
  entryStoryId?: StoryId;
  localization?: StoryLocalizationDocument;
}

export type CompileProjectResult =
  | {
      ok: true;
      project: CompiledStoryProject;
      diagnostics: readonly ProjectCompilerDiagnostic[];
    }
  | { ok: false; diagnostics: readonly ProjectCompilerDiagnostic[] };

export interface ProjectCompiler {
  compile(
    project: StoryProjectDocument,
    stories: readonly ProjectStorySource[],
    options?: CompileProjectOptions,
  ): CompileProjectResult;
}
