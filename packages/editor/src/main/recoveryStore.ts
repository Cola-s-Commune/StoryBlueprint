import type { RecoverySnapshot } from '../shared/electronApi';

export interface ParsedRecoveryStore {
  snapshots: RecoverySnapshot[];
  error?: string;
}

function hasRecoveryShape(value: unknown): value is RecoverySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return (
    typeof snapshot.storyId === 'string' &&
    typeof snapshot.displayName === 'string' &&
    (snapshot.filePath === undefined || typeof snapshot.filePath === 'string') &&
    typeof snapshot.content === 'string' &&
    typeof snapshot.savedAt === 'string'
  );
}

export function parseRecoveryStore(
  value: unknown,
  validateContent: (content: string) => boolean,
  limit: number,
): ParsedRecoveryStore {
  if (!Array.isArray(value)) {
    return { snapshots: [], error: 'Recovery data has an invalid format.' };
  }
  const snapshots = value
    .filter(
      (candidate): candidate is RecoverySnapshot =>
        hasRecoveryShape(candidate) && validateContent(candidate.content),
    )
    .slice(0, limit);
  return {
    snapshots,
    ...(snapshots.length === value.length
      ? {}
      : { error: 'Some damaged recovery entries were ignored.' }),
  };
}
