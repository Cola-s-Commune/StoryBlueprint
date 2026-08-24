import { isStableId } from './ids';
import type { AssetId, CharacterId, EngineFieldId, EngineTypeId, ProjectId, StoryId } from './ids';
import type { EventSource, SignalSource } from './source';
import type { VariableDefinition } from './values';

export type EngineFieldType =
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'character-ref' }
  | { kind: 'asset-ref' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'object'; typeName: string }
  | { kind: 'array'; elementType: EngineFieldType }
  | { kind: 'map'; keyType: EngineMapKeyType; valueType: EngineFieldType };

export type EngineMapKeyType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'enum'; values: readonly string[] };

export interface EngineTypeField {
  id: EngineFieldId;
  name: string;
  displayName: string;
  description?: string;
  type: EngineFieldType;
  nullable?: boolean;
  defaultValue: import('./values').RuntimeValue;
}

export interface EngineTypeDefinition {
  id: EngineTypeId;
  name: string;
  displayName: string;
  description?: string;
  fields: readonly EngineTypeField[];
}

export interface EngineResourceValueReference {
  kind: 'character' | 'asset';
  id: string;
  path: string;
}

export function collectEngineResourceValueReferences(
  value: import('./values').RuntimeValue,
  type: EngineFieldType,
  definitions: readonly EngineTypeDefinition[],
  path = '',
): EngineResourceValueReference[] {
  if (value === null) return [];
  if (type.kind === 'character-ref' && typeof value === 'string') {
    return [{ kind: 'character', id: value, path }];
  }
  if (type.kind === 'asset-ref' && typeof value === 'string') {
    return [{ kind: 'asset', id: value, path }];
  }
  if (type.kind === 'array' && Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectEngineResourceValueReferences(item, type.elementType, definitions, `${path}[${index}]`),
    );
  }
  if (type.kind === 'map' && !Array.isArray(value) && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      collectEngineResourceValueReferences(item, type.valueType, definitions, path ? `${path}.${key}` : key),
    );
  }
  if (type.kind !== 'object' || Array.isArray(value) || typeof value !== 'object') return [];
  const definition = definitions.find((candidate) => candidate.name === type.typeName);
  const record = value as Readonly<Record<string, import('./values').RuntimeValue>>;
  return (definition?.fields ?? []).flatMap((field) => {
    const fieldValue = record[field.name];
    return fieldValue === undefined
      ? []
      : collectEngineResourceValueReferences(
          fieldValue,
          field.type,
          definitions,
          path ? `${path}.${field.name}` : field.name,
        );
  });
}

export function replaceEngineResourceValueReferences(
  value: import('./values').RuntimeValue,
  type: EngineFieldType,
  definitions: readonly EngineTypeDefinition[],
  kind: 'character' | 'asset',
  fromId: string,
  toId: string,
): { value: import('./values').RuntimeValue; count: number } {
  if (value === null) return { value, count: 0 };
  if (
    ((type.kind === 'character-ref' && kind === 'character') ||
      (type.kind === 'asset-ref' && kind === 'asset')) &&
    value === fromId
  ) {
    return { value: toId, count: 1 };
  }
  if (type.kind === 'array' && Array.isArray(value)) {
    let count = 0;
    const next = value.map((item) => {
      const replaced = replaceEngineResourceValueReferences(
        item,
        type.elementType,
        definitions,
        kind,
        fromId,
        toId,
      );
      count += replaced.count;
      return replaced.value;
    });
    return { value: count ? next : value, count };
  }
  if (type.kind === 'map' && !Array.isArray(value) && typeof value === 'object') {
    let count = 0;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const replaced = replaceEngineResourceValueReferences(
          item,
          type.valueType,
          definitions,
          kind,
          fromId,
          toId,
        );
        count += replaced.count;
        return [key, replaced.value];
      }),
    );
    return { value: count ? next : value, count };
  }
  if (type.kind !== 'object' || Array.isArray(value) || typeof value !== 'object') {
    return { value, count: 0 };
  }
  const definition = definitions.find((candidate) => candidate.name === type.typeName);
  const record = value as Readonly<Record<string, import('./values').RuntimeValue>>;
  let count = 0;
  const next = Object.fromEntries(
    Object.entries(record).map(([name, item]) => {
      const field = definition?.fields.find((candidate) => candidate.name === name);
      if (!field) return [name, item];
      const replaced = replaceEngineResourceValueReferences(
        item,
        field.type,
        definitions,
        kind,
        fromId,
        toId,
      );
      count += replaced.count;
      return [name, replaced.value];
    }),
  );
  return { value: count ? next : value, count };
}

export function engineValueMatchesFieldType(
  value: import('./values').RuntimeValue,
  type: EngineFieldType,
  definitions: readonly EngineTypeDefinition[],
): boolean {
  if (type.kind === 'boolean') return typeof value === 'boolean';
  if (type.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type.kind === 'string') return typeof value === 'string';
  if (type.kind === 'character-ref')
    return typeof value === 'string' && isStableId(value, 'character');
  if (type.kind === 'asset-ref') return typeof value === 'string' && isStableId(value, 'asset');
  if (type.kind === 'enum') return typeof value === 'string' && type.values.includes(value);
  if (type.kind === 'array') {
    return (
      Array.isArray(value) &&
      value.every((item) => engineValueMatchesFieldType(item, type.elementType, definitions))
    );
  }
  if (type.kind === 'map') {
    if (Array.isArray(value) || typeof value !== 'object' || value === null) return false;
    const keyMatches = (key: string) =>
      type.keyType.kind === 'string'
        ? key.length > 0
        : type.keyType.kind === 'number'
          ? key.trim() !== '' && Number.isFinite(Number(key))
          : type.keyType.values.includes(key);
    return Object.entries(value).every(
      ([key, item]) =>
        keyMatches(key) && engineValueMatchesFieldType(item, type.valueType, definitions),
    );
  }
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return false;
  const definition = definitions.find((item) => item.name === type.typeName);
  if (!definition) return false;
  const record = value as Readonly<Record<string, import('./values').RuntimeValue>>;
  return definition.fields.every((field) => {
    const fieldValue = record[field.name];
    return fieldValue === null && field.nullable
      ? true
      : fieldValue !== undefined &&
          engineValueMatchesFieldType(fieldValue, field.type, definitions);
  });
}

export const STORY_PROJECT_FORMAT = 'story-blueprint-project';
export const STORY_PROJECT_VERSION = 1;

export interface ProjectStoryReference {
  id: StoryId;
  path: string;
  name: string;
  displayName: string;
}

export interface ProjectCharacterReference {
  id: CharacterId;
  name: string;
  displayName: string;
  path?: string;
  storyIds: readonly StoryId[];
}

export interface ProjectAssetReference {
  id: AssetId;
  name: string;
  displayName: string;
  kind: 'audio' | 'portrait' | 'other';
  path?: string;
  locales: Readonly<Record<string, string>>;
  storyIds: readonly StoryId[];
}

export interface StoryProjectDocument {
  format: typeof STORY_PROJECT_FORMAT;
  version: typeof STORY_PROJECT_VERSION;
  id: ProjectId;
  name: string;
  displayName: string;
  entryStoryId?: StoryId;
  outputDirectory?: string;
  localizationPath?: string;
  stories: readonly ProjectStoryReference[];
  characters: readonly ProjectCharacterReference[];
  assets: readonly ProjectAssetReference[];
  variables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  engineTypes?: readonly EngineTypeDefinition[];
}
