import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './ExternalChangesCenter.module.css';

const kindLabels = {
  story: 'Story',
  project: 'Project',
  character: 'Character',
  'character-template': 'Character Template',
  asset: 'Asset',
  localization: 'Localization',
  ink: 'Ink',
} as const;

const changeLabels = {
  created: 'created externally',
  modified: 'changed externally',
  deleted: 'deleted externally',
} as const;

interface ExternalChangesCenterProps {
  onShowStoryMerge: () => void;
}

export function ExternalChangesCenter({ onShowStoryMerge }: ExternalChangesCenterProps) {
  const {
    externalFileChanges,
    keepExternalEditorVersion,
    reloadExternalFile,
    saveExternalStoryAs,
    mergeExternalStory,
  } = useStoryGraphStore();

  if (externalFileChanges.length === 0) return null;

  return (
    <aside className={styles.center} aria-label="External file changes">
      <header>
        <div>
          <strong>Files changed outside Story Blueprint</strong>
          <span>Review changes that overlap unsaved editor state.</span>
        </div>
        <span className={styles.count}>{externalFileChanges.length}</span>
      </header>
      <div className={styles.list}>
        {externalFileChanges.map((change) => {
          const canMerge =
            change.kind === 'story' &&
            change.change === 'modified' &&
            Boolean(change.previousContent && change.content);
          return (
            <article key={change.relativePath}>
              <div className={styles.description}>
                <div>
                  <span className={styles.kind}>{kindLabels[change.kind]}</span>
                  <strong>{change.relativePath}</strong>
                </div>
                <small>{changeLabels[change.change]}</small>
              </div>
              <div className={styles.actions}>
                {canMerge && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => {
                      mergeExternalStory(change.relativePath);
                      onShowStoryMerge();
                    }}
                  >
                    Open Merge
                  </button>
                )}
                {change.kind === 'story' && (
                  <button
                    type="button"
                    onClick={() => void saveExternalStoryAs(change.relativePath)}
                  >
                    Save Editor As…
                  </button>
                )}
                <button type="button" onClick={() => void reloadExternalFile(change.relativePath)}>
                  {change.change === 'deleted' ? 'Accept Delete' : 'Load Disk'}
                </button>
                <button
                  type="button"
                  onClick={() => keepExternalEditorVersion(change.relativePath)}
                >
                  Keep Editor
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
