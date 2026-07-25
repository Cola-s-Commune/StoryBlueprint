import { useState, useRef, useEffect } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './MenuBar.module.css';

type MenuItem = {
  label: string;
  submenu: SubMenuItem[];
};

type SubMenuItem =
  | {
      type: 'item';
      label: string;
      shortcut?: string;
      disabled?: boolean;
      action?: 'new' | 'open' | 'save' | 'save-as' | 'exit' | 'undo' | 'redo' | 'reset-layout';
      panelId?: 'resources' | 'storyData' | 'graph' | 'inspector' | 'console';
    }
  | { type: 'separator' };

const menuItems: MenuItem[] = [
  {
    label: 'File',
    submenu: [
      { type: 'item', label: 'New Story', shortcut: 'Ctrl+N', action: 'new' },
      { type: 'item', label: 'Open Story...', shortcut: 'Ctrl+O', action: 'open' },
      { type: 'separator' },
      { type: 'item', label: 'Save', shortcut: 'Ctrl+S', action: 'save' },
      { type: 'item', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: 'save-as' },
      { type: 'separator' },
      { type: 'item', label: 'Exit', shortcut: 'Alt+F4', action: 'exit' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z', action: 'undo' },
      { type: 'item', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'redo' },
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
      { type: 'item', label: 'Resource Browser', panelId: 'resources' },
      { type: 'item', label: 'Story Data', panelId: 'storyData' },
      { type: 'item', label: 'Story Graph', panelId: 'graph' },
      { type: 'item', label: 'Inspector', panelId: 'inspector' },
      { type: 'item', label: 'Console', panelId: 'console' },
      { type: 'separator' },
      { type: 'item', label: 'Reset Layout', action: 'reset-layout' },
      { type: 'separator' },
      { type: 'item', label: 'Zoom In', shortcut: 'Ctrl+=' },
      { type: 'item', label: 'Zoom Out', shortcut: 'Ctrl+-' },
      { type: 'item', label: 'Reset Zoom', shortcut: 'Ctrl+0' },
    ],
  },
  {
    label: 'Help',
    submenu: [{ type: 'item', label: 'About Story Blueprint' }],
  },
];

interface MenuBarProps {
  onResetLayout: () => void;
  onShowPanel: (panelId: 'resources' | 'storyData' | 'graph' | 'inspector' | 'console') => void;
}

export function MenuBar({ onResetLayout, onShowPanel }: MenuBarProps) {
  const { newStory, openStory, saveStory, undo, redo } = useStoryGraphStore();
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        newStory();
      } else if (key === 'o') {
        event.preventDefault();
        void openStory();
      } else if (key === 's') {
        event.preventDefault();
        void saveStory(event.shiftKey);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newStory, openStory, saveStory]);

  const runAction = (
    action: Exclude<Extract<SubMenuItem, { type: 'item' }>['action'], undefined>,
  ) => {
    switch (action) {
      case 'new':
        newStory();
        break;
      case 'open':
        void openStory();
        break;
      case 'save':
        void saveStory();
        break;
      case 'save-as':
        void saveStory(true);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'exit':
        window.close();
        break;
      case 'reset-layout':
        onResetLayout();
        break;
    }
  };

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
                    className={`${styles.subItem} ${sub.disabled || (!sub.action && !sub.panelId) ? styles.disabled : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setOpenMenu(null);
                      if (!sub.disabled && sub.action) runAction(sub.action);
                      if (!sub.disabled && sub.panelId) onShowPanel(sub.panelId);
                    }}
                  >
                    <span>{sub.label}</span>
                    {sub.shortcut && <span className={styles.shortcut}>{sub.shortcut}</span>}
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
