import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { readPackage, validateSources, prepareUnityRelease } = require('../packages/editor/scripts/prepare-unity-release.cjs');
const root = resolve(__dirname, '..');
const packagePath = 'integrations/unity/StoryBlueprintAdapter.unitypackage';
const sourcePath = 'integrations/unity/samples/RuntimeDemo/Assets/StoryBlueprintAdapter';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('Unity Adapter release preparation', () => {
  it('accepts the native Unity export containing the current player UI and scripts', async () => {
    const assets = readPackage(await readFile(join(root, packagePath)));
    expect(assets.has('Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintStoryPlayer.prefab')).toBe(true);
    expect(() => validateSources(assets, join(root, sourcePath))).not.toThrow();
  });

  it('rejects missing or outdated exported source', async () => {
    const assets = readPackage(await readFile(join(root, packagePath)));
    const player = 'Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintStoryPlayer.prefab';
    assets.delete(player);
    expect(() => validateSources(assets, join(root, sourcePath))).toThrow('missing or outdated');
    const stale = readPackage(await readFile(join(root, packagePath)));
    const template = stale.get('Assets/StoryBlueprintAdapter/Editor/UnityStoryHostEditor.cs');
    template.bytes = Buffer.from('outdated template');
    expect(() => validateSources(stale, join(root, sourcePath))).toThrow('missing or outdated');
  });

  it('stages unchanged bytes and matching download metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-unity-release-'));
    temporary.push(directory);
    expect(() => prepareUnityRelease(directory)).toThrow('Missing');
    await mkdir(join(directory, 'integrations/unity'), { recursive: true });
    await cp(join(root, packagePath), join(directory, packagePath));
    await cp(join(root, sourcePath), join(directory, sourcePath), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    const metadata = prepareUnityRelease(directory);
    const input = await readFile(join(root, packagePath));
    expect(await readFile(join(directory, 'release/StoryBlueprintAdapter.unitypackage'))).toEqual(input);
    expect(metadata).toMatchObject({ version: '1.2.3', url: './StoryBlueprintAdapter.unitypackage', size: input.length,
      sha512: createHash('sha512').update(input).digest('base64') });
    expect(JSON.parse(await readFile(join(directory, 'release/unity-adapter.json'), 'utf8'))).toEqual(metadata);
  });
});
