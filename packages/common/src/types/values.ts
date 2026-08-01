import type { VariableId } from './ids';

export type RuntimeScalar = null | boolean | number | string;
export type RuntimeStruct = { readonly [field: string]: RuntimeValue };
export type RuntimeValue = RuntimeScalar | RuntimeStruct;

export type ValueType =
  | { kind: 'any'; nullable?: boolean }
  | { kind: 'boolean'; nullable?: boolean }
  | { kind: 'number'; nullable?: boolean }
  | { kind: 'string'; nullable?: boolean }
  | { kind: 'enum'; name: string; values: readonly string[]; nullable?: boolean }
  | {
      kind: 'struct';
      name: string;
      fields: Readonly<Record<string, ValueType>>;
      nullable?: boolean;
    };

export type VariableScope = 'story' | 'chapter' | 'local' | 'character';

export interface VariableDefinition {
  id: VariableId;
  name: string;
  displayName: string;
  scope: VariableScope;
  valueType: ValueType;
  defaultValue: RuntimeValue;
}
