import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  StoryNodeType,
  createStableId,
  type AssetSource,
  type BlueprintCommand,
  type BlueprintCommandTransaction,
  type BlueprintGraphTarget,
  type CharacterSource,
  type ChapterId,
  type DialogueLine,
  type EventSource,
  type EventOutputId,
  type ExpressionSource,
  type InkExternalFunctionBinding,
  type NarrationNodeData,
  type NodeId,
  type RuntimeValue,
  type SourceGraph,
  type StoryNodeDataMap,
  type ValueType,
  type VariableDefinition,
  type VariableId,
} from '@story-blueprint/common';
import { Compiler as InkCompiler } from 'inkjs/full';
import { parseDialogueInk } from './dialogueInk';

export const INK_NODE_PROFILE_VERSION = 1 as const;

export interface InkImportDiagnostic {
  severity: 'warning' | 'error';
  line: number;
  column: number;
  message: string;
}

export interface InkImportSummary {
  dialogueNodes: number;
  dialogueLines: number;
  narrationNodes: number;
  choiceNodes: number;
  branchNodes: number;
  variableNodes: number;
  variablesAdded: number;
  portalNodes: number;
  externalFunctionNodes?: number;
  /** A source construct was preserved as a native Ink Block rather than rewritten as nodes. */
  inkBlockNodes: number;
  mode: 'native-nodes' | 'ink-block-fallback';
}

export type InkImportResult =
  | {
      ok: true;
      profileVersion: typeof INK_NODE_PROFILE_VERSION;
      transaction: BlueprintCommandTransaction;
      diagnostics: readonly InkImportDiagnostic[];
      summary: InkImportSummary;
    }
  | {
      ok: false;
      profileVersion: typeof INK_NODE_PROFILE_VERSION;
      diagnostics: readonly InkImportDiagnostic[];
    };

interface DialogueStatement {
  kind: 'dialogue';
  line: number;
  lines: DialogueLine[];
}

interface NarrationStatement {
  kind: 'narration';
  line: number;
  data: NarrationNodeData;
}

interface ChoiceStatement {
  kind: 'choice';
  line: number;
  options: Array<{ text: string; target: string; visibleIf?: string }>;
}

interface DivertStatement {
  kind: 'divert';
  line: number;
  target: string;
}

interface BranchStatement {
  kind: 'branch';
  line: number;
  condition: string;
  whenTrue: string;
  whenFalse: string;
}

interface AssignmentStatement {
  kind: 'assignment';
  line: number;
  variableName: string;
  value: string;
}

interface ExternalCallStatement {
  kind: 'external-call';
  line: number;
  inkName: string;
  arguments: string[];
  resultVariableName?: string;
}

type InkStatement =
  | DialogueStatement
  | NarrationStatement
  | ChoiceStatement
  | DivertStatement
  | BranchStatement
  | AssignmentStatement
  | ExternalCallStatement;

interface InkSection {
  label?: string;
  line: number;
  statements: InkStatement[];
}

interface ParsedInkProfile {
  sections: InkSection[];
  variables: VariableDefinition[];
  diagnostics: InkImportDiagnostic[];
  /** Valid Ink outside the node conversion profile. Preserve the complete source as one block. */
  requiresInkBlock: boolean;
}

type BlueprintCommandInput = BlueprintCommand extends infer Command
  ? Command extends BlueprintCommand
    ? Omit<Command, 'operationId'>
    : never
  : never;

const knotPattern = /^\s*===\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*===\s*$/u;
const divertPattern = /^\s*->\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*$/u;
const variablePattern = /^\s*VAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/i;
const assignmentPattern = /^\s*~\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/;
const externalDeclarationPattern = /^\s*EXTERNAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/i;
const externalCallPattern =
  /^\s*~\s*(?:(temp)\s+)?(?:(?:([A-Za-z_][A-Za-z0-9_]*)\s*=)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/i;

function diagnostic(
  diagnostics: InkImportDiagnostic[],
  line: number,
  message: string,
  severity: InkImportDiagnostic['severity'] = 'error',
  column = 1,
): void {
  diagnostics.push({ severity, line, column, message });
}

function profileFallbackDiagnostic(
  diagnostics: InkImportDiagnostic[],
  line: number,
  message: string,
  column = 1,
): void {
  diagnostic(
    diagnostics,
    line,
    `${message} The complete source will be preserved as an Ink Block instead of being partially converted.`,
    'warning',
    column,
  );
}

function normalizeInkExpression(source: string): string {
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length;) {
    const character = source[index]!;
    if (quote) {
      result += character;
      if (character === '\\' && index + 1 < source.length) {
        result += source[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) quote = '';
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index))?.[0];
    if (word) {
      const operator = word === 'and' ? '&&' : word === 'or' ? '||' : word === 'not' ? '!' : word;
      result += operator;
      index += word.length;
      continue;
    }
    result += character;
    index += 1;
  }
  return result.trim();
}

