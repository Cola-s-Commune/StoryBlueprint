import { describe, expect, it } from 'vitest';
import {
  parseAssetResource,
  parseCharacterResource,
  serializeAssetResource,
  serializeCharacterResource,
  type AssetSource,
  type CharacterSource,
} from '../packages/common/src';

const asset: AssetSource = {
  id: 'a_aliceportrait',
  name: 'alice-portrait',
  displayName: 'Alice Portrait',
  kind: 'portrait',
  locales: { default: 'Characters/Alice.png', 'zh-CN': 'Characters/Alice.zh-CN.png' },
};

const character: CharacterSource = {
  id: 'c_alice',
  name: 'alice',
  displayName: 'Alice',
  description: 'A careful navigator searching for her missing sister.',
  dialogueStyle: 'Precise, understated, and rarely uses contractions.',
  tags: ['navigator', 'protagonist'],
  metadata: { faction: 'Free Fleet', rank: 3, recruitable: true },
  relationships: {
    c_bob: { label: 'Trusted ally', description: 'Relies on Bob under pressure.' },
  },
  defaultPortraitId: 'a_aliceportrait',
  emotions: {
    happy: { displayName: 'Happy', portraitId: 'a_aliceportrait' },
    neutral: { displayName: 'Neutral' },
  },
  fields: [
    {
      id: 'v_aliceaffinity',
      name: 'affinity',
      displayName: 'Affinity',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    },
  ],
};

describe('project resource KDL', () => {
  it('round-trips character and asset files deterministically', () => {
    const characterText = serializeCharacterResource(character);
    const assetText = serializeAssetResource(asset);
    expect(serializeCharacterResource(parseCharacterResource(characterText))).toBe(characterText);
    expect(serializeAssetResource(parseAssetResource(assetText))).toBe(assetText);
    expect(characterText).toContain('emotion happy');
    expect(characterText).toContain('field v_aliceaffinity');
    expect(characterText).toContain('description="A careful navigator');
    expect(characterText).toContain('dialogue-style="Precise, understated');
    expect(characterText).toContain('relationship c_bob label="Trusted ally"');
    expect(characterText).toContain('tag navigator');
    expect(characterText).toContain('meta faction "Free Fleet"');
    expect(characterText).toContain('meta rank 3');
    expect(assetText).toContain('locale zh-CN');
  });

  it('rejects invalid stable resource IDs', () => {
    expect(() =>
      serializeCharacterResource({ ...character, id: 'bad' as CharacterSource['id'] }),
    ).toThrow(/Invalid character ID/);
    expect(() => serializeAssetResource({ ...asset, id: 'bad' as AssetSource['id'] })).toThrow(
      /Invalid asset ID/,
    );
  });

  it('round-trips character and asset reference fields', () => {
    const withReferences: CharacterSource = {
      ...character,
      fields: [
        {
          id: 'v_favoritecharacter',
          name: 'favoriteCharacter',
          displayName: 'Favorite Character',
          scope: 'character',
          valueType: { kind: 'character-ref' },
          defaultValue: 'c_bob',
        },
        {
          id: 'v_voiceasset',
          name: 'voiceAsset',
          displayName: 'Voice Asset',
          scope: 'character',
          valueType: { kind: 'asset-ref', nullable: true },
          defaultValue: null,
        },
      ],
    };
    const text = serializeCharacterResource(withReferences);
    expect(text).toContain('type=character-ref');
    expect(text).toContain('type=asset-ref?');
    expect(parseCharacterResource(text)).toEqual(withReferences);
  });
});
