import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

export interface ProjectStoryBatchWrite {
  filePath: string;
  displayPath: string;
  content: string;
  expectedRevision: string;
}

export interface ProjectStoryBatchDelete {
  filePath: string;
  displayPath: string;
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
  deletes: readonly ProjectStoryBatchDelete[] = [],
): Promise<void> {
  const prepared: Array<
    ProjectStoryBatchWrite & {
      temporaryPath: string;
      backupPath: string;
      backedUp: boolean;
      replaced: boolean;
    }
  > = [];
  const preparedDeletes: Array<ProjectStoryBatchDelete & { backupPath: string; backedUp: boolean }> = [];
  for (const write of writes) {
    const current = await readFile(write.filePath, 'utf8');
    if (storyContentRevision(current) !== write.expectedRevision) {
      throw new Error(
        `Project file changed on disk before it could be updated: ${write.displayPath}`,
      );
    }
    const nonce = randomUUID();
    prepared.push({
      ...write,
      temporaryPath: `${write.filePath}.${nonce}.story-blueprint-tmp`,
      backupPath: `${write.filePath}.${nonce}.story-blueprint-backup`,
      backedUp: false,
      replaced: false,
    });
  }
  for (const deletion of deletes) {
    if (writes.some((write) => write.filePath === deletion.filePath)) {
      throw new Error(`Project update cannot write and delete the same file: ${deletion.displayPath}`);
    }
    const current = await readFile(deletion.filePath, 'utf8');
    if (storyContentRevision(current) !== deletion.expectedRevision) {
      throw new Error(`Project file changed on disk before it could be deleted: ${deletion.displayPath}`);
    }
    preparedDeletes.push({
      ...deletion,
      backupPath: `${deletion.filePath}.${randomUUID()}.story-blueprint-backup`,
      backedUp: false,
    });
  }

  try {
    for (const write of prepared) {
      await writeFile(write.temporaryPath, write.content, { encoding: 'utf8', flag: 'wx' });
    }
    for (const write of prepared) {
      await rename(write.filePath, write.backupPath);
      write.backedUp = true;
      await rename(write.temporaryPath, write.filePath);
      write.replaced = true;
    }
    for (const deletion of preparedDeletes) {
      await rename(deletion.filePath, deletion.backupPath);
      deletion.backedUp = true;
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const deletion of [...preparedDeletes].reverse()) {
      if (!deletion.backedUp) continue;
      try {
        await rename(deletion.backupPath, deletion.filePath);
        deletion.backedUp = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const write of [...prepared].reverse()) {
      try {
        if (write.backedUp) {
          if (write.replaced) await removeIfPresent(write.filePath);
          await rename(write.backupPath, write.filePath);
          write.backedUp = false;
          write.replaced = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        await removeIfPresent(write.temporaryPath);
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Project update failed and rollback was incomplete',
      );
    }
    throw error;
  }

  await Promise.allSettled(
    prepared.flatMap((write) => [
      removeIfPresent(write.backupPath),
      removeIfPresent(write.temporaryPath),
    ]),
  );
  await Promise.allSettled(preparedDeletes.map((deletion) => removeIfPresent(deletion.backupPath)));
}
