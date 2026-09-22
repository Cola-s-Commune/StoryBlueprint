import type {
  ChoiceInstruction,
  RuntimeTextTemplate,
  RuntimeValue,
  TypedExpression,
  VariableId,
} from '@story-blueprint/common';

export type VariableReader = (id: VariableId) => RuntimeValue;
export type EventOutputReader = (instructionId: string, outputId: string) => RuntimeValue;
export type SubstoryOutputReader = (instructionId: string, outputId: string) => RuntimeValue;
export type SignalOutputReader = (instructionId: string, outputId: string) => RuntimeValue;

function asNumber(value: RuntimeValue): number {
  if (typeof value !== 'number') throw new TypeError('Expected number');
  return value;
}

function asBoolean(value: RuntimeValue): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean');
  return value;
}

export function evaluateExpression(
  expression: TypedExpression,
  readVariable: VariableReader,
  readEventOutput?: EventOutputReader,
  readSubstoryOutput?: SubstoryOutputReader,
  readSignalOutput?: SignalOutputReader,
): RuntimeValue {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'variable':
      return readVariable(expression.variableId);
    case 'event-output':
      if (!readEventOutput) throw new TypeError('Event output is not available in this context');
      return readEventOutput(expression.instructionId, expression.outputId);
    case 'substory-output':
      if (!readSubstoryOutput)
        throw new TypeError('Substory output is not available in this context');
      return readSubstoryOutput(expression.instructionId, expression.outputId);
    case 'signal-output':
      if (!readSignalOutput)
        throw new TypeError('Signal output is not available in this context');
      return readSignalOutput(expression.instructionId, expression.outputId);
    case 'unary': {
      const value = evaluateExpression(
        expression.operand,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      return expression.operator === 'not' ? !asBoolean(value) : -asNumber(value);
    }
    case 'binary': {
      if (expression.operator === 'and') {
        return (
          asBoolean(
            evaluateExpression(
              expression.left,
              readVariable,
              readEventOutput,
              readSubstoryOutput,
              readSignalOutput,
            ),
          ) &&
          asBoolean(
            evaluateExpression(
              expression.right,
              readVariable,
              readEventOutput,
              readSubstoryOutput,
              readSignalOutput,
            ),
          )
        );
      }
      if (expression.operator === 'or') {
        return (
          asBoolean(
            evaluateExpression(
              expression.left,
              readVariable,
              readEventOutput,
              readSubstoryOutput,
              readSignalOutput,
            ),
          ) ||
          asBoolean(
            evaluateExpression(
              expression.right,
              readVariable,
              readEventOutput,
              readSubstoryOutput,
              readSignalOutput,
            ),
          )
        );
      }
      const left = evaluateExpression(
        expression.left,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      const right = evaluateExpression(
        expression.right,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      switch (expression.operator) {
        case 'add':
          return typeof left === 'string' && typeof right === 'string'
            ? left + right
            : asNumber(left) + asNumber(right);
        case 'subtract':
          return asNumber(left) - asNumber(right);
        case 'multiply':
          return asNumber(left) * asNumber(right);
        case 'divide':
          return asNumber(left) / asNumber(right);
        case 'modulo':
          return asNumber(left) % asNumber(right);
        case 'equal':
          return left === right;
        case 'not-equal':
          return left !== right;
        case 'less-than':
          return (left as number | string) < (right as number | string);
        case 'less-than-or-equal':
          return (left as number | string) <= (right as number | string);
        case 'greater-than':
          return (left as number | string) > (right as number | string);
        case 'greater-than-or-equal':
          return (left as number | string) >= (right as number | string);
      }
      break;
    }
    case 'member': {
      const target = evaluateExpression(
        expression.target,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      if (typeof target !== 'object' || target === null || !(expression.member in target)) {
        throw new TypeError(`Missing member ${expression.member}`);
      }
      return (target as Readonly<Record<string, RuntimeValue>>)[expression.member];
    }
    case 'index': {
      const target = evaluateExpression(
        expression.target,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      const index = evaluateExpression(
        expression.index,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      if (Array.isArray(target)) {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= target.length) {
          throw new TypeError(`Array index ${String(index)} is out of range`);
        }
        return target[index]!;
      }
      if (target === null || typeof target !== 'object') throw new TypeError('Expected Array or Map');
      if (typeof index !== 'string' && typeof index !== 'number') throw new TypeError('Map key must be String or Number');
      const key = String(index);
      if (!(key in target)) throw new TypeError(`Map key ${key} does not exist`);
      return (target as Readonly<Record<string, RuntimeValue>>)[key]!;
    }
    case 'convert': {
      const value = evaluateExpression(
        expression.target,
        readVariable,
        readEventOutput,
        readSubstoryOutput,
        readSignalOutput,
      );
      if (expression.to.kind === 'string') return String(value);
      if (expression.to.kind === 'number') return Number(value);
      if (expression.to.kind === 'boolean') return Boolean(value);
      return value;
    }
  }
  throw new TypeError(`Unsupported expression ${(expression as TypedExpression).kind}`);
}

export function renderTextTemplate(
  template: RuntimeTextTemplate,
  readVariable: VariableReader,
  locale?: string,
  fallbacks: Readonly<Record<string, string>> = {},
  sourceLocale?: string,
  readEventOutput?: EventOutputReader,
  readSubstoryOutput?: SubstoryOutputReader,
  readSignalOutput?: SignalOutputReader,
): string {
  let selected = locale;
  const visited = new Set<string>();
  while (selected && selected !== sourceLocale && !visited.has(selected)) {
    visited.add(selected);
    const variant = template.locales?.[selected];
    if (variant) {
      return variant.parts
        .map((part) =>
          part.kind === 'text'
            ? part.value
            : String(
                evaluateExpression(
                  part.expression,
                  readVariable,
                  readEventOutput,
                  readSubstoryOutput,
                  readSignalOutput,
                ) ?? '',
              ),
        )
        .join('');
    }
    selected = fallbacks[selected];
  }
  return template.parts
    .map((part) =>
      part.kind === 'text'
        ? part.value
        : String(
            evaluateExpression(
              part.expression,
              readVariable,
              readEventOutput,
              readSubstoryOutput,
              readSignalOutput,
            ) ?? '',
          ),
    )
    .join('');
}

export interface ResolvedChoiceOption {
  id: ChoiceInstruction['options'][number]['id'];
  text: string;
  enabled: boolean;
  target: ChoiceInstruction['options'][number]['target'];
}

export function resolveChoiceOptions(
  choice: ChoiceInstruction,
  readVariable: VariableReader,
  locale?: string,
  fallbacks: Readonly<Record<string, string>> = {},
  sourceLocale?: string,
  readEventOutput?: EventOutputReader,
  readSubstoryOutput?: SubstoryOutputReader,
  readSignalOutput?: SignalOutputReader,
): readonly ResolvedChoiceOption[] {
  return choice.options.flatMap((option) => {
    const visible = option.visibleIf
      ? asBoolean(
          evaluateExpression(
            option.visibleIf,
            readVariable,
            readEventOutput,
            readSubstoryOutput,
            readSignalOutput,
          ),
        )
      : true;
    if (!visible) return [];
    return [
      {
        id: option.id,
        text: renderTextTemplate(
          option.text,
          readVariable,
          locale,
          fallbacks,
          sourceLocale,
          readEventOutput,
          readSubstoryOutput,
          readSignalOutput,
        ),
        enabled: option.enabledIf
          ? asBoolean(
              evaluateExpression(
                option.enabledIf,
                readVariable,
                readEventOutput,
                readSubstoryOutput,
                readSignalOutput,
              ),
            )
          : true,
        target: option.target,
      },
    ];
  });
}
