import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  replaceProjectStoriesAtomically,
  storyContentRevision,
} from '../packages/editor/src/main/projectStoryBatch';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project Story batch replacement', () => {
  it('replaces every Story and removes temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-batch-'));
    temporaryDirectories.push(directory);
    const firstPath = join(directory, 'first.story');
    const secondPath = join(directory, 'second.story');
    await writeFile(firstPath, 'first before', 'utf8');
    await writeFile(secondPath, 'second before', 'utf8');

    await replaceProjectStoriesAtomically([
      {
        filePath: firstPath,
        displayPath: 'first.story',
        content: 'first after',
        expectedRevision: storyContentRevision('first before'),
      },
      {
        filePath: secondPath,
        displayPath: 'second.story',
        content: 'second after',
        expectedRevision: storyContentRevision('second before'),
      },
    ]);

    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first after');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('second after');
    expect((await readdir(directory)).sort()).toEqual(['first.story', 'second.story']);
  });

  it('rejects the whole batch when a Story changed after the scan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-batch-'));
    temporaryDirectories.push(directory);
    const firstPath = join(directory, 'first.story');
    const secondPath = join(directory, 'second.story');
    await writeFile(firstPath, 'first before', 'utf8');
    await writeFile(secondPath, 'second before', 'utf8');
    const secondRevision = storyContentRevision('second before');
    await writeFile(secondPath, 'external edit', 'utf8');

    await expect(
      replaceProjectStoriesAtomically([
        {
          filePath: firstPath,
          displayPath: 'first.story',
          content: 'first after',
          expectedRevision: storyContentRevision('first before'),
        },
        {
          filePath: secondPath,
          displayPath: 'second.story',
          content: 'second after',
          expectedRevision: secondRevision,
        },
      ]),
    ).rejects.toThrow('Story changed on disk since the reference scan: second.story');

    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first before');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('external edit');
    expect((await readdir(directory)).sort()).toEqual(['first.story', 'second.story']);
  });
});
