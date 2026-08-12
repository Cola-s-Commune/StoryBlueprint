import type { CharacterId, CharacterSource, VariableId } from '@story-blueprint/common';

export function duplicateCharacterDefinition(
  source: CharacterSource,
  existingNames: ReadonlySet<string>,
  createCharacterId: () => CharacterId,
  createFieldId: () => VariableId,
): CharacterSource {
  let suffix = 2;
  let name = `${source.name}_copy`;
  while (existingNames.has(name)) name = `${source.name}_copy${suffix++}`;
  return {
    ...structuredClone(source),
    id: createCharacterId(),
    name,
    displayName: `${source.displayName} Copy`,
    fields: source.fields?.map((field) => ({ ...field, id: createFieldId() })),
  };
}

export function updateCharacterTags(
  tags: readonly string[] | undefined,
  tag: string,
  mode: 'add' | 'remove',
): readonly string[] | undefined {
  const normalized = tag.trim();
  const next = new Set(tags ?? []);
  if (mode === 'add' && normalized) next.add(normalized);
  else if (mode === 'remove') next.delete(normalized);
  return next.size > 0 ? [...next] : undefined;
}
