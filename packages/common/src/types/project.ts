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
