import type {
  CharacterSource,
  ValueType,
  VariableDefinition,
  VariableId,
} from '@story-blueprint/common';
import { compileExpression, ExpressionCompileError } from '@story-blueprint/compiler';

export interface ExpressionCandidate {
  variableId: VariableId;
  insertion: string;
  label: string;
  detail: string;
  group: string;
  valueType: ValueType;
}

function typeCompatible(actual: ValueType, expected?: ValueType): boolean {
  return (
    !expected || expected.kind === 'any' || actual.kind === 'any' || actual.kind === expected.kind
  );
}

export function expressionCandidates(
  variables: readonly VariableDefinition[],
  projectVariables: readonly VariableDefinition[],
  characters: readonly CharacterSource[],
  query: string,
  expectedType?: ValueType,
  limit = 12,
): { results: ExpressionCandidate[]; total: number } {
  const normalizedQuery = query.toLocaleLowerCase();
  const candidates: ExpressionCandidate[] = [];
  const seen = new Set<VariableId>();
  const add = (variable: VariableDefinition, insertion: string, label: string, group: string) => {
    if (seen.has(variable.id)) return;
    seen.add(variable.id);
    const searchText =
      `${insertion} ${label} ${variable.name} ${variable.valueType.kind} ${group}`.toLocaleLowerCase();
    if (normalizedQuery && !searchText.includes(normalizedQuery)) return;
    candidates.push({
      variableId: variable.id,
      insertion,
      label,
      detail: `${variable.name} · ${variable.valueType.kind}`,
      group,
      valueType: variable.valueType,
    });
  };

  for (const variable of variables) {
    const group =
      variable.scope === 'story'
        ? 'Story'
        : variable.scope === 'local'
          ? 'Substory Local'
          : 'Substory Input';
    add(variable, variable.name, variable.displayName, group);
  }
  for (const variable of projectVariables) {
    add(variable, variable.name, variable.displayName, 'Project');
  }
  for (const character of characters) {
    for (const field of character.fields ?? []) {
      add(
        field,
        `${character.name}.${field.name}`,
        `${character.displayName}.${field.displayName}`,
        `Character · ${character.displayName}`,
      );
    }
  }

  candidates.sort((left, right) => {
    const leftPrefix =
      normalizedQuery && left.insertion.toLocaleLowerCase().startsWith(normalizedQuery);
    const rightPrefix =
      normalizedQuery && right.insertion.toLocaleLowerCase().startsWith(normalizedQuery);
    if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
    const leftType = typeCompatible(left.valueType, expectedType);
    const rightType = typeCompatible(right.valueType, expectedType);
    if (leftType !== rightType) return leftType ? -1 : 1;
    return left.group.localeCompare(right.group) || left.label.localeCompare(right.label);
  });

  return { results: candidates.slice(0, limit), total: candidates.length };
}

export function expressionTokenRange(
  source: string,
  cursor: number,
): { start: number; end: number } {
  let start = Math.max(0, Math.min(cursor, source.length));
  while (start > 0 && /[A-Za-z0-9_.]/.test(source[start - 1] ?? '')) start -= 1;
  let end = Math.max(0, Math.min(cursor, source.length));
  while (end < source.length && /[A-Za-z0-9_.]/.test(source[end] ?? '')) end += 1;
  return { start, end };
}

export function insertExpressionCandidate(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { source: string; cursor: number } {
  const token = expressionTokenRange(source, selectionStart);
  const start = selectionStart === selectionEnd ? token.start : selectionStart;
  const end = selectionStart === selectionEnd ? token.end : selectionEnd;
  const nextSource = `${source.slice(0, start)}${insertion}${source.slice(end)}`;
  return { source: nextSource, cursor: start + insertion.length };
}

export function insertExpressionOperator(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  operator: string,
): { source: string; cursor: number } {
  const selected = source.slice(selectionStart, selectionEnd);
  const compact = operator === '!' || operator === '(' || operator === ')';
  const insertion = selected
    ? operator === '!'
      ? `!(${selected})`
      : operator === '(' || operator === ')'
        ? `(${selected})`
        : `${selected} ${operator} `
    : compact
      ? operator
      : ` ${operator} `;
  const nextSource = `${source.slice(0, selectionStart)}${insertion}${source.slice(selectionEnd)}`;
  return { source: nextSource, cursor: selectionStart + insertion.length };
}

export function expressionDiagnostic(
  source: string,
  variables: readonly VariableDefinition[],
  projectVariables: readonly VariableDefinition[],
  characters: readonly CharacterSource[],
  expectedType?: ValueType,
): { kind: 'valid' | 'error'; message: string; offset?: number } | undefined {
  if (!source.trim()) return undefined;
  try {
    const expression = compileExpression(source, [...variables, ...projectVariables], characters);
    if (!typeCompatible(expression.valueType, expectedType)) {
      return {
        kind: 'error',
        message: `Expected ${expectedType!.kind}, but this expression returns ${expression.valueType.kind}.`,
      };
    }
    return { kind: 'valid', message: `Valid ${expression.valueType.kind} expression` };
  } catch (error) {
    if (error instanceof ExpressionCompileError) {
      return { kind: 'error', message: error.message, offset: error.offset };
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
