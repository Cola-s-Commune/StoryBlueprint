import { useEditorSettings } from '../../settings/EditorSettingsContext';
import styles from './AICommandsBetaPlaceholder.module.css';

export function AICommandsBetaPlaceholder() {
  const { openSettings } = useEditorSettings();

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.icon}>🧪</div>
        <h3 className={styles.title}>
          AI Commands <span className={styles.badge}>Beta</span>
        </h3>
        <p className={styles.description}>
          AI 剧情指令目前属于实验性探索功能，默认处于关闭状态。
          如需试用，请在偏好设置中开启该功能。
        </p>
        <button
          type="button"
          className={styles.openSettingsButton}
          onClick={openSettings}
        >
          ⚙️ 打开偏好设置 (Ctrl+,)
        </button>
      </div>
    </div>
  );
}
