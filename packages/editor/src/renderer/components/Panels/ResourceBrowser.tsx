import styles from './Panel.module.css';
import { PanelHeader, type PanelFloatPosition } from './PanelHeader';

interface ResourceBrowserProps {
  floating?: boolean;
  onToggleFloating?: (position?: PanelFloatPosition) => void;
}

export function ResourceBrowser({ floating, onToggleFloating }: ResourceBrowserProps) {
  return (
    <div className={styles.panel}>
      <PanelHeader
        title="Resource Browser"
        floating={floating}
        onToggleFloating={onToggleFloating}
      />
      <div className={styles.body}>
        <p className={styles.placeholder}>资源管理器 — 待开发</p>
      </div>
    </div>
  );
}
