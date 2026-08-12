import { dirname } from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

export async function restoreStoryHistoryFile(
  filePath: string,
  content: string | undefined,
  validate: (content: string) => void,
  finalize: () => Promise<void>,
): Promise<void> {
  let previous: string | undefined;
  try {
    previous = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (content !== undefined) validate(content);
  try {
    if (content === undefined) {
      if (previous !== undefined) await unlink(filePath);
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }
    await finalize();
  } catch (error) {
    if (previous === undefined) {
      try {
        await unlink(filePath);
      } catch (rollbackError) {
        if ((rollbackError as NodeJS.ErrnoException).code !== 'ENOENT') throw rollbackError;
      }
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, previous, 'utf8');
    }
    await finalize();
    throw error;
  }
}
