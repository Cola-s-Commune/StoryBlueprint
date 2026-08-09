import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

export interface ProjectStoryBatchWrite {
  filePath: string;
  displayPath: string;
  content: string;
  expectedRevision: string;
}

export function storyContentRevision(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function replaceProjectStoriesAtomically(
  writes: readonly ProjectStoryBatchWrite[],
): Promise<void> {
  const prepared: Array<
    ProjectStoryBatchWrite & { temporaryPath: string; backupPath: string; replaced: boolean }
  > = [];
  for (const write of writes) {
    const current = await readFile(write.filePath, 'utf8');
    if (storyContentRevision(current) !== write.expectedRevision) {
      throw new Error(`Story changed on disk since the reference scan: ${write.displayPath}`);
    }
    const nonce = randomUUID();
    prepared.push({
      ...write,
      temporaryPath: `${write.filePath}.${nonce}.story-blueprint-tmp`,
      backupPath: `${write.filePath}.${nonce}.story-blueprint-backup`,
      replaced: false,
    });
  }

  try {
    for (const write of prepared) {
      await writeFile(write.temporaryPath, write.content, { encoding: 'utf8', flag: 'wx' });
    }
    for (const write of prepared) {
      await rename(write.filePath, write.backupPath);
      try {
        await rename(write.temporaryPath, write.filePath);
        write.replaced = true;
      } catch (error) {
        await rename(write.backupPath, write.filePath);
        throw error;
      }
    }
  } catch (error) {
    for (const write of [...prepared].reverse()) {
      if (write.replaced) {
        await removeIfPresent(write.filePath);
        await rename(write.backupPath, write.filePath);
        write.replaced = false;
      }
      await removeIfPresent(write.temporaryPath);
    }
    throw error;
  }

  for (const write of prepared) {
    await removeIfPresent(write.backupPath);
    await removeIfPresent(write.temporaryPath);
  }
}
