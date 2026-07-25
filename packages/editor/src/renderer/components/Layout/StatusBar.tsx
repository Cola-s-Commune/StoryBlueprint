import styles from './StatusBar.module.css';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';

export function StatusBar() {
  const { document, nodes, edges, chapters, activeGraphId } = useStoryGraphStore();
  const fileName = document.filePath?.split(/[\\/]/).pop() ?? 'Untitled';
  const graphName =
    activeGraphId === 'root'
      ? 'Main Story'
      : (chapters.find((chapter) => chapter.id === activeGraphId)?.displayName ?? 'Substory');
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.item}>{document.error ? `Error: ${document.error}` : 'Ready'}</span>
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
