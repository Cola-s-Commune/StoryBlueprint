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
  /** Stable Character resource ID passed to the engine Adapter. */
  | { kind: 'character-ref'; nullable?: boolean }
  /** Stable Asset resource ID passed to the engine Adapter. */
  | { kind: 'asset-ref'; nullable?: boolean }
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

/**
 * Compact, recursive descriptor used by KDL project/story files.  The descriptor is intentionally
 * a string so parameter schemas remain readable while nested structs/containers keep their full
 * contracts.  JSON is only used for the recursive portion, never for runtime values here.
 */
export function serializeValueTypeDescriptor(type: ValueType): string {
  const suffix = type.nullable ? '?' : '';
  switch (type.kind) {
    case 'any':
    case 'boolean':
    case 'number':
    case 'string':
    case 'character-ref':
    case 'asset-ref':
      return `${type.kind}${suffix}`;
    case 'json':
      if (!type.name.trim()) throw new Error('Engine JSON type name cannot be empty');
      return `json:${type.name}${suffix}`;
    case 'enum':
      return `enum:${JSON.stringify({ name: type.name, values: type.values })}${suffix}`;
    case 'array':
      if (!type.elementType) return `array${suffix}`;
      return `array:${JSON.stringify(type.elementType ?? { kind: 'any' })}${suffix}`;
    case 'map':
      if (!type.keyType && !type.valueType) return `map${suffix}`;
      return `map:${JSON.stringify({
        keyType: type.keyType ?? 'string',
        valueType: type.valueType ?? { kind: 'any' },
      })}${suffix}`;
    case 'struct':
      return `struct:${JSON.stringify({ name: type.name, fields: type.fields })}${suffix}`;
  }
}

