import styles from './StatusBar.module.css';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';

export function StatusBar() {
  const { document, nodes, edges } = useStoryGraphStore();
  const fileName = document.filePath?.split(/[\\/]/).pop() ?? 'Untitled';
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.item}>{document.error ? `Error: ${document.error}` : 'Ready'}</span>
        <span className={styles.item}>{`${fileName}${document.dirty ? ' *' : ''}`}</span>
      </div>
      <div className={styles.right}>
        <span className={styles.item}>{`${nodes.length} nodes · ${edges.length} edges`}</span>
        <span className={styles.item}>Story Blueprint v0.1.0</span>
      </div>
    </div>
  );
}
