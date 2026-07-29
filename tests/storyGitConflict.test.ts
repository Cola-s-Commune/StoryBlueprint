import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readStoryGitConflict,
  readWorkspaceGitConflicts,
} from '../packages/editor/src/main/storyGitConflict';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Story Git conflict stages', () => {
  it('reads Base, Local, and Remote from a real unmerged Git index', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-conflict-'));
    temporaryDirectories.push(repository);
    const storyPath = join(repository, 'main.story');

    await git(repository, 'init');
    await git(repository, 'checkout', '-b', 'local');
    await git(repository, 'config', 'user.email', 'story-blueprint@example.invalid');
    await git(repository, 'config', 'user.name', 'Story Blueprint Test');
    await writeFile(storyPath, 'base\n', 'utf8');
    await git(repository, 'add', 'main.story');
    await git(repository, 'commit', '-m', 'base');

    await git(repository, 'checkout', '-b', 'remote');
    await writeFile(storyPath, 'remote\n', 'utf8');
    await git(repository, 'commit', '-am', 'remote');

    await git(repository, 'checkout', 'local');
    await writeFile(storyPath, 'local\n', 'utf8');
    await git(repository, 'commit', '-am', 'local');
    await expect(git(repository, 'merge', 'remote')).rejects.toThrow();

    const conflict = await readStoryGitConflict(storyPath);
    expect(conflict).toMatchObject({
      relativePath: 'main.story',
      base: 'base\n',
      local: 'local\n',
      remote: 'remote\n',
    });
    expect(conflict?.repositoryRoot.replaceAll('\\', '/').toLowerCase()).toBe(
      repository.replaceAll('\\', '/').toLowerCase(),
    );
    expect(conflict?.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns undefined for a Story without an unmerged index entry', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-clean-'));
    temporaryDirectories.push(repository);
    const storyPath = join(repository, 'main.story');

    await git(repository, 'init');
    await writeFile(storyPath, 'clean\n', 'utf8');

    await expect(readStoryGitConflict(storyPath)).resolves.toBeUndefined();
  });

  it('discovers supported project resource conflicts under a workspace', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-resources-'));
    temporaryDirectories.push(repository);
    await git(repository, 'init');
    await git(repository, 'checkout', '-b', 'local');
    await git(repository, 'config', 'user.email', 'story-blueprint@example.invalid');
    await git(repository, 'config', 'user.name', 'Story Blueprint Test');
    for (const path of ['game.storyproject', 'Characters/hero.character', 'Assets/hero.asset']) {
      const filePath = join(repository, path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, 'base\n', 'utf8');
    }
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'base resources');
    await git(repository, 'checkout', '-b', 'remote');
    for (const path of ['game.storyproject', 'Characters/hero.character', 'Assets/hero.asset']) {
      await writeFile(join(repository, path), 'remote\n', 'utf8');
    }
    await git(repository, 'commit', '-am', 'remote resources');
    await git(repository, 'checkout', 'local');
    for (const path of ['game.storyproject', 'Characters/hero.character', 'Assets/hero.asset']) {
      await writeFile(join(repository, path), 'local\n', 'utf8');
    }
    await git(repository, 'commit', '-am', 'local resources');
    await expect(git(repository, 'merge', 'remote')).rejects.toThrow();

    const conflicts = await readWorkspaceGitConflicts(repository);
    expect(conflicts.map(({ relativePath, kind }) => ({ relativePath, kind }))).toEqual([
      { relativePath: 'Assets/hero.asset', kind: 'asset' },
      { relativePath: 'Characters/hero.character', kind: 'character' },
      { relativePath: 'game.storyproject', kind: 'project' },
    ]);
    expect(conflicts.every((conflict) => conflict.base === 'base\n')).toBe(true);
    expect(conflicts.every((conflict) => conflict.local === 'local\n')).toBe(true);
    expect(conflicts.every((conflict) => conflict.remote === 'remote\n')).toBe(true);
    expect(conflicts.every((conflict) => /^[a-f0-9]{64}$/.test(conflict.revision))).toBe(true);
  });

  it('preserves missing stages for modify/delete and add/add conflicts', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-add-delete-'));
    temporaryDirectories.push(repository);
    const characterPath = join(repository, 'Characters/hero.character');
    const assetPath = join(repository, 'Assets/new.asset');
    await git(repository, 'init');
    await git(repository, 'checkout', '-b', 'local');
    await git(repository, 'config', 'user.email', 'story-blueprint@example.invalid');
    await git(repository, 'config', 'user.name', 'Story Blueprint Test');
    await mkdir(dirname(characterPath), { recursive: true });
    await writeFile(characterPath, 'base character\n', 'utf8');
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'base');

    await git(repository, 'checkout', '-b', 'remote');
    await writeFile(characterPath, 'remote character\n', 'utf8');
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, 'remote asset\n', 'utf8');
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'remote changes');

    await git(repository, 'checkout', 'local');
    await rm(characterPath);
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, 'local asset\n', 'utf8');
    await git(repository, 'add', '-A');
    await git(repository, 'commit', '-m', 'local changes');
    await expect(git(repository, 'merge', 'remote')).rejects.toThrow();

    const conflicts = await readWorkspaceGitConflicts(repository);
    const asset = conflicts.find((conflict) => conflict.relativePath === 'Assets/new.asset');
    expect(asset).toMatchObject({
      kind: 'asset',
      local: 'local asset\n',
      remote: 'remote asset\n',
    });
    expect(asset?.base).toBeUndefined();
    const character = conflicts.find(
      (conflict) => conflict.relativePath === 'Characters/hero.character',
    );
    expect(character).toMatchObject({
      kind: 'character',
      base: 'base character\n',
      remote: 'remote character\n',
    });
    expect(character?.local).toBeUndefined();
  });
});
