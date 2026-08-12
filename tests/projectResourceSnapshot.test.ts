import { describe, expect, it } from 'vitest';
import {
  serializeAssetResource,
  serializeCharacterResource,
  type AssetSource,
  type CharacterSource,
} from '../packages/common/src';
import { validateProjectResourceSnapshot } from '../packages/editor/src/main/projectResourceSnapshot';

const portrait: AssetSource = {
  id: 'a_portrait',
  name: 'portrait',
  displayName: 'Portrait',
  kind: 'portrait',
  locales: { default: 'portrait.png' },
};
const character: CharacterSource = {
  id: 'c_actor',
  name: 'actor',
  displayName: 'Actor',
  defaultPortraitId: portrait.id,
  emotions: { neutral: { displayName: 'Neutral' } },
};

describe('project resource history snapshot', () => {
  it('preserves original relative paths and serialized contents', () => {
    const files = validateProjectResourceSnapshot(
      {
        characters: [{ relativePath: 'Cast/Hero.character', character }],
        assets: [{ relativePath: 'Art/Hero.asset', asset: portrait }],
      },
      serializeCharacterResource,
      serializeAssetResource,
    );
    expect(files.map((file) => file.relativePath)).toEqual([
      'Cast/Hero.character',
      'Art/Hero.asset',
    ]);
    expect(files[0].content).toContain('character c_actor');
  });

  it('rejects duplicate paths and broken cross-resource references', () => {
    expect(() =>
      validateProjectResourceSnapshot(
        {
          characters: [{ relativePath: 'Actor.character', character }],
          assets: [],
        },
        serializeCharacterResource,
        serializeAssetResource,
      ),
    ).toThrow(/missing portrait/);
    expect(() =>
      validateProjectResourceSnapshot(
        {
          characters: [
            { relativePath: 'Same.character', character },
            { relativePath: 'Same.character', character: { ...character, id: 'c_other' } },
          ],
          assets: [{ relativePath: 'Art/Hero.asset', asset: portrait }],
        },
        serializeCharacterResource,
        serializeAssetResource,
      ),
    ).toThrow(/Invalid project resource path/);
  });
});
