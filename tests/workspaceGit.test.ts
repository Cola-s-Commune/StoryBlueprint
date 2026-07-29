import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  initializeWorkspaceGitRepository,
  readWorkspaceGitRepository,
} from '../packages/editor/src/main/workspaceGit';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('workspace Git repository', () => {
  it('initializes an unversioned workspace with main and a .gitignore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-workspace-git-'));
    temporaryDirectories.push(directory);

    await expect(readWorkspaceGitRepository(directory)).resolves.toMatchObject({
      available: true,
      initialized: false,
    });

    await expect(initializeWorkspaceGitRepository(directory)).resolves.toMatchObject({
      available: true,
      initialized: true,
      branch: 'main',
    });
    await expect(readFile(join(directory, '.gitignore'), 'utf8')).resolves.toContain(
      '*.storyc.json',
    );
  });

  it('keeps an existing .gitignore and does not create a nested repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-workspace-git-'));
    temporaryDirectories.push(directory);
    const nested = join(directory, 'StoryProject');
    await execFileAsync('git', ['init', '--initial-branch=main', directory], { windowsHide: true });
    await mkdir(nested);
    await writeFile(join(nested, '.gitignore'), '# Project rules\n', 'utf8');

    const result = await initializeWorkspaceGitRepository(nested);

    expect(result.initialized).toBe(true);
    await expect(readFile(join(nested, '.gitignore'), 'utf8')).resolves.toBe('# Project rules\n');
    await expect(stat(join(nested, '.git'))).rejects.toThrow();
  });
});
