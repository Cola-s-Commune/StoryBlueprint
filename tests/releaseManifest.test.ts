import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateManifest } from '../packages/editor/src/shared/electronApi';

interface ManifestOptions {
  releaseRoot: string;
  version: string;
  channel: 'stable' | 'beta';
  releaseDate?: string;
  notes?: string;
}

interface ManifestGenerator {
  generateUpdateManifest(options: ManifestOptions): Promise<{
    manifest: UpdateManifest;
    outputPath: string;
  }>;
  validateChannel(value: string): 'stable' | 'beta';
  validateVersion(value: string): string;
}

const require = createRequire(import.meta.url);
const generator =
  require('../packages/editor/scripts/generate-update-manifest.cjs') as ManifestGenerator;
const temporaryDirectories: string[] = [];

async function temporaryRelease(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Windows update manifest generation', () => {
  it('writes artifact names, exact sizes, and base64 SHA-512 hashes', async () => {
    const releaseRoot = await temporaryRelease();
    const version = '0.2.0';
    const installer = Buffer.alloc(1024 * 1024 + 7, 0x41);
    const portable = Buffer.alloc(1024 * 1024 + 11, 0x42);
    await Promise.all([
      writeFile(join(releaseRoot, `StoryBlueprint-Setup-${version}-x64.exe`), installer),
      writeFile(join(releaseRoot, `StoryBlueprint-Portable-${version}-x64.exe`), portable),
    ]);

    const result = await generator.generateUpdateManifest({
      releaseRoot,
      version,
      channel: 'stable',
      releaseDate: '2026-08-20T00:00:00.000Z',
      notes: 'Manifest generation test.',
    });
    const saved = JSON.parse(await readFile(result.outputPath, 'utf8')) as UpdateManifest;

    expect(result.outputPath).toBe(join(releaseRoot, 'stable.json'));
    expect(saved).toMatchObject({
      format: 'story-blueprint-update',
      version: 1,
      channel: 'stable',
      latestVersion: version,
      installerUrl: `./StoryBlueprint-Setup-${version}-x64.exe`,
      portableUrl: `./StoryBlueprint-Portable-${version}-x64.exe`,
      installerSize: installer.length,
      portableSize: portable.length,
      installerSha512: createHash('sha512').update(installer).digest('base64'),
      portableSha512: createHash('sha512').update(portable).digest('base64'),
    });
  });

  it('rejects unsupported channels, invalid versions, and missing artifacts', async () => {
    expect(() => generator.validateChannel('nightly')).toThrow(/stable or beta/);
    expect(() => generator.validateVersion('version two')).toThrow(/valid SemVer/);
    await expect(
      generator.generateUpdateManifest({
        releaseRoot: await temporaryRelease(),
        version: '0.2.0-beta.1',
        channel: 'beta',
      }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      generator.generateUpdateManifest({
        releaseRoot: await temporaryRelease(),
        version: '0.2.0-beta.1',
        channel: 'stable',
      }),
    ).rejects.toThrow(/cannot be published to the stable channel/);
  });
});
