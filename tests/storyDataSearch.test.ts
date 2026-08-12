import { describe, expect, it } from 'vitest';
import type { CharacterSource } from '../packages/common/src';
import { matchesCharacterSearch } from '../packages/editor/src/renderer/components/Panels/storyDataSearch';

const character: CharacterSource = {
  id: 'c_mira',
  name: 'mira',
  displayName: 'Captain Mira',
  description: 'A cautious navigator searching for a lost expedition.',
  dialogueStyle: 'Formal nautical vocabulary with dry humor.',
  tags: ['captain', 'free-fleet'],
  metadata: { faction: 'Free Fleet', reputation: 7, recruitable: true },
  relationships: {
    c_orrin: { label: 'Former mentor', description: 'A source of unresolved resentment.' },
  },
  emotions: { suspicious: { displayName: 'Suspicious' } },
  fields: [
    {
      id: 'v_miratrust',
      name: 'trust',
      displayName: 'Crew Trust',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    },
  ],
};

describe('Story Data character search', () => {
  it('searches profile, dialogue style, emotions, and fields', () => {
    expect(matchesCharacterSearch(character, 'lost expedition')).toBe(true);
    expect(matchesCharacterSearch(character, 'nautical humor')).toBe(true);
    expect(matchesCharacterSearch(character, 'suspicious')).toBe(true);
    expect(matchesCharacterSearch(character, 'crew trust number')).toBe(true);
    expect(matchesCharacterSearch(character, 'former resentment')).toBe(true);
    expect(matchesCharacterSearch(character, 'free-fleet')).toBe(true);
    expect(matchesCharacterSearch(character, 'faction free fleet')).toBe(true);
    expect(matchesCharacterSearch(character, 'reputation 7 recruitable true')).toBe(true);
  });

  it('requires every search term to match while ignoring case and outer whitespace', () => {
    expect(matchesCharacterSearch(character, '  CAPTAIN navigator ')).toBe(true);
    expect(matchesCharacterSearch(character, 'captain cheerful')).toBe(false);
  });
});
