import type { CharacterSource } from '@story-blueprint/common';

export function matchesCharacterSearch(character: CharacterSource, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  const searchable = [
    character.name,
    character.displayName,
    character.description ?? '',
    character.dialogueStyle ?? '',
    ...Object.entries(character.relationships ?? {}).flatMap(([targetId, relationship]) => [
      targetId,
      relationship.label,
      relationship.description ?? '',
    ]),
    ...Object.entries(character.emotions).flatMap(([key, emotion]) => [key, emotion.displayName]),
    ...(character.fields ?? []).flatMap((field) => [
      field.name,
      field.displayName,
      field.valueType.kind,
    ]),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query.split(/\s+/).every((term) => searchable.includes(term));
}
