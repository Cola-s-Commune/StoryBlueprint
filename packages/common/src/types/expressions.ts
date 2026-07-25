import type { VariableId } from './ids';
import type { RuntimeScalar, ValueType } from './values';

export interface ExpressionSource {
  /** Human- and AI-readable expression text. */
  source: string;
  /** Symbol name to stable variable ID bindings captured by the editor. */
  bindings: Readonly<Record<string, VariableId>>;
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
  | { kind: 'literal'; value: RuntimeScalar; valueType: ValueType }
  | { kind: 'variable'; variableId: VariableId; valueType: ValueType }
  | { kind: 'unary'; operator: UnaryOperator; operand: TypedExpression; valueType: ValueType }
  | {
      kind: 'binary';
      operator: BinaryOperator;
      left: TypedExpression;
      right: TypedExpression;
      valueType: ValueType;
    }
  | { kind: 'member'; target: TypedExpression; member: string; valueType: ValueType }
  | { kind: 'convert'; target: TypedExpression; to: ValueType; valueType: ValueType };
