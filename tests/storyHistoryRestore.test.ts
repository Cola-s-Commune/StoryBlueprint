import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreStoryHistoryFile } from '../packages/editor/src/main/storyHistoryRestore';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('Story history file restore', () => {
  it('restores and removes a Story at its original path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-history-'));
    directories.push(directory);
    const filePath = join(directory, 'Nested', 'main.story');
    await restoreStoryHistoryFile(
      filePath,
      'restored',
      () => undefined,
      async () => undefined,
    );
    expect(await readFile(filePath, 'utf8')).toBe('restored');
    await restoreStoryHistoryFile(
      filePath,
      undefined,
      () => undefined,
      async () => undefined,
    );
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back the file when project synchronization fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-history-'));
    directories.push(directory);
    const filePath = join(directory, 'main.story');
    await restoreStoryHistoryFile(
      filePath,
      'before',
      () => undefined,
      async () => undefined,
    );
    await expect(
      restoreStoryHistoryFile(
        filePath,
        'after',
        () => undefined,
        async () => {
          throw new Error('sync failed');
        },
      ),
    ).rejects.toThrow('sync failed');
    expect(await readFile(filePath, 'utf8')).toBe('before');
  });
});
