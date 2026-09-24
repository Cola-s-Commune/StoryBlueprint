import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStoryProject } from '@story-blueprint/common';
import {
  deriveSafeProjectName,
  initializeProjectDirectory,
} from '../packages/editor/src/main/projectCreation';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('projectCreation - Project Path Selection & Automatic File Generation', () => {
  it('derives safe project names from folder names', () => {
    expect(deriveSafeProjectName('D:/My Games/Epic Story 01')).toEqual({
      name: 'epic-story-01',
      displayName: 'Epic Story 01',
    });
    expect(deriveSafeProjectName('D:/Special_Project-V2')).toEqual({
      name: 'special_project-v2',
      displayName: 'Special_Project-V2',
    });
  });

  it('creates the directory if missing ("没有则创建") and generates storyproject, gitignore, and AI instructions', async () => {
    const parentDir = join(tmpdir(), `sb_test_${Date.now()}`);
    temporaryDirectories.push(parentDir);
    // Non-existent target directory
    const targetPath = join(parentDir, 'non_existent_folder', 'My Adventure');

    // Verify it does not exist yet
    let existsBefore = true;
    try {
      await stat(targetPath);
    } catch {
      existsBefore = false;
    }
    expect(existsBefore).toBe(false);

    // Initialize project
    const result = await initializeProjectDirectory(targetPath);
    expect(result.projectName).toBe('my-adventure');
    expect(result.displayName).toBe('My Adventure');
    expect(result.projectFile).toBe(join(result.rootPath, 'my-adventure.storyproject'));

    // Verify directory was created
    const dirStat = await stat(result.rootPath);
    expect(dirStat.isDirectory()).toBe(true);

    // Verify *.storyproject file was created and is valid KDL
    const projectContent = await readFile(result.projectFile, 'utf8');
    const parsedProject = parseStoryProject(projectContent);
    expect(parsedProject.name).toBe('my-adventure');
    expect(parsedProject.displayName).toBe('My Adventure');

    // Verify .gitignore was created
    const gitignoreContent = await readFile(join(result.rootPath, '.gitignore'), 'utf8');
    expect(gitignoreContent).toContain('*.storyc.json');

    // Verify STORY_BLUEPRINT_AI.md was created
    const aiInstructions = await readFile(join(result.rootPath, 'STORY_BLUEPRINT_AI.md'), 'utf8');
    expect(aiInstructions).toContain('Story Blueprint AI Guidelines');
  });

  it('throws an error if the directory already contains a .storyproject file', async () => {
    const testDir = join(tmpdir(), `sb_test_existing_${Date.now()}`);
    temporaryDirectories.push(testDir);
    await mkdir(testDir, { recursive: true });

    // First initialization succeeds
    await initializeProjectDirectory(testDir);

    // Second initialization on the same directory should throw
    await expect(initializeProjectDirectory(testDir)).rejects.toThrow(
      'Target folder already contains a Story project',
    );
  });
});
