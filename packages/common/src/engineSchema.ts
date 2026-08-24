import type { EngineFieldType, EngineTypeDefinition, EngineTypeField } from './types/project';
import { engineValueMatchesFieldType } from './types/project';
import type { RuntimeValue } from './types/values';

export const ENGINE_OBJECT_TYPE_MARKER = '$storyBlueprintType';

export function engineObjectTypeId(value: RuntimeValue): string | undefined {
  if (Array.isArray(value) || value === null || typeof value !== 'object') return undefined;
  const marker = (value as Readonly<Record<string, RuntimeValue>>)[ENGINE_OBJECT_TYPE_MARKER];
  return typeof marker === 'string' ? marker : undefined;
}

export function tagEngineObject(value: RuntimeValue, typeId: string): RuntimeValue {
  if (Array.isArray(value) || value === null || typeof value !== 'object') return value;
  return { ...value, [ENGINE_OBJECT_TYPE_MARKER]: typeId };
}

export function stripEngineObjectTypeMarkers(value: RuntimeValue): RuntimeValue {
  if (Array.isArray(value)) return value.map(stripEngineObjectTypeMarkers);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== ENGINE_OBJECT_TYPE_MARKER)
        .map(([key, item]) => [key, stripEngineObjectTypeMarkers(item)]),
    );
  }
  return value;
}

export interface EngineSchemaMigrationSummary {
  addedFields: readonly string[];
  removedFields: readonly string[];
  renamedFields: readonly { from: string; to: string }[];
  changedTypeFields: readonly string[];
}

function sameFieldType(left: EngineFieldType, right: EngineFieldType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'object' && right.kind === 'object') return left.typeName === right.typeName;
  if (left.kind === 'enum' && right.kind === 'enum') {
    return JSON.stringify(left.values) === JSON.stringify(right.values);
  }
  if (left.kind === 'array' && right.kind === 'array') {
    return sameFieldType(left.elementType, right.elementType);
  }
  if (left.kind === 'map' && right.kind === 'map') {
    return (
      JSON.stringify(left.keyType) === JSON.stringify(right.keyType) &&
      sameFieldType(left.valueType, right.valueType)
    );
  }
  return true;
}

function pairFields(
  previous: EngineTypeDefinition,
  next: EngineTypeDefinition,
): readonly { previous?: EngineTypeField; next?: EngineTypeField }[] {
  const pairs: { previous?: EngineTypeField; next?: EngineTypeField }[] = [];
  const usedPrevious = new Set<EngineTypeField>();
  const usedNext = new Set<EngineTypeField>();
  for (const nextField of next.fields) {
    const previousField = previous.fields.find((field) => field.id === nextField.id);
    if (!previousField) continue;
    pairs.push({ previous: previousField, next: nextField });
    usedPrevious.add(previousField);
    usedNext.add(nextField);
  }
  const unmatchedPrevious = previous.fields.filter((field) => !usedPrevious.has(field));
  const unmatchedNext = next.fields.filter((field) => !usedNext.has(field));
  for (const previousField of unmatchedPrevious) pairs.push({ previous: previousField });
  for (const nextField of unmatchedNext) pairs.push({ next: nextField });
  return pairs;
}

export function summarizeEngineSchemaMigration(
  previous: EngineTypeDefinition,
  next: EngineTypeDefinition,
): EngineSchemaMigrationSummary {
  const pairs = pairFields(previous, next);
  return {
    addedFields: pairs.flatMap(({ previous: before, next: after }) =>
      !before && after ? [after.name] : [],
    ),
    removedFields: pairs.flatMap(({ previous: before, next: after }) =>
      before && !after ? [before.name] : [],
    ),
    renamedFields: pairs.flatMap(({ previous: before, next: after }) =>
      before && after && before.name !== after.name ? [{ from: before.name, to: after.name }] : [],
    ),
    changedTypeFields: pairs.flatMap(({ previous: before, next: after }) =>
      before &&
      after &&
      (!sameFieldType(before.type, after.type) ||
        Boolean(before.nullable) !== Boolean(after.nullable))
        ? [after.name]
        : [],
    ),
  };
}

