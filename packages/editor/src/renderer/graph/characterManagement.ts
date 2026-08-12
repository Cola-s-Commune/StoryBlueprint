import type {
  CharacterId,
  CharacterSource,
  CharacterTemplateSource,
  VariableId,
} from '@story-blueprint/common';

export const BUILTIN_CHARACTER_TEMPLATES: readonly CharacterTemplateSource[] = [
  {
    name: 'protagonist',
    displayName: 'Protagonist',
    tags: ['protagonist'],
    emotions: { neutral: { displayName: 'Neutral' }, determined: { displayName: 'Determined' } },
    fields: [
      {
        name: 'reputation',
        displayName: 'Reputation',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ],
  },
  {
    name: 'npc',
    displayName: 'NPC',
    tags: ['npc'],
    emotions: { neutral: { displayName: 'Neutral' } },
  },
  {
    name: 'merchant',
    displayName: 'Merchant',
    tags: ['npc', 'merchant'],
    metadata: { service: 'shop' },
    emotions: { neutral: { displayName: 'Neutral' }, pleased: { displayName: 'Pleased' } },
  },
  {
    name: 'companion',
    displayName: 'Companion',
    tags: ['party-member'],
    emotions: { neutral: { displayName: 'Neutral' }, happy: { displayName: 'Happy' } },
    fields: [
      { name: 'affinity', displayName: 'Affinity', valueType: { kind: 'number' }, defaultValue: 0 },
    ],
  },
];

export function characterToTemplate(
  character: CharacterSource,
  name: string,
  displayName: string,
): CharacterTemplateSource {
  return {
    name,
    displayName,
    description: character.description,
    dialogueStyle: character.dialogueStyle,
    tags: character.tags,
    metadata: character.metadata,
    emotions: Object.fromEntries(
      Object.entries(character.emotions).map(([key, emotion]) => [
        key,
        { displayName: emotion.displayName },
      ]),
    ),
    fields: character.fields?.map(
      ({ name: fieldName, displayName: fieldDisplay, valueType, defaultValue }) => ({
        name: fieldName,
        displayName: fieldDisplay,
        valueType,
        defaultValue,
      }),
    ),
  };
}

export function characterFromTemplate(
  template: CharacterTemplateSource,
  id: CharacterId,
  name: string,
  displayName: string,
  createFieldId: () => VariableId,
): CharacterSource {
  return {
    id,
    name,
    displayName,
    description: template.description,
    dialogueStyle: template.dialogueStyle,
    tags: template.tags,
    metadata: template.metadata,
    emotions: structuredClone(template.emotions),
    fields: template.fields?.map((field) => ({
      ...structuredClone(field),
      id: createFieldId(),
      scope: 'character',
    })),
  };
}

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
