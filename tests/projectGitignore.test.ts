import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectGitignoreIfMissing,
  STORY_PROJECT_GITIGNORE_TEMPLATE,
} from '../packages/editor/src/main/projectGitignore';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Story project .gitignore template', () => {
  it('creates the template for a new project directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-gitignore-'));
    temporaryDirectories.push(directory);

    await expect(createProjectGitignoreIfMissing(directory)).resolves.toBe(true);
    await expect(readFile(join(directory, '.gitignore'), 'utf8')).resolves.toBe(
      STORY_PROJECT_GITIGNORE_TEMPLATE,
    );
  });

  it('does not overwrite an existing .gitignore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-blueprint-gitignore-'));
    temporaryDirectories.push(directory);
    const gitignorePath = join(directory, '.gitignore');
    await writeFile(gitignorePath, '# Keep my rules\n', 'utf8');

    await expect(createProjectGitignoreIfMissing(directory)).resolves.toBe(false);
    await expect(readFile(gitignorePath, 'utf8')).resolves.toBe('# Keep my rules\n');
  });
});
