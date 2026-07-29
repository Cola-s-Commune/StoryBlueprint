import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STORY_PROJECT_GITIGNORE_TEMPLATE = `# Story Blueprint compiler output
*.storyc.json

# Local environment and editor files
.DS_Store
Thumbs.db
Desktop.ini
.idea/
.vscode/
*.swp
*.swo
*~
`;

export async function createProjectGitignoreIfMissing(rootPath: string): Promise<boolean> {
  try {
    await writeFile(join(rootPath, '.gitignore'), STORY_PROJECT_GITIGNORE_TEMPLATE, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
