import { useMemo, useState } from 'react';
import { parseStorySource, type StorySourceDocument } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import {
  applyMergedStory,
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
  type MergeableStoryDocument,
  type StoryMergeChoice,
  type StoryMergeDecisions,
} from '../../graph/storyMerge';
import { CopyButton } from './CopyButton';
import panelStyles from './Panel.module.css';
import styles from './StoryMerge.module.css';

function valueText(value: unknown, present: boolean): string {
  if (!present) return '(not present)';
  if (typeof value === 'string') return value || '(empty string)';
  if (value === undefined) return '(undefined)';
  return JSON.stringify(value, null, 2);
}

export function StoryMerge() {
  const { hasActiveStory, source, semanticSnapshot, applyStoryMerge } = useStoryGraphStore();
  const [localBase, setLocalBase] = useState<MergeableStoryDocument>();
  const [remote, setRemote] = useState<StorySourceDocument>();
  const [remotePath, setRemotePath] = useState('');
  const [baseRevision, setBaseRevision] = useState('');
  const [decisions, setDecisions] = useState<Record<string, StoryMergeChoice>>({});
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const remoteMergeable = useMemo(() => (remote ? mergeableStory(remote) : undefined), [remote]);
  const conflicts = useMemo(
    () => (localBase && remoteMergeable ? diffStoryDocuments(localBase, remoteMergeable) : []),
    [localBase, remoteMergeable],
  );
  const mergedProjection = useMemo(
    () =>
      localBase && remoteMergeable
        ? mergeStoryDocuments(localBase, remoteMergeable, decisions as StoryMergeDecisions)
        : undefined,
    [decisions, localBase, remoteMergeable],
  );
  const remoteChoiceCount = conflicts.filter(
    (conflict) => decisions[conflict.id] === 'remote',
  ).length;
  const stale = Boolean(baseRevision && baseRevision !== semanticSnapshot.revision);
  const hasMergedChanges = Boolean(
    localBase && mergedProjection && JSON.stringify(localBase) !== JSON.stringify(mergedProjection),
  );

  const choose = (id: string, choice: StoryMergeChoice) => {
    setDecisions((current) => ({ ...current, [id]: choice }));
    setError(undefined);
    setStatus(undefined);
  };

  const chooseAll = (choice: StoryMergeChoice) => {
    setDecisions(Object.fromEntries(conflicts.map((conflict) => [conflict.id, choice])));
    setError(undefined);
    setStatus(undefined);
  };

  const compareStory = async () => {
    if (!window.electronAPI) return;
    setError(undefined);
    setStatus(undefined);
    try {
      const result = await window.electronAPI.openStory();
      if (result.canceled) return;
      const parsed = parseStorySource(result.content);
      if (parsed.id !== source.id) {
        setError(
          `Selected file is Story ${parsed.id}, but the active Story is ${source.id}. Compare matching Story IDs only.`,
        );
        return;
      }
      setLocalBase(mergeableStory(source));
      setRemote(parsed);
      setRemotePath(result.filePath);
      setBaseRevision(semanticSnapshot.revision);
      setDecisions({});
      setStatus(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const apply = () => {
    if (!mergedProjection || !localBase || stale) return;
    const result = applyStoryMerge(applyMergedStory(source, mergedProjection));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLocalBase(undefined);
    setRemote(undefined);
    setRemotePath('');
    setBaseRevision('');
    setDecisions({});
    setError(undefined);
    setStatus('Merge applied as one undoable Story edit. Save when ready.');
  };

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <header className={styles.header}>
          <div>
            <strong>Story Merge</strong>
            <span>Semantic two-way comparison · Local is kept unless Remote is selected</span>
          </div>
          <button type="button" onClick={() => void compareStory()} disabled={!hasActiveStory}>
            Compare Story…
          </button>
        </header>

        {error && (
          <div className={styles.error}>
            <span>{error}</span>
            <CopyButton text={error} />
          </div>
        )}
        {status && <div className={styles.status}>{status}</div>}
        {stale && (
          <div className={styles.error}>
            <span>The local Story changed after comparison. Reopen the comparison file.</span>
          </div>
        )}

        {!remote || !localBase ? (
          <div className={styles.empty}>
            Choose another valid <code>.story</code> file to compare with the active Story. Shared
            project resources are intentionally excluded from this first merge phase.
          </div>
        ) : (
          <>
            <div className={styles.summary}>
              <div>
                <strong>{conflicts.length}</strong>
                <span>differences</span>
              </div>
              <div>
                <strong>{remoteChoiceCount}</strong>
                <span>using Remote</span>
              </div>
              <code title={remotePath}>{remotePath}</code>
              <button type="button" onClick={() => chooseAll('local')}>
                All Local
              </button>
              <button type="button" onClick={() => chooseAll('remote')}>
                All Remote
              </button>
              <button
                type="button"
                className={styles.applyButton}
                disabled={stale || !hasMergedChanges}
                onClick={apply}
              >
                Apply Merge
              </button>
            </div>
            {conflicts.length === 0 ? (
              <div className={styles.empty}>The two Story files are semantically identical.</div>
            ) : (
              <div className={styles.conflicts}>
                {conflicts.map((conflict) => {
                  const choice = decisions[conflict.id] ?? 'local';
                  const localText = valueText(conflict.localValue, conflict.kind !== 'remote-only');
                  const remoteText = valueText(
                    conflict.remoteValue,
                    conflict.kind !== 'local-only',
                  );
                  return (
                    <article className={styles.conflict} key={conflict.id}>
                      <header>
                        <span>{conflict.kind}</span>
                        <code>{conflict.path}</code>
                      </header>
                      <div className={styles.choices}>
                        <button
                          type="button"
                          className={choice === 'local' ? styles.selectedChoice : undefined}
                          onClick={() => choose(conflict.id, 'local')}
                        >
                          <strong>Local</strong>
                          <pre>{localText}</pre>
                        </button>
                        <button
                          type="button"
                          className={choice === 'remote' ? styles.selectedChoice : undefined}
                          onClick={() => choose(conflict.id, 'remote')}
                        >
                          <strong>Remote</strong>
                          <pre>{remoteText}</pre>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
