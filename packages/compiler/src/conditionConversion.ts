import type {
  CharacterSource,
  ConditionTreeNode,
  ExpressionSource,
  TypedExpression,
  VariableDefinition,
} from '@story-blueprint/common';
import { compileExpression } from './expressionCompiler';

/** Error raised when a condition cannot be converted without changing its meaning. */
export class ConditionConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionConversionError';
  }
}

const operatorText: Record<Extract<TypedExpression, { kind: 'binary' }>['operator'], string> = {
  add: '+',
  subtract: '-',
  multiply: '*',
  divide: '/',
  modulo: '%',
  equal: '==',
  'not-equal': '!=',
  'less-than': '<',
  'less-than-or-equal': '<=',
  'greater-than': '>',
  'greater-than-or-equal': '>=',
  and: '&&',
  or: '||',
};

interface ExpressionFormatter {
  source: string;
  bindings: Record<string, VariableDefinition['id']>;
}

function variableNames(
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const variable of variables) names.set(variable.id, variable.name);
  for (const character of characters) {
    for (const field of character.fields ?? []) {
      names.set(field.id, `${character.name}.${field.name}`);
    }
  }
  return names;
}

function formatExpression(
  expression: TypedExpression,
  names: ReadonlyMap<string, string>,
): ExpressionFormatter {
  const bindings: Record<string, VariableDefinition['id']> = {};
  const format = (value: TypedExpression): string => {
    switch (value.kind) {
      case 'literal':
        return JSON.stringify(value.value);
      case 'variable': {
        const name = names.get(value.variableId);
        if (!name)
          throw new ConditionConversionError(`Variable ${value.variableId} is unavailable.`);
        if (bindings[name] && bindings[name] !== value.variableId) {
          throw new ConditionConversionError(
            `Expression symbol "${name}" refers to multiple variables and cannot be converted.`,
          );
        }
        bindings[name] = value.variableId;
        return name;
      }
      case 'event-output':
        throw new ConditionConversionError(
          'External Function Out values can only be used through data connections.',
        );
      case 'unary':
        return `${value.operator === 'not' ? '!' : '-'}(${format(value.operand)})`;
      case 'binary':
        return `(${format(value.left)} ${operatorText[value.operator]} ${format(value.right)})`;
      case 'member':
        return `(${format(value.target)}).${value.member}`;
      case 'index':
        return `(${format(value.target)})[${format(value.index)}]`;
      case 'convert':
        return format(value.target);
    }
  };
  return { source: format(expression), bindings };
}

function assertBooleanExpression(expression: TypedExpression): void {
  if (expression.valueType.kind !== 'boolean' && expression.valueType.kind !== 'any') {
    throw new ConditionConversionError('Condition expression must evaluate to Boolean.');
  }
}

function expressionLeaf(
  expression: TypedExpression,
  names: ReadonlyMap<string, string>,
): ConditionTreeNode {
  assertBooleanExpression(expression);
  const formatted = formatExpression(expression, names);
  return { kind: 'expression', expression: formatted };
}

function expressionToTree(
  expression: TypedExpression,
  names: ReadonlyMap<string, string>,
): ConditionTreeNode {
  if (
    expression.kind === 'binary' &&
    (expression.operator === 'and' || expression.operator === 'or')
  ) {
    const kind = expression.operator === 'and' ? 'all' : 'any';
    const children: ConditionTreeNode[] = [];
    const collect = (candidate: TypedExpression) => {
      if (candidate.kind === 'binary' && candidate.operator === expression.operator) {
        collect(candidate.left);
        collect(candidate.right);
      } else {
        children.push(expressionToTree(candidate, names));
      }
    };
    collect(expression);
    return { kind, children };
  }
  if (expression.kind === 'unary' && expression.operator === 'not') {
    return { kind: 'not', child: expressionToTree(expression.operand, names) };
  }
  return expressionLeaf(expression, names);
}

/** Converts a Boolean expression into an equivalent Condition Tree. */
export function expressionToConditionTree(
  expression: ExpressionSource | string,
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[] = [],
): ConditionTreeNode {
  let compiled: TypedExpression;
  try {
    compiled = compileExpression(expression, variables, characters);
  } catch (error) {
    throw new ConditionConversionError(error instanceof Error ? error.message : String(error));
  }
  assertBooleanExpression(compiled);
  return expressionToTree(compiled, variableNames(variables, characters));
}

function mergeBindings(
  target: Record<string, VariableDefinition['id']>,
  source: Readonly<Record<string, VariableDefinition['id']>>,
): void {
  for (const [symbol, id] of Object.entries(source)) {
    const previous = target[symbol];
    if (previous && previous !== id) {
      throw new ConditionConversionError(
        `Expression symbol "${symbol}" refers to multiple variables and cannot be merged.`,
      );
    }
    target[symbol] = id;
  }
}

function treeToExpression(
  node: ConditionTreeNode,
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[],
  names: ReadonlyMap<string, string>,
): ExpressionFormatter {
  if (node.kind === 'reference') {
    throw new ConditionConversionError(
      'Reusable Condition references cannot be represented by an inline Boolean expression.',
    );
  }
  if (node.kind === 'expression') {
    let compiled: TypedExpression;
    try {
      compiled = compileExpression(node.expression, variables, characters);
    } catch (error) {
      throw new ConditionConversionError(error instanceof Error ? error.message : String(error));
    }
    assertBooleanExpression(compiled);
    return formatExpression(compiled, names);
  }
  if (node.kind === 'not') {
    const child = treeToExpression(node.child, variables, characters, names);
    return { source: `!(${child.source})`, bindings: child.bindings };
  }
  if (node.children.length === 0) {
    return { source: node.kind === 'all' ? 'true' : 'false', bindings: {} };
  }
  const children = node.children.map((child) =>
    treeToExpression(child, variables, characters, names),
  );
  const bindings: Record<string, VariableDefinition['id']> = {};
  for (const child of children) mergeBindings(bindings, child.bindings);
  const operator = node.kind === 'all' ? '&&' : '||';
  return {
    source:
      children.length === 1
        ? children[0]!.source
        : `(${children.map((child) => child.source).join(` ${operator} `)})`,
    bindings,
  };
}

/** Converts a Condition Tree to an inline Boolean expression without expanding references. */
export function conditionTreeToExpression(
  tree: ConditionTreeNode,
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[] = [],
): ExpressionSource {
  const result = treeToExpression(
    tree,
    variables,
    characters,
    variableNames(variables, characters),
  );
  try {
    const compiled = compileExpression(result, variables, characters);
    assertBooleanExpression(compiled);
  } catch (error) {
    throw new ConditionConversionError(error instanceof Error ? error.message : String(error));
  }
  return result;
}
