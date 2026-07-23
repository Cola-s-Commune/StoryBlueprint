import styles from './StatusBar.module.css';

export function StatusBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.item}>Ready</span>
      </div>
      <div className={styles.right}>
        <span className={styles.item}>Story Blueprint v0.1.0</span>
      </div>
    </div>
  );
}