function parseLiteral(source: string): { value: RuntimeValue; valueType: ValueType } | undefined {
  const trimmed = source.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return { value: trimmed === 'true', valueType: { kind: 'boolean' } };
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isFinite(value) ? { value, valueType: { kind: 'number' } } : undefined;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const value =
        trimmed[0] === '"'
          ? (JSON.parse(trimmed) as unknown)
          : trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      return typeof value === 'string' ? { value, valueType: { kind: 'string' } } : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function choiceContent(source: string): {
  text: string;
  target?: string;
  visibleIf?: string;
} {
  const inlineTarget = /^(.*?)\s*->\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*$/u.exec(source);
  let text = (inlineTarget?.[1] ?? source).trim();
  let visibleIf: string | undefined;
  const condition = /^\{([^{}]+)\}\s*(.*)$/.exec(text);
  if (condition) {
    visibleIf = normalizeInkExpression(condition[1]);
    text = condition[2].trim();
  }
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim();
  return { text, target: inlineTarget?.[2], visibleIf };
}

const namedDialogueLinePattern = /^\s*[^:#：][^:：]*[：:]\s*/;

function splitExternalCallArguments(source: string): string[] | undefined {
  if (!source.trim()) return [];
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      if (depth === 0) return undefined;
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      const value = source.slice(start, index).trim();
      if (!value) return undefined;
      values.push(normalizeInkExpression(value));
      start = index + 1;
    }
  }
  const value = source.slice(start).trim();
  if (quote || depth !== 0 || !value) return undefined;
  values.push(normalizeInkExpression(value));
  return values;
}

function parseSimpleBranch(
  sourceLines: readonly string[],
  startIndex: number,
  diagnostics: InkImportDiagnostic[],
): { statement?: BranchStatement; endIndex: number; requiresInkBlock: boolean } {
  let endIndex = startIndex + 1;
  while (endIndex < sourceLines.length && sourceLines[endIndex]?.trim() !== '}') endIndex += 1;
  if (endIndex >= sourceLines.length) {
    diagnostic(diagnostics, startIndex + 1, 'Unclosed Ink conditional block.');
    return { endIndex: sourceLines.length - 1, requiresInkBlock: false };
  }
  const content = sourceLines
    .slice(startIndex + 1, endIndex)
    .map((line, offset) => ({ source: line.trim(), line: startIndex + offset + 2 }))
    .filter((line) => line.source.length > 0 && !line.source.startsWith('//'));
  if (content.length !== 4) {
    profileFallbackDiagnostic(
      diagnostics,
      startIndex + 1,
      'This profile only converts conditionals whose true and else arms each contain one divert.',
    );
    return { endIndex, requiresInkBlock: true };
  }
  const condition = /^-?\s*(.+?):\s*$/.exec(content[0]!.source);
  const whenTrue = divertPattern.exec(content[1]!.source);
  const otherwise = /^-\s*else\s*:\s*$/i.exec(content[2]!.source);
  const whenFalse = divertPattern.exec(content[3]!.source);
  if (!condition || !whenTrue || !otherwise || !whenFalse) {
    profileFallbackDiagnostic(
      diagnostics,
      startIndex + 1,
      'Expected `{ condition:`, one `-> target`, `- else:`, one `-> target`, then `}`.',
    );
    return { endIndex, requiresInkBlock: true };
  }
  return {
    endIndex,
    requiresInkBlock: false,
    statement: {
      kind: 'branch',
      line: startIndex + 1,
      condition: normalizeInkExpression(condition[1]),
      whenTrue: whenTrue[1],
      whenFalse: whenFalse[1],
    },
  };
}

