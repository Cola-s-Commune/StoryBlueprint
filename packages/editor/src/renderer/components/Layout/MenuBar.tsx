import { useState, useRef, useEffect } from 'react';
import styles from './MenuBar.module.css';

type MenuItem = {
  label: string;
  submenu: SubMenuItem[];
};

type SubMenuItem =
  | { type: 'item'; label: string; shortcut?: string; disabled?: boolean }
  | { type: 'separator' };

const menuItems: MenuItem[] = [
  {
    label: 'File',
    submenu: [
      { type: 'item', label: 'New Story', shortcut: 'Ctrl+N' },
      { type: 'item', label: 'Open Story...', shortcut: 'Ctrl+O' },
      { type: 'separator' },
      { type: 'item', label: 'Save', shortcut: 'Ctrl+S' },
      { type: 'item', label: 'Save As...', shortcut: 'Ctrl+Shift+S' },
      { type: 'separator' },
      { type: 'item', label: 'Exit', shortcut: 'Alt+F4' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z' },
      { type: 'item', label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
      { type: 'separator' },
      { type: 'item', label: 'Cut', shortcut: 'Ctrl+X' },
      { type: 'item', label: 'Copy', shortcut: 'Ctrl+C' },
      { type: 'item', label: 'Paste', shortcut: 'Ctrl+V' },
      { type: 'item', label: 'Delete' },
      { type: 'separator' },
      { type: 'item', label: 'Select All', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { type: 'item', label: 'Reset Layout' },
      { type: 'separator' },
      { type: 'item', label: 'Zoom In', shortcut: 'Ctrl+=' },
      { type: 'item', label: 'Zoom Out', shortcut: 'Ctrl+-' },
      { type: 'item', label: 'Reset Zoom', shortcut: 'Ctrl+0' },
    ],
  },
  {
    label: 'Help',
    submenu: [
      { type: 'item', label: 'About Story Blueprint' },
    ],
  },
];

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className={styles.bar} ref={menuRef}>
      {menuItems.map((item, i) => (
        <div
          key={item.label}
          className={`${styles.menuItem} ${openMenu === i ? styles.active : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpenMenu(openMenu === i ? null : i);
          }}
          onMouseEnter={() => {
            if (openMenu !== null) setOpenMenu(i);
          }}
        >
          {item.label}
          {openMenu === i && (
            <div className={styles.dropdown}>
              {item.submenu.map((sub, j) =>
                sub.type === 'separator' ? (
                  <div key={j} className={styles.separator} />
                ) : (
                  <div
                    key={j}
                    className={`${styles.subItem} ${sub.disabled ? styles.disabled : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setOpenMenu(null);
                    }}
                  >
                    <span>{sub.label}</span>
                    {sub.shortcut && (
                      <span className={styles.shortcut}>{sub.shortcut}</span>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
