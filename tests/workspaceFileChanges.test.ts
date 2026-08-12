import { describe, expect, it } from 'vitest';
import {
  canReuseWorkspaceFileFingerprint,
  diffWorkspaceFileSnapshots,
  planWorkspaceFilePoll,
  type WorkspaceFileFingerprint,
} from '../packages/editor/src/main/workspaceFileChanges';

function fingerprint(
  content: string,
  overrides: Partial<WorkspaceFileFingerprint> = {},
): WorkspaceFileFingerprint {
  return {
    kind: 'story',
    content,
    hash: `hash:${content}`,
    size: content.length,
    modifiedAt: 1,
    ...overrides,
  };
}

describe('workspace file change polling', () => {
  it('reports create, modify and delete with merge base content', () => {
    const previous = new Map([
      ['modified.story', fingerprint('before')],
      ['deleted.story', fingerprint('deleted')],
    ]);
    const next = new Map([
      ['modified.story', fingerprint('after')],
      ['created.story', fingerprint('created')],
    ]);

    expect(diffWorkspaceFileSnapshots(previous, next)).toEqual([
      {
        relativePath: 'modified.story',
        kind: 'story',
        change: 'modified',
        previousContent: 'before',
        content: 'after',
      },
      {
        relativePath: 'created.story',
        kind: 'story',
        change: 'created',
        content: 'created',
      },
      {
        relativePath: 'deleted.story',
        kind: 'story',
        change: 'deleted',
        previousContent: 'deleted',
      },
    ]);
  });

  it('collapses rapid writes to the latest observed content', () => {
    const previous = new Map([['main.story', fingerprint('v1')]]);
    const latest = new Map([['main.story', fingerprint('v3')]]);

    expect(diffWorkspaceFileSnapshots(previous, latest)[0]).toMatchObject({
      change: 'modified',
      previousContent: 'v1',
      content: 'v3',
    });
  });

  it('recognizes unchanged metadata without rereading content', () => {
    const known = fingerprint('same', { size: 42, modifiedAt: 123 });
    expect(canReuseWorkspaceFileFingerprint(known, { size: 42, modifiedAt: 123 }, 'story')).toBe(
      true,
    );
    expect(canReuseWorkspaceFileFingerprint(known, { size: 42, modifiedAt: 124 }, 'story')).toBe(
      false,
    );
  });

  it('uses a controllable clock to suppress checkout file churn', () => {
    const previous = new Map([['main.story', fingerprint('main')]]);
    const next = new Map([['main.story', fingerprint('branch')]]);
    const switched = planWorkspaceFilePoll({
      previous,
      next,
      previousCheckout: 'main',
      nextCheckout: 'feature',
      lastCheckoutChangeAt: 0,
      now: 10_000,
      checkoutSuppressionMs: 3_000,
    });
    expect(switched).toMatchObject({
      checkoutChanged: true,
      suppressFileChanges: true,
      changes: [],
      lastCheckoutChangeAt: 10_000,
    });

    const stillSuppressed = planWorkspaceFilePoll({
      previous,
      next,
      previousCheckout: 'feature',
      nextCheckout: 'feature',
      lastCheckoutChangeAt: switched.lastCheckoutChangeAt,
      now: 12_999,
      checkoutSuppressionMs: 3_000,
    });
    expect(stillSuppressed.suppressFileChanges).toBe(true);

    const settled = planWorkspaceFilePoll({
      previous,
      next,
      previousCheckout: 'feature',
      nextCheckout: 'feature',
      lastCheckoutChangeAt: switched.lastCheckoutChangeAt,
      now: 13_000,
      checkoutSuppressionMs: 3_000,
    });
    expect(settled.suppressFileChanges).toBe(false);
    expect(settled.changes).toHaveLength(1);
  });
});
