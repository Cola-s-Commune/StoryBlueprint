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

export type VariableScope = 'project' | 'story' | 'chapter' | 'local' | 'character';

export interface VariableDefinition {
  id: VariableId;
  name: string;
  displayName: string;
  scope: VariableScope;
  valueType: ValueType;
  defaultValue: RuntimeValue;
}

/** Checks untrusted runtime data against the serialized value-type contract. */
export function runtimeValueMatchesType(value: RuntimeValue, type: ValueType): boolean {
  if (value === null) return type.kind === 'any' || Boolean(type.nullable);
  switch (type.kind) {
    case 'any':
      return true;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'enum':
      return typeof value === 'string' && type.values.includes(value);
    case 'struct':
      return (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.entries(type.fields).every(
          ([name, fieldType]) => name in value && runtimeValueMatchesType(value[name], fieldType),
        )
      );
  }
}
