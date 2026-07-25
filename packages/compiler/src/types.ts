import type { NodeId, RuntimeProgram, StorySourceDocument } from '@story-blueprint/common';

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
  | 'DUPLICATE_OPTION_ID';

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
}

export type CompileResult =
  | { ok: true; program: RuntimeProgram; diagnostics: readonly CompilerDiagnostic[] }
  | { ok: false; diagnostics: readonly CompilerDiagnostic[] };

export interface StoryCompiler {
  compile(source: StorySourceDocument, options?: CompileOptions): CompileResult;
}
