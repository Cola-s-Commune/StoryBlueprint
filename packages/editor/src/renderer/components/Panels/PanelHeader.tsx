import { useRef, type PointerEvent, type ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelFloatPosition {
  x: number;
  y: number;
}

interface PanelHeaderProps {
  title: ReactNode;
  floating?: boolean;
  onToggleFloating?: (position?: PanelFloatPosition) => void;
}

export function PanelHeader({ title, floating, onToggleFloating }: PanelHeaderProps) {
  const dragStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (floating || !onToggleFloating || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;

    dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId || !onToggleFloating) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10) return;

    dragStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onToggleFloating({ x: event.screenX - 32, y: event.screenY - 14 });
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={`${styles.header} ${!floating && onToggleFloating ? styles.draggableHeader : ''}`}
      title={!floating && onToggleFloating ? 'Drag to float panel' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <span>{title}</span>
      {onToggleFloating && (
        <button
          type="button"
          className={styles.floatButton}
          title={floating ? 'Dock panel' : 'Float panel'}
          aria-label={floating ? 'Dock panel' : 'Float panel'}
          onClick={() => onToggleFloating()}
        >
          {floating ? '↙' : '↗'}
        </button>
      )}
    </div>
  );
}
