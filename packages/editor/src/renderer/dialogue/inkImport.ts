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
  type NodeId,
  type RuntimeValue,
  type StoryNodeDataMap,
  type ValueType,
  type VariableDefinition,
} from '@story-blueprint/common';
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
  choiceNodes: number;
  branchNodes: number;
  variableNodes: number;
  variablesAdded: number;
  portalNodes: number;
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

type InkStatement =
  DialogueStatement | ChoiceStatement | DivertStatement | BranchStatement | AssignmentStatement;

interface InkSection {
  label?: string;
  line: number;
  statements: InkStatement[];
}

interface ParsedInkProfile {
  sections: InkSection[];
  variables: VariableDefinition[];
  diagnostics: InkImportDiagnostic[];
}

type BlueprintCommandInput = BlueprintCommand extends infer Command
  ? Command extends BlueprintCommand
    ? Omit<Command, 'operationId'>
    : never
  : never;

const knotPattern = /^\s*===\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*===\s*$/;
const divertPattern = /^\s*->\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*$/;
const variablePattern = /^\s*VAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/i;
const assignmentPattern = /^\s*~\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/;

function diagnostic(
  diagnostics: InkImportDiagnostic[],
  line: number,
  message: string,
  severity: InkImportDiagnostic['severity'] = 'error',
  column = 1,
): void {
  diagnostics.push({ severity, line, column, message });
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
  const inlineTarget = /^(.*?)\s*->\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*$/.exec(source);
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

function parseSimpleBranch(
  sourceLines: readonly string[],
  startIndex: number,
  diagnostics: InkImportDiagnostic[],
): { statement?: BranchStatement; endIndex: number } {
  let endIndex = startIndex + 1;
  while (endIndex < sourceLines.length && sourceLines[endIndex]?.trim() !== '}') endIndex += 1;
  if (endIndex >= sourceLines.length) {
    diagnostic(diagnostics, startIndex + 1, 'Unclosed Ink conditional block.');
    return { endIndex: sourceLines.length - 1 };
  }
  const content = sourceLines
    .slice(startIndex + 1, endIndex)
    .map((line, offset) => ({ source: line.trim(), line: startIndex + offset + 2 }))
    .filter((line) => line.source.length > 0 && !line.source.startsWith('//'));
  if (content.length !== 4) {
    diagnostic(
      diagnostics,
      startIndex + 1,
      'This profile only converts conditionals whose true and else arms each contain one divert.',
    );
    return { endIndex };
  }
  const condition = /^-?\s*(.+?):\s*$/.exec(content[0]!.source);
  const whenTrue = divertPattern.exec(content[1]!.source);
  const otherwise = /^-\s*else\s*:\s*$/i.exec(content[2]!.source);
  const whenFalse = divertPattern.exec(content[3]!.source);
  if (!condition || !whenTrue || !otherwise || !whenFalse) {
    diagnostic(
      diagnostics,
      startIndex + 1,
      'Expected `{ condition:`, one `-> target`, `- else:`, one `-> target`, then `}`.',
    );
    return { endIndex };
  }
  return {
    endIndex,
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
  const labels = new Map<string, number>();
  let section = sections[0]!;

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
      index = parsed.endIndex;
      continue;
    }

    if (/^\s*[*+]\s+/.test(sourceLine)) {
      const options: ChoiceStatement['options'] = [];
      const choiceLine = index + 1;
      while (index < sourceLines.length) {
        const optionMatch = /^\s*[*+]\s+(.+?)\s*$/.exec(sourceLines[index]!);
        if (!optionMatch) break;
        const parsed = choiceContent(optionMatch[1]);
        let target = parsed.target;
        if (!target && divertPattern.test(sourceLines[index + 1] ?? '')) {
          target = divertPattern.exec(sourceLines[index + 1]!)![1];
          index += 1;
        }
        if (!parsed.text) diagnostic(diagnostics, index + 1, 'Choice text cannot be empty.');
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

    if (/^\s*(?:INCLUDE|EXTERNAL|LIST|CONST|TUNNEL|FUNCTION)\b/i.test(sourceLine)) {
      diagnostic(diagnostics, index + 1, `Unsupported Ink declaration: ${trimmed}`);
      continue;
    }
    if (/^\s*(?:<-|=|-)\s*/.test(sourceLine) || trimmed === '}') {
      diagnostic(diagnostics, index + 1, `Unsupported Ink control syntax: ${trimmed}`);
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
    const parsedDialogue = parseDialogueInk(
      dialogueLines.join('\n'),
      { lines: [] },
      characters,
      assets,
    );
    for (const item of parsedDialogue.diagnostics) {
      diagnostic(diagnostics, dialogueStart + item.line, item.message, 'error', item.column);
    }
    if (parsedDialogue.lines) {
      section.statements.push({
        kind: 'dialogue',
        line: dialogueStart + 1,
        lines: parsedDialogue.lines,
      });
    }
  }

  const targetLabels = sections.flatMap((candidate) =>
    candidate.statements.flatMap((statement) => {
      if (statement.kind === 'divert') return [statement.target];
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
    });
  }
  if (sections.every((candidate) => candidate.statements.length === 0)) {
    diagnostic(diagnostics, 1, 'Ink source does not contain any convertible story content.');
  }
  return { sections, variables, diagnostics };
}

function graphTarget(chapterId?: string): BlueprintGraphTarget {
  return chapterId ? { kind: 'chapter', chapterId: chapterId as ChapterId } : { kind: 'root' };
}

export function buildInkImportTransaction(
  source: string,
  options: {
    revision: string;
    chapterId?: string;
    characters: readonly CharacterSource[];
    assets: readonly AssetSource[];
    variables: readonly VariableDefinition[];
  },
): InkImportResult {
  const parsed = parseInkProfile(source, options.characters, options.assets, options.variables);
  if (parsed.diagnostics.some((item) => item.severity === 'error')) {
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
    choiceNodes: 0,
    branchNodes: 0,
    variableNodes: 0,
    variablesAdded: parsed.variables.length,
    portalNodes: 0,
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
      if (statement.kind === 'divert') {
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
