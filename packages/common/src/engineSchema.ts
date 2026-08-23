import type { EngineFieldType, EngineTypeDefinition, EngineTypeField } from './types/project';
import { engineValueMatchesFieldType } from './types/project';
import type { RuntimeValue } from './types/values';

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
