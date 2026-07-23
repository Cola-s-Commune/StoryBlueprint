import styles from './Panel.module.css';

export function Inspector() {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>Inspector</div>
      <div className={styles.body}>
        <p className={styles.placeholder}>属性面板 — 待开发</p>
      </div>
    </div>
  );
}
