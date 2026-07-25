import styles from './Panel.module.css';

export function ConsolePanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        <p className={styles.placeholder}>控制台 — 待开发</p>
      </div>
    </div>
  );
}
