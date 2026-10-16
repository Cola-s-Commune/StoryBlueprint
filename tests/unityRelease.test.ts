import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validatePackage, prepareUnityRelease } = require('../packages/editor/scripts/prepare-unity-release.cjs');
const root = resolve(__dirname, '..');
const packagePath = 'integrations/unity/samples/RuntimeDemo/Packages/com.storyblueprint.runtime';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('Unity UPM package release preparation', () => {
  it('validates the embedded package manifest, dependencies, assets and GUIDs', () => {
    const result = validatePackage(root);
    expect(result.manifest.name).toBe('com.storyblueprint.runtime');
    expect(result.manifest.dependencies['com.unity.nuget.newtonsoft-json']).toBe('3.2.1');
    expect(result.manifest.unity).toBe('2022.3');
  });

  it('rejects a package without its automatic Newtonsoft dependency', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-upm-invalid-'));
    temporary.push(directory);
    await mkdir(join(directory, packagePath), { recursive: true });
    await cp(join(root, packagePath), join(directory, packagePath), { recursive: true });
    const manifestPath = join(directory, packagePath, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.dependencies['com.unity.nuget.newtonsoft-json'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect(() => validatePackage(directory)).toThrow('declare Newtonsoft JSON 3.2.1');
  });

  it('stages a Git install URL with package version and dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-upm-release-'));
    temporary.push(directory);
    await mkdir(join(directory, packagePath), { recursive: true });
    await cp(join(root, packagePath), join(directory, packagePath), { recursive: true });
    const metadata = prepareUnityRelease(directory);
    expect(metadata).toMatchObject({
      packageId: 'com.storyblueprint.runtime',
      version: '0.1.1',
      gitUrl: expect.stringContaining('?path=/integrations/unity/samples/RuntimeDemo/Packages/com.storyblueprint.runtime#main'),
      dependencies: { 'com.unity.nuget.newtonsoft-json': '3.2.1' },
    });
    expect(JSON.parse(await readFile(join(directory, 'release/unity-adapter.json'), 'utf8'))).toEqual(metadata);
  });
});
