import type { VariableId } from './ids';
import type { RuntimeValue, ValueType } from './values';

export interface ExpressionSource {
  /** Human- and AI-readable expression text. */
  source: string;
  /** Symbol name to stable variable ID bindings captured by the editor. */
  bindings: Readonly<Record<string, VariableId>>;
}

/** Inline authoring text. Expressions inside braces use the same safe expression grammar. */
export interface TextTemplateSource {
  source: string;
  /** Expression symbol bindings used inside `{...}` template fragments. */
  bindings?: Readonly<Record<string, VariableId>>;
}

export type UnaryOperator = 'not' | 'negate';
export type BinaryOperator =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'modulo'
  | 'equal'
  | 'not-equal'
  | 'less-than'
  | 'less-than-or-equal'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'and'
  | 'or';

export type TypedExpression =
  | { kind: 'literal'; value: RuntimeValue; valueType: ValueType }
  | { kind: 'variable'; variableId: VariableId; valueType: ValueType }
  | {
      kind: 'event-output';
      instructionId: import('./ids').InstructionId;
      outputId: import('./ids').EventOutputId;
      valueType: ValueType;
    }
  | {
      kind: 'substory-output';
      instructionId: import('./ids').InstructionId;
      outputId: VariableId;
      valueType: ValueType;
    }
  | { kind: 'unary'; operator: UnaryOperator; operand: TypedExpression; valueType: ValueType }
  | {
      kind: 'binary';
      operator: BinaryOperator;
      left: TypedExpression;
      right: TypedExpression;
      valueType: ValueType;
    }
  | { kind: 'member'; target: TypedExpression; member: string; valueType: ValueType }
  | { kind: 'index'; target: TypedExpression; index: TypedExpression; valueType: ValueType }
  | { kind: 'convert'; target: TypedExpression; to: ValueType; valueType: ValueType };
