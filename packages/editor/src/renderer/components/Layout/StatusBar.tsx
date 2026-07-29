import styles from './StatusBar.module.css';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from '../Panels/CopyButton';

export function StatusBar() {
  const { hasActiveStory, workspace, document, nodes, edges, chapters, activeGraphId } =
    useStoryGraphStore();
  const projectConflictCount = workspace?.gitConflicts?.length ?? 0;
  const projectConflictText = `${projectConflictCount} project resource Git conflict${projectConflictCount === 1 ? '' : 's'} · Open View → Story Merge`;
  if (!hasActiveStory) {
    return (
      <div className={styles.bar}>
        <div className={styles.left}>
          <span className={`${styles.item} ${projectConflictCount > 0 ? styles.errorItem : ''}`}>
            {projectConflictCount > 0 ? projectConflictText : 'Ready'}
          </span>
          <span className={styles.item}>
            {workspace?.project?.displayName ?? workspace?.name ?? 'No project open'}
          </span>
          <span className={styles.item}>No Story Open</span>
        </div>
        <div className={styles.right}>
          <span className={styles.item}>Story Blueprint v0.1.0</span>
        </div>
      </div>
    );
  }
  const fileName = document.filePath?.split(/[\\/]/).pop() ?? 'Untitled';
  const graphName =
    activeGraphId === 'root'
      ? 'Main Story'
      : (chapters.find((chapter) => chapter.id === activeGraphId)?.displayName ?? 'Substory');
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {document.gitConflict ? (
          <span className={`${styles.item} ${styles.errorItem}`}>
            Git conflict · Open View → Story Merge
          </span>
        ) : projectConflictCount > 0 ? (
          <span className={`${styles.item} ${styles.errorItem}`}>{projectConflictText}</span>
        ) : document.error ? (
          <span className={`${styles.item} ${styles.errorItem}`}>
            Error: {document.error}
            <CopyButton text={document.error} label="Copy" />
          </span>
        ) : (
          <span className={styles.item}>Ready</span>
        )}
        <span className={styles.item}>{`${fileName}${document.dirty ? ' *' : ''}`}</span>
        <span className={styles.item}>{graphName}</span>
      </div>
      <div className={styles.right}>
        <span className={styles.item}>{`${nodes.length} nodes · ${edges.length} edges`}</span>
        <span className={styles.item}>Story Blueprint v0.1.0</span>
      </div>
    </div>
  );
}
