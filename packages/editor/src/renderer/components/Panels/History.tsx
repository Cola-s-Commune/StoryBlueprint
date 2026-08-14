import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './History.module.css';

export function History() {
  const { undoEntries, redoEntries, travelHistory } = useStoryGraphStore();
  const isEmpty = undoEntries.length === 0 && redoEntries.length === 0;

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <strong>Operation History</strong>
        <span>{undoEntries.length + redoEntries.length} operations</span>
      </header>
      <div className={styles.list}>
        {isEmpty && (
          <div className={styles.empty}>
            Editing operations will appear here. Saved files do not clear this history.
          </div>
        )}
        {[...undoEntries].reverse().map((entry) => (
          <button
            type="button"
            className={styles.entry}
            data-kind="undo"
            key={`undo-${entry.steps}`}
            onClick={() => travelHistory(entry.steps)}
            title={`Return to before ${entry.label}`}
          >
            <span className={styles.marker} />
            <span className={styles.entryText}>
              <strong>{entry.label}</strong>
              <small>Return to before this operation</small>
            </span>
          </button>
        ))}
        {!isEmpty && (
          <div className={styles.current}>
            <span className={styles.currentMarker} />
            <span>
              <strong>Current state</strong>
              <small>Your project is here</small>
            </span>
          </div>
        )}
        {redoEntries.map((entry) => (
          <button
            type="button"
            className={styles.entry}
            data-kind="redo"
            key={`redo-${entry.steps}`}
            onClick={() => travelHistory(entry.steps)}
            title={`Reapply through ${entry.label}`}
          >
            <span className={styles.marker} />
            <span className={styles.entryText}>
              <strong>{entry.label}</strong>
              <small>Reapply through this operation</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
