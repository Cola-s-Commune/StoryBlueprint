import type { ExternalWorkspaceFileChange } from '../shared/electronApi';

export type WorkspaceFileKind = ExternalWorkspaceFileChange['kind'];

export interface WorkspaceFileFingerprint {
  kind: WorkspaceFileKind;
  content: string;
  hash: string;
  size: number;
  modifiedAt: number;
}

export interface WorkspaceFilePollInput {
  previous: ReadonlyMap<string, WorkspaceFileFingerprint>;
  next: ReadonlyMap<string, WorkspaceFileFingerprint>;
  previousCheckout?: string;
  nextCheckout?: string;
  lastCheckoutChangeAt: number;
  now: number;
  checkoutSuppressionMs: number;
}

export interface WorkspaceFilePollDecision {
  changes: ExternalWorkspaceFileChange[];
  checkoutChanged: boolean;
  suppressFileChanges: boolean;
  lastCheckoutChangeAt: number;
}

export function canReuseWorkspaceFileFingerprint(
  known: WorkspaceFileFingerprint | undefined,
  metadata: { size: number; modifiedAt: number },
  kind: WorkspaceFileKind,
): known is WorkspaceFileFingerprint {
  return Boolean(
    known &&
    known.size === metadata.size &&
    known.modifiedAt === metadata.modifiedAt &&
    known.kind === kind,
  );
}

export function diffWorkspaceFileSnapshots(
  previous: ReadonlyMap<string, WorkspaceFileFingerprint>,
  next: ReadonlyMap<string, WorkspaceFileFingerprint>,
): ExternalWorkspaceFileChange[] {
  const changes: ExternalWorkspaceFileChange[] = [];
  for (const [relativePath, current] of next) {
    const known = previous.get(relativePath);
    if (!known) {
      changes.push({
        relativePath,
        kind: current.kind,
        change: 'created',
        content: current.content,
      });
    } else if (known.hash !== current.hash) {
      changes.push({
        relativePath,
        kind: current.kind,
        change: 'modified',
        previousContent: known.content,
        content: current.content,
      });
    }
  }
  for (const [relativePath, known] of previous) {
    if (!next.has(relativePath)) {
      changes.push({
        relativePath,
        kind: known.kind,
        change: 'deleted',
        previousContent: known.content,
      });
    }
  }
  return changes;
}

export function planWorkspaceFilePoll(input: WorkspaceFilePollInput): WorkspaceFilePollDecision {
  const checkoutChanged = Boolean(
    input.previousCheckout && input.nextCheckout && input.previousCheckout !== input.nextCheckout,
  );
  const lastCheckoutChangeAt = checkoutChanged ? input.now : input.lastCheckoutChangeAt;
  const suppressFileChanges =
    checkoutChanged || input.now - lastCheckoutChangeAt < input.checkoutSuppressionMs;
  return {
    changes: suppressFileChanges ? [] : diffWorkspaceFileSnapshots(input.previous, input.next),
    checkoutChanged,
    suppressFileChanges,
    lastCheckoutChangeAt,
  };
}
