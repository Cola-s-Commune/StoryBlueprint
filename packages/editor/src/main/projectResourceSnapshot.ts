import type { AssetSource, CharacterSource } from '@story-blueprint/common';
import type { ProjectResourceSnapshot } from '../shared/electronApi';

export interface SerializedProjectResourceFile {
  relativePath: string;
  extension: '.character' | '.asset';
  content: string;
}

export function validateProjectResourceSnapshot(
  snapshot: ProjectResourceSnapshot,
  serializeCharacter: (character: CharacterSource) => string,
  serializeAsset: (asset: AssetSource) => string,
  knownCharacterIds: readonly string[] = [],
  knownPortraitAssetIds: readonly string[] = [],
): SerializedProjectResourceFile[] {
  const files: SerializedProjectResourceFile[] = [
    ...snapshot.characters.map(({ relativePath, character }) => ({
      relativePath,
      extension: '.character' as const,
      content: serializeCharacter(character),
    })),
    ...snapshot.assets.map(({ relativePath, asset }) => ({
      relativePath,
      extension: '.asset' as const,
      content: serializeAsset(asset),
    })),
  ];
  const paths = new Set<string>();
  for (const file of files) {
    if (
      typeof file.relativePath !== 'string' ||
      !file.relativePath.toLowerCase().endsWith(file.extension) ||
      paths.has(file.relativePath)
    ) {
      throw new Error('Invalid project resource path');
    }
    paths.add(file.relativePath);
  }
  const characterIds = new Set<string>(knownCharacterIds);
  const characterNames = new Set<string>();
  const assetIds = new Set<string>();
  const assetNames = new Set<string>();
  for (const { character } of snapshot.characters) {
    if (characterIds.has(character.id) || characterNames.has(character.name)) {
      throw new Error(`Duplicate character ID or name: ${character.displayName}`);
    }
    characterIds.add(character.id);
    characterNames.add(character.name);
  }
  for (const { asset } of snapshot.assets) {
    if (assetIds.has(asset.id) || assetNames.has(asset.name)) {
      throw new Error(`Duplicate asset ID or name: ${asset.displayName}`);
    }
    assetIds.add(asset.id);
    assetNames.add(asset.name);
  }
  const portraitAssetIds = new Set(knownPortraitAssetIds);
  for (const { asset } of snapshot.assets) {
    if (asset.kind === 'portrait') portraitAssetIds.add(asset.id);
  }
  for (const { character } of snapshot.characters) {
    for (const targetId of Object.keys(character.relationships ?? {})) {
      if (!characterIds.has(targetId)) {
        throw new Error(`Character references missing character ${targetId}`);
      }
    }
    const portraitIds = [
      character.defaultPortraitId,
      ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
    ].filter((portraitId): portraitId is NonNullable<typeof portraitId> => Boolean(portraitId));
    for (const portraitId of portraitIds) {
      if (!portraitAssetIds.has(portraitId)) {
        throw new Error(`Character references missing portrait ${portraitId}`);
      }
    }
  }
  return files;
}
