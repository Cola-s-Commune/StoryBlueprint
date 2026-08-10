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
    const projectPath = join(directory, 'project.storyproject');
    await writeFile(firstPath, 'first before', 'utf8');
    await writeFile(secondPath, 'second before', 'utf8');
    await writeFile(projectPath, 'project before', 'utf8');

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
      {
        filePath: projectPath,
        displayPath: 'project.storyproject',
        content: 'project after',
        expectedRevision: storyContentRevision('project before'),
      },
    ]);

    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first after');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('second after');
    await expect(readFile(projectPath, 'utf8')).resolves.toBe('project after');
    expect((await readdir(directory)).sort()).toEqual([
      'first.story',
      'project.storyproject',
      'second.story',
    ]);
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
    ).rejects.toThrow('Project file changed on disk before it could be updated: second.story');

    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first before');
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('external edit');
    expect((await readdir(directory)).sort()).toEqual(['first.story', 'second.story']);
  });

  it('does not rewrite Stories when the project file changed after the scan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-batch-'));
    temporaryDirectories.push(directory);
    const storyPath = join(directory, 'main.story');
    const projectPath = join(directory, 'project.storyproject');
    await writeFile(storyPath, 'story before', 'utf8');
    await writeFile(projectPath, 'project before', 'utf8');
    const projectRevision = storyContentRevision('project before');
    await writeFile(projectPath, 'external project edit', 'utf8');

    await expect(
      replaceProjectStoriesAtomically([
        {
          filePath: storyPath,
          displayPath: 'main.story',
          content: 'story after',
          expectedRevision: storyContentRevision('story before'),
        },
        {
          filePath: projectPath,
          displayPath: 'project.storyproject',
          content: 'project after',
          expectedRevision: projectRevision,
        },
      ]),
    ).rejects.toThrow(
      'Project file changed on disk before it could be updated: project.storyproject',
    );

    await expect(readFile(storyPath, 'utf8')).resolves.toBe('story before');
    await expect(readFile(projectPath, 'utf8')).resolves.toBe('external project edit');
  });
});
