import { isStableId, type VariableId } from './ids';

export type RuntimeScalar = null | boolean | number | string;
export type RuntimeStruct = { readonly [field: string]: RuntimeValue };
export type RuntimeArray = readonly RuntimeValue[];
export type RuntimeValue = RuntimeScalar | RuntimeStruct | RuntimeArray;

export type ValueType =
  | { kind: 'any'; nullable?: boolean }
  | { kind: 'boolean'; nullable?: boolean }
  | { kind: 'number'; nullable?: boolean }
  | { kind: 'string'; nullable?: boolean }
  /** Opaque JSON array stored and passed as a complete value. */
  | { kind: 'array'; elementType?: ValueType; nullable?: boolean }
  /** Opaque JSON object used as a string-keyed map and passed as a complete value. */
  | {
      kind: 'map';
      keyType?: 'string' | 'number' | 'character-ref' | 'asset-ref';
      valueType?: ValueType;
      nullable?: boolean;
    }
  /** Opaque JSON contract passed intact to the engine Adapter; Story expressions cannot inspect it. */
  | { kind: 'json'; name: string; nullable?: boolean }
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
    case 'array':
      return (
        Array.isArray(value) &&
        (!type.elementType || value.every((item) => runtimeValueMatchesType(item, type.elementType!)))
      );
    case 'map':
      return (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every((key) => {
          if (!type.keyType || type.keyType === 'string') return true;
          if (type.keyType === 'number') return key.trim() !== '' && Number.isFinite(Number(key));
          return isStableId(key, type.keyType === 'character-ref' ? 'character' : 'asset');
        }) &&
        (!type.valueType ||
          Object.values(value).every((item) => runtimeValueMatchesType(item, type.valueType!)))
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'json':
      return isJsonValue(value);
    case 'enum':
      return typeof value === 'string' && type.values.includes(value);
    case 'struct':
      return (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.entries(type.fields).every(([name, fieldType]) => {
          const record = value as RuntimeStruct;
          return name in record && runtimeValueMatchesType(record[name]!, fieldType);
        })
      );
  }
}

function isJsonValue(value: RuntimeValue): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Object.values(value as RuntimeStruct).every(isJsonValue);
}
