import type {
  BinaryOperator,
  ExpressionSource,
  RuntimeTextPart,
  RuntimeTextTemplate,
  TextId,
  TextTemplateSource,
  TypedExpression,
  UnaryOperator,
  ValueType,
  VariableDefinition,
  VariableId,
  CharacterSource,
} from '@story-blueprint/common';

type TokenKind = 'number' | 'string' | 'identifier' | 'operator' | 'left' | 'right' | 'dot' | 'eof';
interface Token {
  kind: TokenKind;
  value: string;
  offset: number;
}

export class ExpressionCompileError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at ${offset}`);
    this.name = 'ExpressionCompileError';
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      const offset = index;
      while (/\d/.test(source[index] ?? '')) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (/\d/.test(source[index] ?? '')) index += 1;
      }
      tokens.push({ kind: 'number', value: source.slice(offset, index), offset });
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const offset = index++;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          const escaped = source[++index];
          if (escaped === undefined)
            throw new ExpressionCompileError('Unterminated string', offset);
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          index += 1;
        } else {
          value += source[index++];
        }
      }
      if (source[index] !== quote) throw new ExpressionCompileError('Unterminated string', offset);
      index += 1;
      tokens.push({ kind: 'string', value, offset });
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const offset = index;
      while (/[a-zA-Z0-9_]/.test(source[index] ?? '')) index += 1;
      tokens.push({ kind: 'identifier', value: source.slice(offset, index), offset });
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'left' : 'right', value: char, offset: index++ });
      continue;
    }
    if (char === '.') {
      tokens.push({ kind: 'dot', value: char, offset: index++ });
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(pair)) {
      tokens.push({ kind: 'operator', value: pair, offset: index });
      index += 2;
      continue;
    }
    if (['!', '-', '+', '*', '/', '%', '<', '>'].includes(char)) {
      tokens.push({ kind: 'operator', value: char, offset: index++ });
      continue;
    }
    throw new ExpressionCompileError(`Unexpected character ${char}`, index);
  }
  tokens.push({ kind: 'eof', value: '', offset: source.length });
  return tokens;
}

const precedence: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const binaryOperators: Record<string, BinaryOperator> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '%': 'modulo',
  '==': 'equal',
  '!=': 'not-equal',
  '<': 'less-than',
  '<=': 'less-than-or-equal',
  '>': 'greater-than',
  '>=': 'greater-than-or-equal',
  '&&': 'and',
  '||': 'or',
};

function scalarType(kind: 'boolean' | 'number' | 'string'): ValueType {
  return { kind };
}

function sameKind(left: ValueType, right: ValueType): boolean {
  return left.kind === right.kind || left.kind === 'any' || right.kind === 'any';
}

class Parser {
  private index = 0;
  private readonly variablesByName: Map<string, VariableDefinition>;
  private readonly variablesById: Map<string, VariableDefinition>;
  private readonly charactersByName: Map<string, CharacterSource>;

  constructor(
    private readonly tokens: readonly Token[],
    variables: readonly VariableDefinition[],
    private readonly bindings: Readonly<Record<string, string>>,
    characters: readonly CharacterSource[],
  ) {
    this.variablesByName = new Map(variables.map((variable) => [variable.name, variable]));
    this.variablesById = new Map(variables.map((variable) => [variable.id, variable]));
    this.charactersByName = new Map(characters.map((character) => [character.name, character]));
  }

  parse(): TypedExpression {
    const expression = this.parseBinary(0);
    const token = this.peek();
    if (token.kind !== 'eof') throw new ExpressionCompileError('Unexpected token', token.offset);
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private take(): Token {
    return this.tokens[this.index++]!;
  }

  private parseBinary(minimumPrecedence: number): TypedExpression {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      const tokenPrecedence = token.kind === 'operator' ? precedence[token.value] : undefined;
      if (tokenPrecedence === undefined || tokenPrecedence < minimumPrecedence) break;
      this.take();
      const right = this.parseBinary(tokenPrecedence + 1);
      left = this.binary(token, left, right);
    }
    return left;
  }

  private parseUnary(): TypedExpression {
    const token = this.peek();
    if (token.kind === 'operator' && (token.value === '!' || token.value === '-')) {
      this.take();
      const operand = this.parseUnary();
      const operator: UnaryOperator = token.value === '!' ? 'not' : 'negate';
      const expectedKind = operator === 'not' ? 'boolean' : 'number';
      if (operand.valueType.kind !== expectedKind && operand.valueType.kind !== 'any') {
        throw new ExpressionCompileError(`${token.value} expects ${expectedKind}`, token.offset);
      }
      return { kind: 'unary', operator, operand, valueType: scalarType(expectedKind) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): TypedExpression {
    const token = this.take();
    if (token.kind === 'number') {
      return { kind: 'literal', value: Number(token.value), valueType: scalarType('number') };
    }
    if (token.kind === 'string') {
      return { kind: 'literal', value: token.value, valueType: scalarType('string') };
    }
    if (token.kind === 'identifier') {
      if (token.value === 'true' || token.value === 'false') {
        return {
          kind: 'literal',
          value: token.value === 'true',
          valueType: scalarType('boolean'),
        };
      }
      if (token.value === 'null') {
        return { kind: 'literal', value: null, valueType: { kind: 'any', nullable: true } };
      }
      if (this.peek().kind === 'dot') {
        this.take();
        const fieldToken = this.take();
        if (fieldToken.kind !== 'identifier') {
          throw new ExpressionCompileError('Expected character field name', fieldToken.offset);
        }
        const qualifiedName = `${token.value}.${fieldToken.value}`;
        const boundId = this.bindings[qualifiedName];
        const character = this.charactersByName.get(token.value);
        const field =
          (boundId ? this.variablesById.get(boundId) : undefined) ??
          character?.fields?.find((candidate) => candidate.name === fieldToken.value);
        if (!character)
          throw new ExpressionCompileError(`Unknown character ${token.value}`, token.offset);
        if (!field)
          throw new ExpressionCompileError(
            `Unknown character field ${qualifiedName}`,
            fieldToken.offset,
          );
        return { kind: 'variable', variableId: field.id, valueType: field.valueType };
      }
      const boundId = this.bindings[token.value];
      const variable =
        (boundId ? this.variablesById.get(boundId) : undefined) ??
        this.variablesByName.get(token.value);
      if (!variable)
        throw new ExpressionCompileError(`Unknown variable ${token.value}`, token.offset);
      return { kind: 'variable', variableId: variable.id, valueType: variable.valueType };
    }
    if (token.kind === 'left') {
      const expression = this.parseBinary(0);
      const closing = this.take();
      if (closing.kind !== 'right') throw new ExpressionCompileError('Expected )', closing.offset);
      return expression;
    }
    throw new ExpressionCompileError('Expected expression', token.offset);
  }

  private binary(token: Token, left: TypedExpression, right: TypedExpression): TypedExpression {
    const operator = binaryOperators[token.value];
    if (!operator) throw new ExpressionCompileError('Unknown operator', token.offset);
    if (
      ['json', 'array', 'map'].includes(left.valueType.kind) ||
      ['json', 'array', 'map'].includes(right.valueType.kind)
    ) {
      throw new ExpressionCompileError(
        'Structured values can only be passed or assigned as a whole',
        token.offset,
      );
    }
    let result: ValueType;
    if (operator === 'and' || operator === 'or') {
      if (
        !['boolean', 'any'].includes(left.valueType.kind) ||
        !['boolean', 'any'].includes(right.valueType.kind)
      ) {
        throw new ExpressionCompileError(`${token.value} expects booleans`, token.offset);
      }
      result = scalarType('boolean');
    } else if (operator === 'equal' || operator === 'not-equal') {
      if (!sameKind(left.valueType, right.valueType)) {
        throw new ExpressionCompileError('Cannot compare different value types', token.offset);
      }
      result = scalarType('boolean');
    } else if (
      ['less-than', 'less-than-or-equal', 'greater-than', 'greater-than-or-equal'].includes(
        operator,
      )
    ) {
      if (
        !sameKind(left.valueType, right.valueType) ||
        !['number', 'string', 'any'].includes(left.valueType.kind)
      ) {
        throw new ExpressionCompileError(
          'Ordered comparison expects matching numbers or strings',
          token.offset,
        );
      }
      result = scalarType('boolean');
    } else if (
      operator === 'add' &&
      (left.valueType.kind === 'string' || right.valueType.kind === 'string')
    ) {
      if (left.valueType.kind !== 'string') {
        left = {
          kind: 'convert',
          target: left,
          to: scalarType('string'),
          valueType: scalarType('string'),
        };
      }
      if (right.valueType.kind !== 'string') {
        right = {
          kind: 'convert',
          target: right,
          to: scalarType('string'),
          valueType: scalarType('string'),
        };
      }
      result = scalarType('string');
    } else {
      if (
        !['number', 'any'].includes(left.valueType.kind) ||
        !['number', 'any'].includes(right.valueType.kind)
      ) {
        throw new ExpressionCompileError(`${token.value} expects numbers`, token.offset);
      }
      result = scalarType('number');
    }
    return { kind: 'binary', operator, left, right, valueType: result };
  }
}

export function compileExpression(
  expression: ExpressionSource | string,
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[] = [],
): TypedExpression {
  const source = typeof expression === 'string' ? expression : expression.source;
  const bindings = typeof expression === 'string' ? {} : expression.bindings;
  if (!source.trim()) throw new ExpressionCompileError('Expression is empty', 0);
  return new Parser(tokenize(source), variables, bindings, characters).parse();
}

export function compileTextTemplate(
  template: string | TextTemplateSource,
  id: TextId,
  variables: readonly VariableDefinition[],
  characters: readonly CharacterSource[] = [],
  translations: Readonly<Record<string, string>> = {},
): RuntimeTextTemplate {
  const compileParts = (source: string, bindings: Readonly<Record<string, VariableId>>) => {
    const parts: RuntimeTextPart[] = [];
    let text = '';
    let index = 0;
    const flushText = () => {
      if (text) parts.push({ kind: 'text', value: text });
      text = '';
    };
    while (index < source.length) {
      if (source.startsWith('{{', index)) {
        text += '{';
        index += 2;
        continue;
      }
      if (source.startsWith('}}', index)) {
        text += '}';
        index += 2;
        continue;
      }
      if (source[index] !== '{') {
        text += source[index++];
        continue;
      }
      const end = source.indexOf('}', index + 1);
      if (end < 0) throw new ExpressionCompileError('Unclosed template expression', index);
      flushText();
      const expressionSource = source.slice(index + 1, end).trim();
      const compiledExpression = compileExpression(
        { source: expressionSource, bindings },
        variables,
        characters,
      );
      if (['json', 'array', 'map'].includes(compiledExpression.valueType.kind)) {
        throw new ExpressionCompileError(
          'Structured values cannot be interpolated into player-facing text',
          index + 1,
        );
      }
      parts.push({
        kind: 'expression',
        expression: compiledExpression,
      });
      index = end + 1;
    }
    flushText();
    return parts;
  };
  const source = typeof template === 'string' ? template : template.source;
  const bindings = typeof template === 'string' ? {} : (template.bindings ?? {});
  return {
    id,
    parts: compileParts(source, bindings),
    locales:
      Object.keys(translations).length > 0
        ? Object.fromEntries(
            Object.entries(translations).map(([locale, translated]) => [
              locale,
              { parts: compileParts(translated, bindings) },
            ]),
          )
        : undefined,
  };
}
