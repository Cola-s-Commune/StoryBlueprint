import { useMemo } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './RecoveryCenter.module.css';

const statusLabels = {
  unsaved: 'New unsaved Story',
  unchanged: 'File unchanged on disk',
  changed: 'File changed on disk',
  missing: 'Original file missing',
} as const;

function formatSavedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function RecoveryCenter() {
  const {
    recoveries,
    recoveryError,
    recoverStory,
    saveRecoveryAs,
    discardRecovery,
    discardAllRecoveries,
    dismissRecoveryError,
  } = useStoryGraphStore();
  const newest = useMemo(
    () =>
      recoveries.reduce<string | undefined>(
        (current, recovery) =>
          !current || recovery.savedAt > current ? recovery.savedAt : current,
        undefined,
      ),
    [recoveries],
  );

  if (recoveries.length === 0 && !recoveryError) return null;

  return (
    <div className={styles.backdrop}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>CRASH RECOVERY</span>
            <h1 id="recovery-title">Unsaved Story changes were found</h1>
            <p>
              Choose what to do with each recovery copy. Nothing is applied until you choose Recover
              or Save As.
            </p>
          </div>
          {recoveries.length > 0 && (
            <div className={styles.summary}>
              <strong>{recoveries.length}</strong>
              <span>{recoveries.length === 1 ? 'Story' : 'Stories'}</span>
              {newest && <small>Latest {formatSavedAt(newest)}</small>}
            </div>
          )}
        </header>

        {recoveryError && <div className={styles.warning}>{recoveryError}</div>}

        <div className={styles.list}>
          {recoveries.map((recovery) => (
            <article key={recovery.storyId} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.itemTitleRow}>
                  <strong>{recovery.displayName}</strong>
                  <span className={`${styles.status} ${styles[recovery.diskStatus]}`}>
                    {statusLabels[recovery.diskStatus]}
                  </span>
                </div>
                <div className={styles.meta}>Recovery saved {formatSavedAt(recovery.savedAt)}</div>
                <div className={styles.path} title={recovery.filePath}>
                  {recovery.filePath ?? 'This Story had not been saved to a file.'}
                </div>
                {recovery.diskStatus === 'changed' && (
                  <p className={styles.note}>
                    Recover opens the recovery copy as unsaved changes. Undo returns the graph to
                    the current disk version.
                  </p>
                )}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => recoverStory(recovery.storyId)}
                >
                  Recover
                </button>
                <button type="button" onClick={() => void saveRecoveryAs(recovery.storyId)}>
                  Save As…
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => discardRecovery(recovery.storyId)}
                >
                  Discard
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer className={styles.footer}>
          <span>
            {recoveries.length > 0
              ? 'Recovery copies remain available until resolved.'
              : 'The damaged recovery file was left untouched for manual inspection.'}
          </span>
          {recoveries.length === 0 && recoveryError ? (
            <button type="button" onClick={dismissRecoveryError}>
              Continue
            </button>
          ) : recoveries.length > 1 ? (
            <button type="button" className={styles.danger} onClick={discardAllRecoveries}>
              Discard All
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
