import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  createStableId,
  serializeStoryProject,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type StoryProjectDocument,
} from '@story-blueprint/common';
import { createProjectGitignoreIfMissing } from './projectGitignore';

export const DEFAULT_PROJECT_AI_INSTRUCTIONS = `# Story Blueprint AI Guidelines

This workspace contains interactive narrative content managed by Story Blueprint.
- Story logic and dialogue flow are authored as visual blueprint graphs and saved as \`.story\` files.
- The project manifest is stored in \`*.storyproject\`.
- Shared characters, variables, and assets are referenced across stories.
`;

export interface InitializedProjectDirectory {
  rootPath: string;
  projectFile: string;
  projectName: string;
  displayName: string;
}

export function deriveSafeProjectName(folderPath: string): { name: string; displayName: string } {
  const folderName = basename(resolve(folderPath));
  const fileStem = folderName || 'project';
  const name =
    fileStem
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  const displayName = fileStem === 'project' ? 'Story Project' : folderName;
  return { name, displayName };
}

/**
 * Initializes a project directory.
 * If the directory does not exist, it will be created recursively ("没有则创建").
 * Creates the *.storyproject manifest, .gitignore, and STORY_BLUEPRINT_AI.md files.
 */
export async function initializeProjectDirectory(targetPath: string): Promise<InitializedProjectDirectory> {
  const rootPath = resolve(targetPath);

  // 1. 没有则创建 (If it doesn't exist, create it recursively)
  await mkdir(rootPath, { recursive: true });

  // 2. Check if target folder already contains another .storyproject
  const rootEntries = await readdir(rootPath, { withFileTypes: true });
  const existingProject = rootEntries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.storyproject'),
  );
  if (existingProject) {
    throw new Error(`Target folder already contains a Story project (${existingProject.name})`);
  }

  // 3. Derive safe project identifier & project file path
  const { name, displayName } = deriveSafeProjectName(rootPath);
  const projectFile = join(rootPath, `${name}.storyproject`);

  // 4. Create initial Story Project document
  const project: StoryProjectDocument = {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: createStableId('project'),
    name,
    displayName,
    stories: [],
    characters: [],
    assets: [],
    variables: [],
    events: [],
    signals: [],
  };
  await writeFile(projectFile, serializeStoryProject(project), 'utf8');

  // 5. Create .gitignore if missing
  await createProjectGitignoreIfMissing(rootPath);

  // 6. Create STORY_BLUEPRINT_AI.md
  await writeFile(join(rootPath, 'STORY_BLUEPRINT_AI.md'), DEFAULT_PROJECT_AI_INSTRUCTIONS, {
    encoding: 'utf8',
    flag: 'wx',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });

  return {
    rootPath,
    projectFile,
    projectName: name,
    displayName,
  };
}
