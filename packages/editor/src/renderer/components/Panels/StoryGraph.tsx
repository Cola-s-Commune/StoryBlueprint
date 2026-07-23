import styles from './Panel.module.css';

export function StoryGraph() {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>Story Graph</div>
      <div className={styles.body}>
        <p className={styles.placeholder}>Blueprint 画布 — 待开发</p>
      </div>
    </div>
  );
}
