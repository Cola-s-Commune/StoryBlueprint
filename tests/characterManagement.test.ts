import { describe, expect, it } from 'vitest';
import type { CharacterId, CharacterSource, VariableId } from '../packages/common/src';
import {
  duplicateCharacterDefinition,
  updateCharacterTags,
} from '../packages/editor/src/renderer/graph/characterManagement';

const character: CharacterSource = {
  id: 'c_original',
  name: 'mira',
  displayName: 'Mira',
  tags: ['captain'],
  metadata: { faction: 'Fleet' },
  emotions: { neutral: { displayName: 'Neutral' } },
  fields: [
    {
      id: 'v_trust',
      name: 'trust',
      displayName: 'Trust',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    },
  ],
};

describe('Character management', () => {
  it('duplicates data with fresh character and field identities', () => {
    const copy = duplicateCharacterDefinition(
      character,
      new Set(['mira', 'mira_copy']),
      () => 'c_copy' as CharacterId,
      () => 'v_copytrust' as VariableId,
    );

    expect(copy).toMatchObject({
      id: 'c_copy',
      name: 'mira_copy2',
      displayName: 'Mira Copy',
      tags: ['captain'],
      metadata: { faction: 'Fleet' },
    });
    expect(copy.fields?.[0]?.id).toBe('v_copytrust');
    expect(copy.emotions).not.toBe(character.emotions);
    expect(copy.metadata).not.toBe(character.metadata);
  });

  it('adds tags without duplicates and removes the final tag cleanly', () => {
    expect(updateCharacterTags(['party'], ' party ', 'add')).toEqual(['party']);
    expect(updateCharacterTags(['party'], 'leader', 'add')).toEqual(['party', 'leader']);
    expect(updateCharacterTags(['party'], 'party', 'remove')).toBeUndefined();
  });
});
