import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadVerifiedUpdateArtifact } from '../packages/editor/src/main/updateDownloader';

const directories: string[] = [];

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'story-blueprint-update-'));
  directories.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true })));
});

function artifact(payload: Buffer, directory: string) {
  return {
    url: 'https://updates.example.com/StoryBlueprint-Setup-0.2.0-x64.exe',
    sha512: createHash('sha512').update(payload).digest('base64'),
    size: payload.length,
    directory,
  };
}

function response(payload: BodyInit, headers?: HeadersInit): Response {
  const value = new Response(payload, { headers });
  Object.defineProperty(value, 'url', { value: 'https://updates.example.com/StoryBlueprint-Setup-0.2.0-x64.exe' });
  return value;
}

describe('verified update downloader', () => {
  it('writes an artifact only after its signed hash and size match', async () => {
    const payload = Buffer.from('verified update artifact');
    const destination = await downloadVerifiedUpdateArtifact(
      artifact(payload, await directory()),
      () => undefined,
      new AbortController().signal,
      async () => response(payload, { 'content-length': String(payload.length) }),
    );
    await expect(readFile(destination)).resolves.toEqual(payload);
  });

  it('rejects mismatched payloads and removes partial files', async () => {
    const target = await directory();
    const payload = Buffer.from('expected artifact');
    await expect(
      downloadVerifiedUpdateArtifact(
        artifact(payload, target),
        () => undefined,
        new AbortController().signal,
        async () => response(Buffer.from('tampered artifact')),
      ),
    ).rejects.toThrow(/size/);
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('rejects matching-size payloads whose hash differs from the signed manifest', async () => {
    const target = await directory();
    const payload = Buffer.from('expected artifact');
    await expect(
      downloadVerifiedUpdateArtifact(
        artifact(payload, target),
        () => undefined,
        new AbortController().signal,
        async () => response(Buffer.alloc(payload.length, 0x5a), { 'content-length': String(payload.length) }),
      ),
    ).rejects.toThrow(/hash/);
    await expect(readdir(target)).resolves.toEqual([]);
  });
});