function migrateFieldValue(
  value: RuntimeValue,
  previousType: EngineFieldType,
  nextField: EngineTypeField,
  previousDefinitions: readonly EngineTypeDefinition[],
  nextDefinitions: readonly EngineTypeDefinition[],
): RuntimeValue {
  const nextType = nextField.type;
  if (previousType.kind === 'any' && nextType.kind === 'any') {
    return migrateEmbeddedEngineObjects(
      value,
      previousDefinitions,
      nextDefinitions,
    );
  }
  if (previousType.kind === 'array' && nextType.kind === 'array' && Array.isArray(value)) {
    return value.map((item) =>
      migrateFieldValue(
        item,
        previousType.elementType,
        { ...nextField, type: nextType.elementType },
        previousDefinitions,
        nextDefinitions,
      ),
    );
  }
  if (
    previousType.kind === 'map' &&
    nextType.kind === 'map' &&
    JSON.stringify(previousType.keyType) === JSON.stringify(nextType.keyType) &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    value !== null
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        migrateFieldValue(
          item,
          previousType.valueType,
          { ...nextField, type: nextType.valueType },
          previousDefinitions,
          nextDefinitions,
        ),
      ]),
    );
  }
  if (previousType.kind === 'object' && nextType.kind === 'object') {
    const previous = previousDefinitions.find((item) => item.name === previousType.typeName);
    const next = nextDefinitions.find((item) => item.name === nextType.typeName);
    if (previous && next) {
      return migrateEngineJsonValue(value, previous, next, previousDefinitions, nextDefinitions);
    }
  }
  if (
    sameFieldType(previousType, nextType) &&
    engineValueMatchesFieldType(value, nextType, nextDefinitions)
  ) {
    return structuredClone(value);
  }
  if (value === null && nextField.nullable) return null;
  return structuredClone(nextField.defaultValue);
}

function exactObjectShapeMatches(
  value: RuntimeValue,
  definition: EngineTypeDefinition,
  definitions: readonly EngineTypeDefinition[],
): boolean {
  if (Array.isArray(value) || value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value).filter((key) => key !== ENGINE_OBJECT_TYPE_MARKER);
  return (
    keys.length === definition.fields.length &&
    definition.fields.every((field) => keys.includes(field.name)) &&
    engineValueMatchesFieldType(
      value,
      { kind: 'object', typeName: definition.name },
      definitions,
    )
  );
}

/** Migrates named Object-shaped values nested below an `any` container. */
export function migrateEmbeddedEngineObjects(
  value: RuntimeValue,
  previousDefinitions: readonly EngineTypeDefinition[],
  nextDefinitions: readonly EngineTypeDefinition[],
): RuntimeValue {
  const markedTypeId = engineObjectTypeId(value);
  for (const previous of previousDefinitions) {
    const next = nextDefinitions.find(
      (candidate) => candidate.id === previous.id && candidate.name === previous.name,
    );
    if (!next) continue;
    const summary = summarizeEngineSchemaMigration(previous, next);
    const changed =
      summary.addedFields.length +
      summary.removedFields.length +
      summary.renamedFields.length +
      summary.changedTypeFields.length;
    if (
      changed > 0 &&
      (markedTypeId === previous.id || exactObjectShapeMatches(value, previous, previousDefinitions))
    ) {
      return tagEngineObject(migrateEngineJsonValue(
        value,
        previous,
        next,
        previousDefinitions,
        nextDefinitions,
      ), next.id);
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      migrateEmbeddedEngineObjects(item, previousDefinitions, nextDefinitions),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        migrateEmbeddedEngineObjects(item, previousDefinitions, nextDefinitions),
      ]),
    );
  }
  return structuredClone(value);
}

export function migrateEngineJsonValue(
  value: RuntimeValue,
  previous: EngineTypeDefinition,
  next: EngineTypeDefinition,
  previousDefinitions: readonly EngineTypeDefinition[],
  nextDefinitions: readonly EngineTypeDefinition[],
): RuntimeValue {
  const source =
    !Array.isArray(value) && typeof value === 'object' && value !== null
      ? (value as Readonly<Record<string, RuntimeValue>>)
      : {};
  const migrated: Record<string, RuntimeValue> = {};
  for (const pair of pairFields(previous, next)) {
    if (!pair.next) continue;
    if (!pair.previous || source[pair.previous.name] === undefined) {
      migrated[pair.next.name] = structuredClone(pair.next.defaultValue);
      continue;
    }
    migrated[pair.next.name] = migrateFieldValue(
      source[pair.previous.name]!,
      pair.previous.type,
      pair.next,
      previousDefinitions,
      nextDefinitions,
    );
  }
  return migrated;
}

/** Reprojects stored defaults through the latest referenced Object schemas. */
export function normalizeEngineTypeDefaults(
  previousDefinitions: readonly EngineTypeDefinition[],
  nextDefinitions: readonly EngineTypeDefinition[],
): readonly EngineTypeDefinition[] {
  return nextDefinitions.map((nextDefinition) => {
    const previousDefinition = previousDefinitions.find(
      (candidate) => candidate.name === nextDefinition.name,
    );
    if (!previousDefinition) return nextDefinition;
    const previousDefaults = Object.fromEntries(
      previousDefinition.fields.map((field) => [field.name, field.defaultValue]),
    );
    const migrated = migrateEngineJsonValue(
      previousDefaults,
      previousDefinition,
      nextDefinition,
      previousDefinitions,
      nextDefinitions,
    ) as Readonly<Record<string, RuntimeValue>>;
    const fields = nextDefinition.fields.map((field) => {
      const defaultValue = migrated[field.name];
      return defaultValue === undefined ||
        JSON.stringify(defaultValue) === JSON.stringify(field.defaultValue)
        ? field
        : { ...field, defaultValue };
    });
    return fields.every((field, index) => field === nextDefinition.fields[index])
      ? nextDefinition
      : { ...nextDefinition, fields };
  });
}
