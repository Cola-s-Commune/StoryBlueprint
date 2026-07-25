import styles from './Panel.module.css';
import { PanelHeader } from './PanelHeader';

interface ConsolePanelProps {
  floating?: boolean;
  onToggleFloating?: () => void;
}

export function ConsolePanel({ floating, onToggleFloating }: ConsolePanelProps) {
  return (
    <div className={styles.panel}>
      <PanelHeader title="Console" floating={floating} onToggleFloating={onToggleFloating} />
      <div className={styles.body}>
        <p className={styles.placeholder}>控制台 — 待开发</p>
      </div>
    </div>
  );
}