function parseInkProfile(
  source: string,
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
  existingVariables: readonly VariableDefinition[],
): ParsedInkProfile {
  const sourceLines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const diagnostics: InkImportDiagnostic[] = [];
  const sections: InkSection[] = [{ line: 1, statements: [] }];
  const variables: VariableDefinition[] = [];
  const variableNames = new Map(existingVariables.map((variable) => [variable.name, variable]));
  const textIds = new Map<string, number>();
  const externalNames = new Set(
    sourceLines.flatMap((line) => {
      const declaration = externalDeclarationPattern.exec(line);
      return declaration ? [declaration[1]!] : [];
    }),
  );
  const labels = new Map<string, number>();
  let section = sections[0]!;
  let requiresInkBlock = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const sourceLine = sourceLines[index]!;
    const trimmed = sourceLine.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const knot = knotPattern.exec(sourceLine);
    if (knot) {
      if (labels.has(knot[1])) {
        diagnostic(diagnostics, index + 1, `Duplicate knot “${knot[1]}”.`);
      } else labels.set(knot[1], index + 1);
      section = { label: knot[1], line: index + 1, statements: [] };
      sections.push(section);
      continue;
    }

    const variable = variablePattern.exec(sourceLine);
    if (variable) {
      const parsed = parseLiteral(variable[2]);
      if (!parsed) {
        diagnostic(
          diagnostics,
          index + 1,
          `Variable “${variable[1]}” needs a Boolean, Number, or quoted String literal default.`,
        );
        continue;
      }
      const existing = variableNames.get(variable[1]);
      if (existing) {
        diagnostic(
          diagnostics,
          index + 1,
          `Variable “${variable[1]}” already exists; the Ink declaration will use it without changing its default.`,
          'warning',
        );
        continue;
      }
      const definition: VariableDefinition = {
        id: createStableId('variable'),
        name: variable[1],
        displayName: variable[1],
        scope: 'story',
        valueType: parsed.valueType,
        defaultValue: parsed.value,
      };
      variables.push(definition);
      variableNames.set(definition.name, definition);
      continue;
    }

    const externalCall = externalCallPattern.exec(sourceLine);
    if (externalCall) {
      const inkName = externalCall[3]!;
      // Recognise call-shaped assignments before ordinary `~ name = expression` parsing. This
      // keeps a missing EXTERNAL declaration from becoming the misleading "Unknown variable"
      // expression error and makes the conversion boundary explicit to the author.
      if (!externalNames.has(inkName)) {
        diagnostic(
          diagnostics,
          index + 1,
          `External Function ${inkName} is called but has no EXTERNAL declaration.`,
        );
      } else {
        const args = splitExternalCallArguments(externalCall[4]!);
        if (!args) {
          diagnostic(diagnostics, index + 1, 'External Function arguments are malformed.');
        } else if (externalCall[1]) {
          diagnostic(
            diagnostics,
            index + 1,
            'External Function return values cannot be assigned to an Ink temporary. Use a Story or Ink VAR variable.',
          );
        } else {
          section.statements.push({
            kind: 'external-call',
            line: index + 1,
            inkName,
            arguments: args,
            resultVariableName: externalCall[2],
          });
        }
      }
      continue;
    }

    const assignment = assignmentPattern.exec(sourceLine);
    if (assignment) {
      section.statements.push({
        kind: 'assignment',
        line: index + 1,
        variableName: assignment[1],
        value: normalizeInkExpression(assignment[2]),
      });
      continue;
    }

    if (trimmed === '{') {
      const parsed = parseSimpleBranch(sourceLines, index, diagnostics);
      if (parsed.statement) section.statements.push(parsed.statement);
      requiresInkBlock ||= parsed.requiresInkBlock;
      index = parsed.endIndex;
      continue;
    }

    if (/^\s*[*+]\s+/.test(sourceLine)) {
      if (/^\s*\+\s+/.test(sourceLine)) {
        profileFallbackDiagnostic(
          diagnostics,
          index + 1,
          'Sticky (`+`) Choices do not have an equivalent native Choice state model.',
        );
        requiresInkBlock = true;
        continue;
      }
      const options: ChoiceStatement['options'] = [];
      const choiceLine = index + 1;
      while (index < sourceLines.length) {
        const optionSource = sourceLines[index]!;
        const optionMatch = /^\s*[*+]\s+(.+?)\s*$/.exec(optionSource);
        if (!optionMatch) break;
        if (/^\s*\+\s+/.test(optionSource)) {
          profileFallbackDiagnostic(
            diagnostics,
            index + 1,
            'Sticky (`+`) Choices do not have an equivalent native Choice state model.',
          );
          requiresInkBlock = true;
          index += 1;
          continue;
        }
        const parsed = choiceContent(optionMatch[1]);
        let target = parsed.target;
        if (!target && divertPattern.test(sourceLines[index + 1] ?? '')) {
          target = divertPattern.exec(sourceLines[index + 1]!)![1];
          index += 1;
        }
        if (!parsed.text) diagnostic(diagnostics, index + 1, 'Choice text cannot be empty.');
        if (/(?:^|\s)#\s*\S/.test(parsed.text)) {
          profileFallbackDiagnostic(
            diagnostics,
            index + 1,
            'Choice tags cannot be preserved by a native Choice node.',
          );
          requiresInkBlock = true;
        }
        if (!target) {
          diagnostic(
            diagnostics,
            index + 1,
            'Each imported Choice option must end with `-> knot` on the same or next line.',
          );
        } else {
          options.push({ text: parsed.text, target, visibleIf: parsed.visibleIf });
        }
        index += 1;
      }
      index -= 1;
      if (options.length > 0)
        section.statements.push({ kind: 'choice', line: choiceLine, options });
      continue;
    }

    const divert = divertPattern.exec(sourceLine);
    if (divert) {
      section.statements.push({ kind: 'divert', line: index + 1, target: divert[1] });
      continue;
    }

    if (externalDeclarationPattern.test(sourceLine)) {
      // A declaration alone has no control-flow equivalent. Ignore it here so it cannot create
      // a false conversion error for otherwise node-compatible Ink. Actual calls still require
      // an explicit native Call External Function conversion and are not inferred as expressions.
      continue;
    }
    if (/^\s*(?:INCLUDE|LIST|CONST|TUNNEL|FUNCTION)\b/i.test(sourceLine)) {
      profileFallbackDiagnostic(diagnostics, index + 1, `Unsupported Ink declaration: ${trimmed}`);
      requiresInkBlock = true;
      continue;
    }
    if (/^\s*==/.test(sourceLine)) {
      profileFallbackDiagnostic(
        diagnostics,
        index + 1,
        `Unsupported Ink stitch declaration: ${trimmed}`,
      );
      requiresInkBlock = true;
      continue;
    }
    if (/^\s*~/.test(sourceLine)) {
      profileFallbackDiagnostic(diagnostics, index + 1, `Unsupported Ink evaluation: ${trimmed}`);
      requiresInkBlock = true;
      continue;
    }
    if (/^\s*(?:<-|=|-)\s*/.test(sourceLine) || trimmed === '}') {
      profileFallbackDiagnostic(
        diagnostics,
        index + 1,
        `Unsupported Ink control syntax: ${trimmed}`,
      );
      requiresInkBlock = true;
      continue;
    }

    const dialogueLines: string[] = [];
    const dialogueStart = index;
    while (index < sourceLines.length) {
      const candidate = sourceLines[index]!;
      const candidateTrimmed = candidate.trim();
      if (
        !candidateTrimmed ||
        candidateTrimmed.startsWith('//') ||
        knotPattern.test(candidate) ||
        variablePattern.test(candidate) ||
        assignmentPattern.test(candidate) ||
        externalDeclarationPattern.test(candidate) ||
        divertPattern.test(candidate) ||
        /^\s*[*+]\s+/.test(candidate) ||
        candidateTrimmed === '{' ||
        candidateTrimmed === '}'
      ) {
        break;
      }
      dialogueLines.push(candidate);
      index += 1;
    }
    index -= 1;
    let dialogue: DialogueStatement | undefined;
    for (const [offset, source] of dialogueLines.entries()) {
      if (/\{[&~!]/.test(source) || /\{[^}\r\n]*[:|]/.test(source)) {
        profileFallbackDiagnostic(
          diagnostics,
          dialogueStart + offset + 1,
          'Inline Ink conditional, sequence, or alternative content cannot be represented by a native text template.',
        );
        requiresInkBlock = true;
        continue;
      }
      const parsedDialogue = parseDialogueInk(
        namedDialogueLinePattern.test(source) ? source : `Narrator: ${source.trimStart()}`,
        { lines: [] },
        characters,
        assets,
      );
      for (const item of parsedDialogue.diagnostics) {
        diagnostic(
          diagnostics,
          dialogueStart + offset + item.line,
          item.message,
          'error',
          item.column,
        );
      }
      const line = parsedDialogue.lines?.[0];
      if (!line) continue;
      const existingTextIdLine = textIds.get(line.textId);
      if (existingTextIdLine !== undefined) {
        diagnostic(
          diagnostics,
          dialogueStart + offset + 1,
          `Duplicate text ID “${line.textId}” (first used on line ${existingTextIdLine}).`,
        );
      } else {
        textIds.set(line.textId, dialogueStart + offset + 1);
      }
      if (line.speakerId) {
        if (!dialogue) {
          dialogue = { kind: 'dialogue', line: dialogueStart + offset + 1, lines: [] };
          section.statements.push(dialogue);
        }
        dialogue.lines.push(line);
        continue;
      }

      dialogue = undefined;
      if (line.emotion || line.tags?.length) {
        profileFallbackDiagnostic(
          diagnostics,
          dialogueStart + offset + 1,
          'Narration supports a Voice Asset only; emotion and ordinary tags cannot be preserved as native nodes.',
        );
        requiresInkBlock = true;
      }
      section.statements.push({
        kind: 'narration',
        line: dialogueStart + offset + 1,
        data: {
          textId: line.textId,
          text: line.text,
          ...(line.voiceId ? { voiceId: line.voiceId } : {}),
        },
      });
    }
  }

  const targetLabels = sections.flatMap((candidate) =>
    candidate.statements.flatMap((statement) => {
      if (
        statement.kind === 'divert' &&
        statement.target.toUpperCase() !== 'DONE' &&
        statement.target.toUpperCase() !== 'END'
      ) {
        return [statement.target];
      }
      if (statement.kind === 'choice') return statement.options.map((option) => option.target);
      if (statement.kind === 'branch') return [statement.whenTrue, statement.whenFalse];
      return [];
    }),
  );
  for (const target of new Set(targetLabels)) {
    if (!labels.has(target))
      diagnostic(diagnostics, 1, `Divert references missing knot “${target}”.`);
  }
  for (const candidate of sections) {
    let terminated = false;
    candidate.statements.forEach((statement) => {
      if (terminated) {
        diagnostic(
          diagnostics,
          statement.line,
          'Content after a Choice, Branch, or divert is unreachable in this Ink profile.',
        );
      }
      if (
        statement.kind === 'choice' ||
        statement.kind === 'branch' ||
        statement.kind === 'divert'
      ) {
        terminated = true;
      }
      if (statement.kind === 'assignment' && !variableNames.has(statement.variableName)) {
        diagnostic(
          diagnostics,
          statement.line,
          `Assignment references unknown variable “${statement.variableName}”.`,
        );
      }
      if (
        statement.kind === 'external-call' &&
        statement.resultVariableName &&
        !variableNames.has(statement.resultVariableName)
      ) {
        diagnostic(
          diagnostics,
          statement.line,
          `External Function return is assigned to unknown Story or Ink VAR variable “${statement.resultVariableName}”.`,
        );
      }
    });
  }
  if (sections.every((candidate) => candidate.statements.length === 0)) {
    diagnostic(diagnostics, 1, 'Ink source does not contain any convertible story content.');
  }
  return { sections, variables, diagnostics, requiresInkBlock };
}