/** Parses a descriptor emitted by serializeValueTypeDescriptor. */
export function parseValueTypeDescriptor(serialized: string): ValueType {
  const nullable = serialized.endsWith('?');
  const kind = nullable ? serialized.slice(0, -1) : serialized;
  const nullableFlag = nullable ? { nullable: true as const } : {};
  if (
    kind === 'any' ||
    kind === 'boolean' ||
    kind === 'number' ||
    kind === 'string' ||
    kind === 'character-ref' ||
    kind === 'asset-ref'
  ) {
    return { kind, ...nullableFlag } as ValueType;
  }
  if (kind.startsWith('json:') && kind.slice(5).trim()) {
    return { kind: 'json', name: kind.slice(5), ...nullableFlag };
  }
  if (kind === 'array') return { kind: 'array', ...nullableFlag };
  if (kind === 'map') return { kind: 'map', ...nullableFlag };
  const parseJson = (prefix: string): Record<string, unknown> => {
    const raw = kind.slice(prefix.length);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid ${prefix.slice(0, -1)} descriptor`);
    }
    return parsed as Record<string, unknown>;
  };
  if (kind.startsWith('array:')) {
    const elementDescriptor = parseJson('array:');
    const elementType = parseValueTypeDescriptorFromObject(elementDescriptor);
    return { kind: 'array', elementType, ...nullableFlag };
  }
  if (kind.startsWith('map:')) {
    const detail = parseJson('map:');
    const keyType = detail.keyType;
    if (
      keyType !== undefined &&
      keyType !== 'string' &&
      keyType !== 'number' &&
      keyType !== 'character-ref' &&
      keyType !== 'asset-ref'
    ) {
      throw new Error('Invalid Map key type');
    }
    const valueType = detail.valueType;
    if (valueType !== undefined && (typeof valueType !== 'object' || valueType === null)) {
      throw new Error('Invalid Map value type');
    }
    return {
      kind: 'map',
      keyType: keyType as 'string' | 'number' | 'character-ref' | 'asset-ref' | undefined,
      valueType: valueType ? parseValueTypeDescriptorFromObject(valueType) : undefined,
      ...nullableFlag,
    };
  }
  if (kind.startsWith('enum:')) {
    const detail = parseJson('enum:');
    if (
      typeof detail.name !== 'string' ||
      !detail.name.trim() ||
      !Array.isArray(detail.values) ||
      detail.values.length === 0 ||
      !detail.values.every((value) => typeof value === 'string' && value.length > 0)
    ) {
      throw new Error('Invalid Enum descriptor');
    }
    return {
      kind: 'enum',
      name: detail.name,
      values: detail.values as string[],
      ...nullableFlag,
    };
  }
  if (kind.startsWith('struct:')) {
    const detail = parseJson('struct:');
    if (
      typeof detail.name !== 'string' ||
      !detail.name.trim() ||
      detail.fields === null ||
      typeof detail.fields !== 'object' ||
      Array.isArray(detail.fields)
    ) {
      throw new Error('Invalid Struct descriptor');
    }
    const fields: Record<string, ValueType> = {};
    for (const [name, fieldType] of Object.entries(detail.fields as Record<string, unknown>)) {
      if (!name.trim() || fieldType === null || typeof fieldType !== 'object') {
        throw new Error('Invalid Struct field descriptor');
      }
      fields[name] = parseValueTypeDescriptorFromObject(fieldType);
    }
    return { kind: 'struct', name: detail.name, fields, ...nullableFlag };
  }
  throw new Error(`Unsupported value type ${kind}`);
}

function parseValueTypeDescriptorFromObject(value: unknown): ValueType {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid nested value type descriptor');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== 'string') throw new Error('Nested value type is missing kind');
  if (candidate.kind === 'json') {
    if (typeof candidate.name !== 'string') throw new Error('JSON type is missing name');
    return {
      kind: 'json',
      name: candidate.name,
      ...(candidate.nullable === true ? { nullable: true } : {}),
    };
  }
  if (candidate.kind === 'enum') {
    if (
      typeof candidate.name !== 'string' ||
      !Array.isArray(candidate.values) ||
      !candidate.values.every((item) => typeof item === 'string')
    )
      throw new Error('Invalid nested Enum type');
    return {
      kind: 'enum',
      name: candidate.name,
      values: candidate.values,
      ...(candidate.nullable === true ? { nullable: true } : {}),
    };
  }
  if (candidate.kind === 'struct') {
    if (typeof candidate.name !== 'string' || !candidate.name.trim())
      throw new Error('Nested Struct is missing name');
    if (
      candidate.fields === null ||
      typeof candidate.fields !== 'object' ||
      Array.isArray(candidate.fields)
    )
      throw new Error('Nested Struct is missing fields');
    const fields: Record<string, ValueType> = {};
    for (const [name, fieldType] of Object.entries(candidate.fields as Record<string, unknown>)) {
      fields[name] = parseValueTypeDescriptorFromObject(fieldType);
    }
    return {
      kind: 'struct',
      name: candidate.name,
      fields,
      ...(candidate.nullable === true ? { nullable: true } : {}),
    };
  }
  if (candidate.kind === 'array') {
    return {
      kind: 'array',
      elementType:
        candidate.elementType === undefined
          ? undefined
          : parseValueTypeDescriptorFromObject(candidate.elementType),
      ...(candidate.nullable === true ? { nullable: true } : {}),
    };
  }
  if (candidate.kind === 'map') {
    const keyType = candidate.keyType;
    if (
      keyType !== undefined &&
      keyType !== 'string' &&
      keyType !== 'number' &&
      keyType !== 'character-ref' &&
      keyType !== 'asset-ref'
    )
      throw new Error('Invalid nested Map key type');
    return {
      kind: 'map',
      keyType: keyType as 'string' | 'number' | 'character-ref' | 'asset-ref' | undefined,
      valueType:
        candidate.valueType === undefined
          ? undefined
          : parseValueTypeDescriptorFromObject(candidate.valueType),
      ...(candidate.nullable === true ? { nullable: true } : {}),
    };
  }
  if (
    candidate.kind !== 'any' &&
    candidate.kind !== 'boolean' &&
    candidate.kind !== 'number' &&
    candidate.kind !== 'string' &&
    candidate.kind !== 'character-ref' &&
    candidate.kind !== 'asset-ref'
  )
    throw new Error(`Unsupported nested value type ${candidate.kind}`);
  return {
    kind: candidate.kind,
    ...(candidate.nullable === true ? { nullable: true } : {}),
  } as ValueType;
}

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
        (!type.elementType ||
          value.every((item) => runtimeValueMatchesType(item, type.elementType!)))
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
    case 'character-ref':
      return typeof value === 'string' && isStableId(value, 'character');
    case 'asset-ref':
      return typeof value === 'string' && isStableId(value, 'asset');
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

/** Returns the default runtime value conforming to a value type. */
export function defaultForValueType(type: ValueType): RuntimeValue {
  if (type.nullable) return null;
  switch (type.kind) {
    case 'any':
    case 'json':
      return {};
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'character-ref':
    case 'asset-ref':
      return null;
    case 'enum':
      return type.values[0] ?? '';
    case 'array':
      return [];
    case 'map':
      return {};
    case 'struct':
      return Object.fromEntries(
        Object.entries(type.fields).map(([name, fieldType]) => [
          name,
          defaultForValueType(fieldType),
        ]),
      );
  }
}
