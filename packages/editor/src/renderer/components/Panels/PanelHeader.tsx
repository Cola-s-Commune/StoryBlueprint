import type { ReactNode } from 'react';
import styles from './Panel.module.css';

interface PanelHeaderProps {
  title: ReactNode;
  floating?: boolean;
  onToggleFloating?: () => void;
}

export function PanelHeader({ title, floating, onToggleFloating }: PanelHeaderProps) {
  return (
    <div className={styles.header}>
      <span>{title}</span>
      {onToggleFloating && (
        <button
          type="button"
          className={styles.floatButton}
          title={floating ? 'Dock panel' : 'Float panel'}
          aria-label={floating ? 'Dock panel' : 'Float panel'}
          onClick={onToggleFloating}
        >
          {floating ? '↙' : '↗'}
        </button>
      )}
    </div>
  );
}