function graphTarget(chapterId?: string): BlueprintGraphTarget {
  return chapterId ? { kind: 'chapter', chapterId: chapterId as ChapterId } : { kind: 'root' };
}

function compilerDiagnostic(error: string): InkImportDiagnostic {
  const location = /\bline\s+(\d+)(?::(\d+))?/i.exec(error);
  return {
    severity: 'error',
    line: location ? Number(location[1]) : 1,
    column: location?.[2] ? Number(location[2]) : 1,
    message: error.replace(/^ERROR:\s*/i, '').trim(),
  };
}

/**
 * Preserves valid Ink that is outside the native node profile. The source remains complete and
 * editable in the Ink Block Inspector; no part of it is guessed into an incomplete node graph.
 */
export function buildInkBlockFallbackTransaction(
  source: string,
  options: {
    revision: string;
    chapterId?: string;
    conversionDiagnostics?: readonly InkImportDiagnostic[];
  },
): InkImportResult {
  if (!source.trim()) {
    return {
      ok: false,
      profileVersion: INK_NODE_PROFILE_VERSION,
      diagnostics: [
        {
          severity: 'error',
          line: 1,
          column: 1,
          message: 'Ink source is empty.',
        },
      ],
    };
  }
  try {
    const compiler = new InkCompiler(source);
    compiler.Compile();
    if (compiler.errors.length > 0) {
      return {
        ok: false,
        profileVersion: INK_NODE_PROFILE_VERSION,
        diagnostics: compiler.errors.map(compilerDiagnostic),
      };
    }
  } catch (error) {
    return {
      ok: false,
      profileVersion: INK_NODE_PROFILE_VERSION,
      diagnostics: [
        {
          severity: 'error',
          line: 1,
          column: 1,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const target = graphTarget(options.chapterId);
  const nodeId = createStableId('node');
  const summary: InkImportSummary = {
    dialogueNodes: 0,
    dialogueLines: 0,
    narrationNodes: 0,
    choiceNodes: 0,
    branchNodes: 0,
    variableNodes: 0,
    variablesAdded: 0,
    portalNodes: 0,
    externalFunctionNodes: 0,
    inkBlockNodes: 1,
    mode: 'ink-block-fallback',
  };
  const conversionDiagnostics = (options.conversionDiagnostics ?? []).map((item) => ({
    ...item,
    severity: 'warning' as const,
  }));
  return {
    ok: true,
    profileVersion: INK_NODE_PROFILE_VERSION,
    diagnostics: [
      {
        severity: 'warning',
        line: 1,
        column: 1,
        message:
          'This Ink uses features outside the native node profile and was preserved as an embedded Ink Block.',
      },
      ...conversionDiagnostics,
    ],
    summary,
    transaction: {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: options.revision,
      operations: [
        {
          operationId: 'ink_fallback_1',
          kind: 'add-node',
          graph: target,
          node: {
            id: nodeId,
            type: StoryNodeType.InkBlock,
            name: 'Preserved Ink Block',
            data: { sourceMode: 'embedded', source },
          },
        },
        {
          operationId: 'ink_fallback_2',
          kind: 'layout-selection',
          graph: target,
          nodeIds: [nodeId],
        },
      ],
    },
  };
}

export function buildInkImportTransaction(
  source: string,
  options: {
    revision: string;
    chapterId?: string;
    characters: readonly CharacterSource[];
    assets: readonly AssetSource[];
    variables: readonly VariableDefinition[];
    events?: readonly EventSource[];
    externalFunctionBindings?: readonly InkExternalFunctionBinding[];
  },
): InkImportResult {
  const parsed = parseInkProfile(source, options.characters, options.assets, options.variables);
  if (parsed.requiresInkBlock || parsed.diagnostics.some((item) => item.severity === 'error')) {
    return {
      ok: false,
      profileVersion: INK_NODE_PROFILE_VERSION,
      diagnostics: parsed.diagnostics,
    };
  }
  const target = graphTarget(options.chapterId);
  const operations: BlueprintCommand[] = [];
  const nodeIds: NodeId[] = [];
  const variableByName = new Map(
    [...options.variables, ...parsed.variables].map((variable) => [variable.name, variable]),
  );
  const anchors = new Map<string, NodeId>();
  const summary: InkImportSummary = {
    dialogueNodes: 0,
    dialogueLines: 0,
    narrationNodes: 0,
    choiceNodes: 0,
    branchNodes: 0,
    variableNodes: 0,
    variablesAdded: parsed.variables.length,
    portalNodes: 0,
    externalFunctionNodes: 0,
    inkBlockNodes: 0,
    mode: 'native-nodes',
  };
  let operationIndex = 0;
  const addOperation = (operation: BlueprintCommandInput) => {
    operations.push({ ...operation, operationId: `ink_${++operationIndex}` } as BlueprintCommand);
  };
  const addNode = (
    type: StoryNodeType,
    data: StoryNodeDataMap[StoryNodeType],
    name?: string,
  ): NodeId => {
    const id = createStableId('node');
    nodeIds.push(id);
    addOperation({ kind: 'add-node', graph: target, node: { id, type, name, data } });
    return id;
  };
  const connect = (from: NodeId, portId: string, to: NodeId) =>
    addOperation({
      kind: 'connect',
      graph: target,
      from: { nodeId: from, portId },
      to: { nodeId: to, portId: 'in' },
    });

  for (const variable of parsed.variables) {
    addOperation({ kind: 'add-variable', variable });
  }
  for (const section of parsed.sections) {
    if (!section.label) continue;
    const anchorId = addNode(StoryNodeType.FlowAnchor, { label: section.label }, section.label);
    anchors.set(section.label, anchorId);
    summary.portalNodes += 1;
  }

  for (const section of parsed.sections) {
    let previous = section.label
      ? { nodeId: anchors.get(section.label)!, portId: 'out' }
      : undefined;
    for (const statement of section.statements) {
      if (statement.kind === 'dialogue') {
        const id = addNode(StoryNodeType.Dialogue, { lines: statement.lines });
        if (previous) connect(previous.nodeId, previous.portId, id);
        previous = { nodeId: id, portId: 'out' };
        summary.dialogueNodes += 1;
        summary.dialogueLines += statement.lines.length;
        continue;
      }
      if (statement.kind === 'narration') {
        const id = addNode(StoryNodeType.Narration, statement.data);
        if (previous) connect(previous.nodeId, previous.portId, id);
        previous = { nodeId: id, portId: 'out' };
        summary.narrationNodes += 1;
        continue;
      }
      if (statement.kind === 'assignment') {
        const variable = variableByName.get(statement.variableName)!;
        const id = addNode(StoryNodeType.SetVariable, {
          variableId: variable.id,
          value: { source: statement.value, bindings: { [statement.variableName]: variable.id } },
        });
        if (previous) connect(previous.nodeId, previous.portId, id);
        previous = { nodeId: id, portId: 'out' };
        summary.variableNodes += 1;
        continue;
      }
      if (statement.kind === 'external-call') {
        const binding = options.externalFunctionBindings?.find(
          (candidate) => candidate.inkName === statement.inkName,
        );
        const event = binding
          ? options.events?.find((candidate) => candidate.id === binding.functionId)
          : undefined;
        if (!binding || !event) {
          parsed.diagnostics.push({
            severity: 'error',
            line: statement.line,
            column: 1,
            message: `External Function ${statement.inkName} is not mapped to a project External Function.`,
          });
          continue;
        }
        if (statement.arguments.length !== event.parameters.length) {
          parsed.diagnostics.push({
            severity: 'error',
            line: statement.line,
            column: 1,
            message: `External Function ${statement.inkName} expects ${event.parameters.length} argument(s), got ${statement.arguments.length}.`,
          });
          continue;
        }
        const argumentsMap: Record<string, ExpressionSource> = {};
        event.parameters.forEach((parameter, index) => {
          const argument = statement.arguments[index]!;
          argumentsMap[parameter.name] = {
            source: argument,
            bindings: Object.fromEntries(
              [...variableByName.entries()].map(([name, variable]) => [name, variable.id]),
            ),
          };
        });
        const resultVariableIds: Record<EventOutputId, VariableId> = {};
        if (statement.resultVariableName) {
          if ((event.outputs ?? []).length !== 1) {
            parsed.diagnostics.push({
              severity: 'error',
              line: statement.line,
              column: 1,
              message: `External Function ${statement.inkName} must declare exactly one return value when assigned.`,
            });
            continue;
          }
          const resultVariable = variableByName.get(statement.resultVariableName);
          if (!resultVariable) {
            parsed.diagnostics.push({
              severity: 'error',
              line: statement.line,
              column: 1,
              message: `External Function return is assigned to unknown Story or Ink VAR variable “${statement.resultVariableName}”.`,
            });
            continue;
          }
          const output = event.outputs![0]!;
          if (JSON.stringify(output.valueType) !== JSON.stringify(resultVariable.valueType)) {
            parsed.diagnostics.push({
              severity: 'error',
              line: statement.line,
              column: 1,
              message: `External Function return ${output.name} does not match variable ${resultVariable.name}.`,
            });
            continue;
          }
          resultVariableIds[output.id] = resultVariable.id;
        }
        const id = addNode(StoryNodeType.CallEvent, {
          eventId: event.id,
          arguments: argumentsMap,
          outputPorts: (event.outputs ?? []).map((output) => ({
            id: output.id,
            label: output.displayName,
            valueType: output.valueType,
          })),
          resultVariableIds,
        });
        if (previous) connect(previous.nodeId, previous.portId, id);
        previous = { nodeId: id, portId: 'out' };
        summary.externalFunctionNodes = (summary.externalFunctionNodes ?? 0) + 1;
        continue;
      }
      if (statement.kind === 'divert') {
        if (statement.target.toUpperCase() === 'DONE') {
          const terminal = addNode(
            options.chapterId ? StoryNodeType.Return : StoryNodeType.End,
            options.chapterId ? { values: {} } : { title: section.label ?? 'Ink Import End' },
          );
          if (previous) connect(previous.nodeId, previous.portId, terminal);
          previous = undefined;
          continue;
        }
        const id = addNode(StoryNodeType.FlowJump, {
          targetNodeId: anchors.get(statement.target),
        });
        if (previous) connect(previous.nodeId, previous.portId, id);
        previous = undefined;
        summary.portalNodes += 1;
        continue;
      }
      if (statement.kind === 'choice') {
        const options = statement.options.map((option) => ({
          id: createStableId('option'),
          text: { source: option.text },
          visibleIf: option.visibleIf ? { source: option.visibleIf, bindings: {} } : undefined,
        }));
        const id = addNode(StoryNodeType.Choice, { prompt: { source: '' }, options });
        if (previous) connect(previous.nodeId, previous.portId, id);
        statement.options.forEach((option, index) => {
          const jumpId = addNode(StoryNodeType.FlowJump, {
            targetNodeId: anchors.get(option.target),
          });
          connect(id, options[index]!.id, jumpId);
          summary.portalNodes += 1;
        });
        previous = undefined;
        summary.choiceNodes += 1;
        continue;
      }
      const id = addNode(StoryNodeType.Branch, {
        condition: { source: statement.condition, bindings: {} },
      });
      if (previous) connect(previous.nodeId, previous.portId, id);
      const trueJump = addNode(StoryNodeType.FlowJump, {
        targetNodeId: anchors.get(statement.whenTrue),
      });
      const falseJump = addNode(StoryNodeType.FlowJump, {
        targetNodeId: anchors.get(statement.whenFalse),
      });
      connect(id, 'true', trueJump);
      connect(id, 'false', falseJump);
      previous = undefined;
      summary.branchNodes += 1;
      summary.portalNodes += 2;
    }
    if (previous) {
      const terminal = addNode(
        options.chapterId ? StoryNodeType.Return : StoryNodeType.End,
        options.chapterId ? { values: {} } : { title: section.label ?? 'Ink Import End' },
      );
      connect(previous.nodeId, previous.portId, terminal);
    }
  }
  addOperation({ kind: 'layout-selection', graph: target, nodeIds });
  if (parsed.diagnostics.some((item) => item.severity === 'error')) {
    return {
      ok: false,
      profileVersion: INK_NODE_PROFILE_VERSION,
      diagnostics: parsed.diagnostics,
    };
  }
  return {
    ok: true,
    profileVersion: INK_NODE_PROFILE_VERSION,
    transaction: {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: options.revision,
      operations,
    },
    diagnostics: parsed.diagnostics,
    summary,
  };
}

/**
 * Builds a replacement transaction for an existing Ink Block. The imported graph is staged in
 * the same preview used by file import, while the old block and its terminal placeholders are
 * removed only when the proposal is applied.
 */
export function buildInkBlockConversionTransaction(
  source: string,
  options: {
    revision: string;
    chapterId?: string;
    characters: readonly CharacterSource[];
    assets: readonly AssetSource[];
    variables: readonly VariableDefinition[];
    events?: readonly EventSource[];
    externalFunctionBindings?: readonly InkExternalFunctionBinding[];
    graph: SourceGraph;
    inkNodeId: NodeId;
  },
): InkImportResult {
  const imported = buildInkImportTransaction(source, options);
  if (!imported.ok) return imported;

  const target = graphTarget(options.chapterId);
  const incoming = options.graph.edges.filter(
    (edge) => edge.to.nodeId === options.inkNodeId && edge.to.portId === 'in',
  );
  const outgoing = options.graph.edges.filter(
    (edge) => edge.from.nodeId === options.inkNodeId && edge.from.portId === 'out',
  );
  const importedOperations = [...imported.transaction.operations];
  const addedNodes = importedOperations.filter(
    (operation): operation is Extract<BlueprintCommand, { kind: 'add-node' }> =>
      operation.kind === 'add-node',
  );
  // Flow Anchors are visual jump targets and do not accept execution input. Start at
  // the first executable node in the imported source; a terminal is only a fallback
  // for an empty knot.
  const firstImportedNode =
    addedNodes.find(
      (operation) =>
        operation.node.type !== StoryNodeType.FlowAnchor &&
        operation.node.type !== StoryNodeType.End &&
        operation.node.type !== StoryNodeType.Return &&
        operation.node.type !== StoryNodeType.FlowJump,
    )?.node.id ??
    addedNodes.find(
      (operation) =>
        operation.node.type !== StoryNodeType.FlowAnchor &&
        operation.node.type !== StoryNodeType.End &&
        operation.node.type !== StoryNodeType.Return,
    )?.node.id ??
    addedNodes.find((operation) => operation.node.type === StoryNodeType.End)?.node.id ??
    addedNodes.find((operation) => operation.node.type === StoryNodeType.Return)?.node.id;
  if (!firstImportedNode) {
    return {
      ok: false,
      profileVersion: INK_NODE_PROFILE_VERSION,
      diagnostics: [
        {
          severity: 'error',
          line: 1,
          column: 1,
          message: 'Ink source did not produce any nodes to replace the Ink Block.',
        },
      ],
    };
  }

  const terminalNodes = addedNodes.filter(
    (operation) =>
      operation.node.type === StoryNodeType.End || operation.node.type === StoryNodeType.Return,
  );
  const terminalIds = new Set(terminalNodes.map((operation) => operation.node.id));
  const terminalPredecessors = importedOperations
    .filter(
      (operation): operation is Extract<BlueprintCommand, { kind: 'connect' }> =>
        operation.kind === 'connect' && terminalIds.has(operation.to.nodeId),
    )
    .map((operation) => operation.from);

  let operationIndex = 0;
  const operations: BlueprintCommand[] = [];
  const addOperation = (operation: BlueprintCommandInput) => {
    operations.push({
      ...operation,
      operationId: `ink_replace_${++operationIndex}`,
    } as BlueprintCommand);
  };

  addOperation({ kind: 'remove-node', graph: target, nodeId: options.inkNodeId });
  for (const operation of importedOperations) {
    if (operation.kind === 'layout-selection') continue;
    addOperation(operation);
  }

  for (const edge of incoming) {
    addOperation({
      kind: 'connect',
      graph: target,
      from: edge.from,
      to: { nodeId: firstImportedNode, portId: 'in' },
      replaceExisting: true,
    });
  }

  if (outgoing.length > 0) {
    for (const terminal of terminalNodes) {
      addOperation({ kind: 'remove-node', graph: target, nodeId: terminal.node.id });
    }
    if (terminalPredecessors.length <= 1) {
      for (const predecessor of terminalPredecessors) {
        for (const edge of outgoing) {
          addOperation({
            kind: 'connect',
            graph: target,
            from: predecessor,
            to: edge.to,
            replaceExisting: true,
          });
        }
      }
    } else {
      // Multiple converted paths cannot all enter a normal execution input. Preserve the
      // original continuation through a portal, which is erased again by compilation.
      const continuationAnchorId = createStableId('node');
      addOperation({
        kind: 'add-node',
        graph: target,
        node: {
          id: continuationAnchorId,
          type: StoryNodeType.FlowAnchor,
          name: 'Continue after Ink Block',
          data: { label: 'Continue after Ink Block' },
        },
      });
      for (const edge of outgoing) {
        addOperation({
          kind: 'connect',
          graph: target,
          from: { nodeId: continuationAnchorId, portId: 'out' },
          to: edge.to,
          replaceExisting: true,
        });
      }
      for (const predecessor of terminalPredecessors) {
        const jumpId = createStableId('node');
        addOperation({
          kind: 'add-node',
          graph: target,
          node: {
            id: jumpId,
            type: StoryNodeType.FlowJump,
            name: 'Continue after Ink Block',
            data: { targetNodeId: continuationAnchorId },
          },
        });
        addOperation({
          kind: 'connect',
          graph: target,
          from: predecessor,
          to: { nodeId: jumpId, portId: 'in' },
        });
      }
    }
  }

  const layout = importedOperations.find(
    (operation): operation is Extract<BlueprintCommand, { kind: 'layout-selection' }> =>
      operation.kind === 'layout-selection',
  );
  if (layout) {
    addOperation({
      ...layout,
      kind: 'layout-neighborhood',
      nodeIds: layout.nodeIds.filter((nodeId) => !terminalIds.has(nodeId)),
    });
  }

  return {
    ...imported,
    transaction: {
      ...imported.transaction,
      operations,
    },
  };
}

export interface ConvertInkOptions {
  revision: string;
  chapterId?: string;
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  variables: readonly VariableDefinition[];
  events?: readonly EventSource[];
  externalFunctionBindings?: readonly InkExternalFunctionBinding[];
  autoCreateCharacters?: boolean;
  connectToNodeId?: NodeId;
}

export interface ConvertInkResult {
  ok: boolean;
  transaction?: BlueprintCommandTransaction;
  diagnostics: readonly InkImportDiagnostic[];
  summary?: InkImportSummary;
  createdCharacters?: CharacterSource[];
}

export function normalizeInkSource(source: string): string {
  let text = source.trim();
  const fenceMatch = text.match(/^```(?:ink|story)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    text = fenceMatch[1];
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const normalizedLines = lines.map((line) => {
    let l = line;
    // Normalize full-width colon after speaker name: e.g. "主角：你好" -> "主角: 你好"
    if (!/^\s*(?:===|\/\/|VAR\b|EXTERNAL\b|~|\*|\+|\{|\}|->)/i.test(l)) {
      l = l.replace(/^(\s*[^#:=*+~/{}\r\n]+?)：\s*/, '$1: ');
    }
    // Normalize choice full-width brackets: e.g. "* 【选项】 -> knot" or "* ［选项］ -> knot"
    l = l.replace(/^(\s*[*+]\s*)[【［](.+?)[】］]/, '$1[$2]');
    // Normalize unicode arrows: e.g. "—>" or "–>" or "→" to "->"
    l = l.replace(/\s*(?:—>|–>|→)\s*/g, ' -> ');
    return l;
  });

  let processed = normalizedLines.join('\n');

  // Auto-stub missing knots for resilient AI conversion (avoids "Divert references missing knot" failure)
  const divertMatches = processed.matchAll(/->\s*([\p{L}_][\p{L}\p{N}_.-]*)/gu);
  const knotMatches = new Set(
    Array.from(processed.matchAll(/^\s*===\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*===/gmu), (m) => m[1]),
  );
  const missingKnots: string[] = [];
  for (const m of divertMatches) {
    const target = m[1];
    if (
      target.toUpperCase() !== 'DONE' &&
      target.toUpperCase() !== 'END' &&
      !knotMatches.has(target)
    ) {
      if (!missingKnots.includes(target)) {
        missingKnots.push(target);
      }
    }
  }
  if (missingKnots.length > 0) {
    processed = processed + '\n\n' + missingKnots.map((k) => `=== ${k} ===\n-> DONE`).join('\n\n');
  }

  return processed;
}

export function convertInkToBlueprintTransaction(
  source: string,
  options: ConvertInkOptions,
): ConvertInkResult {
  const normalized = normalizeInkSource(source);
  if (!normalized.trim()) {
    return {
      ok: false,
      diagnostics: [{ severity: 'error', line: 1, column: 1, message: 'Ink source is empty.' }],
    };
  }

  const existingChars = options.characters;
  const newCharacters: CharacterSource[] = [];

  if (options.autoCreateCharacters) {
    const extractedSpeakers = new Set<string>();
    for (const line of normalized.split('\n')) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith('//') ||
        /^(?:===|VAR\b|EXTERNAL\b|~|\*|\+|\{|\}|->)/i.test(trimmed)
      ) {
        continue;
      }
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const candidate = trimmed.slice(0, colonIndex).trim();
        if (
          candidate &&
          !candidate.includes('#') &&
          candidate.toLowerCase() !== 'narrator' &&
          candidate !== '旁白'
        ) {
          extractedSpeakers.add(candidate);
        }
      }
    }

    for (const speaker of extractedSpeakers) {
      const exists = existingChars.some(
        (c) =>
          c.id.toLowerCase() === speaker.toLowerCase() ||
          c.name.toLowerCase() === speaker.toLowerCase() ||
          c.displayName.toLowerCase() === speaker.toLowerCase(),
      );
      if (!exists) {
        newCharacters.push({
          id: createStableId('character'),
          name: speaker,
          displayName: speaker,
          emotions: {},
        });
      }
    }
  }

  const characters = [...existingChars, ...newCharacters];
  const importResult = buildInkImportTransaction(normalized, {
    revision: options.revision,
    chapterId: options.chapterId,
    characters,
    assets: options.assets,
    variables: options.variables,
    events: options.events,
    externalFunctionBindings: options.externalFunctionBindings,
  });

  if (!importResult.ok) {
    return {
      ok: false,
      diagnostics: importResult.diagnostics,
    };
  }

  const target = graphTarget(options.chapterId);
  const operations: BlueprintCommand[] = [];

  // 1. Add any auto-created characters
  let charOpIndex = 0;
  for (const char of newCharacters) {
    operations.push({
      operationId: `ink_char_${++charOpIndex}`,
      kind: 'add-character',
      character: char,
    });
  }

  // 2. Add imported operations
  operations.push(...importResult.transaction.operations);

  // 3. Connect from connectToNodeId if requested
  if (options.connectToNodeId) {
    const firstExecutableNode = importResult.transaction.operations.find(
      (op): op is Extract<BlueprintCommand, { kind: 'add-node' }> =>
        op.kind === 'add-node' &&
        op.node.type !== StoryNodeType.FlowAnchor &&
        op.node.type !== StoryNodeType.End &&
        op.node.type !== StoryNodeType.Return &&
        op.node.type !== StoryNodeType.FlowJump,
    )?.node.id;

    if (firstExecutableNode) {
      operations.push({
        operationId: `ink_connect_selected`,
        kind: 'connect',
        graph: target,
        from: { nodeId: options.connectToNodeId, portId: 'out' },
        to: { nodeId: firstExecutableNode, portId: 'in' },
        replaceExisting: true,
      });
    }
  }

  return {
    ok: true,
    transaction: {
      ...importResult.transaction,
      operations,
    },
    diagnostics: importResult.diagnostics,
    summary: importResult.summary,
    createdCharacters: newCharacters,
  };
}
