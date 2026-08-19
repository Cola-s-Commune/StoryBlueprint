import { useState, useRef, useEffect } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import type { AppInfo, UpdateCheckResult } from '../../../shared/electronApi';
import { AboutDialog } from './AboutDialog';
import { UpdateDialog } from './UpdateDialog';
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
      action?:
        | 'new'
        | 'open'
        | 'open-folder'
        | 'new-project'
        | 'open-project'
        | 'save-project'
        | 'save'
        | 'save-all'
        | 'save-as'
        | 'build-project'
        | 'import-ink'
        | 'exit'
        | 'copy-text'
        | 'undo'
        | 'redo'
        | 'zoom-in'
        | 'zoom-out'
        | 'zoom-reset'
        | 'reset-layout'
        | 'updates'
        | 'about';
      panelId?:
        | 'resources'
        | 'storyData'
        | 'graph'
        | 'inspector'
        | 'preview'
        | 'problems'
        | 'aiCommands'
        | 'storyMerge'
        | 'history'
        | 'localization';
    }
  | { type: 'separator' };

const menuItems: MenuItem[] = [
  {
    label: 'File',
    submenu: [
      { type: 'item', label: 'New Project...', action: 'new-project' },
      { type: 'item', label: 'Open Project...', action: 'open-project' },
      { type: 'separator' },
      { type: 'item', label: 'New Story', shortcut: 'Ctrl+N', action: 'new' },
      { type: 'item', label: 'Open Story...', shortcut: 'Ctrl+O', action: 'open' },
      { type: 'item', label: 'Open Folder...', action: 'open-folder' },
      { type: 'separator' },
      { type: 'item', label: 'Save', shortcut: 'Ctrl+S', action: 'save' },
      { type: 'item', label: 'Save All', shortcut: 'Ctrl+Alt+S', action: 'save-all' },
      { type: 'item', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: 'save-as' },
      { type: 'item', label: 'Save Project', action: 'save-project' },
      { type: 'separator' },
      {
        type: 'item',
        label: 'Build Project...',
        shortcut: 'Ctrl+Shift+B',
        action: 'build-project',
      },
      { type: 'item', label: 'Import Ink as Nodes...', action: 'import-ink' },
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
      { type: 'item', label: 'Copy', shortcut: 'Ctrl+C', action: 'copy-text' },
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
      { type: 'item', label: 'AI Commands', panelId: 'aiCommands' },
      { type: 'item', label: 'Story Merge', panelId: 'storyMerge' },
      { type: 'item', label: 'Runtime Preview', panelId: 'preview' },
      { type: 'item', label: 'Problems', panelId: 'problems' },
      { type: 'item', label: 'History', panelId: 'history' },
      { type: 'item', label: 'Localization', panelId: 'localization' },
      { type: 'separator' },
      { type: 'item', label: 'Reset Layout', action: 'reset-layout' },
      { type: 'separator' },
      { type: 'item', label: 'Zoom In', shortcut: 'Ctrl++', action: 'zoom-in' },
      { type: 'item', label: 'Zoom Out', shortcut: 'Ctrl+-', action: 'zoom-out' },
      { type: 'item', label: 'Reset Zoom', shortcut: 'Ctrl+0', action: 'zoom-reset' },
    ],
  },
  {
    label: 'Help',
    submenu: [
      { type: 'item', label: 'Check for Updates...', action: 'updates' },
      { type: 'separator' },
      { type: 'item', label: 'About Story Blueprint', action: 'about' },
    ],
  },
];

interface MenuBarProps {
  onResetLayout: () => void;
  onShowPanel: (
    panelId:
      | 'resources'
      | 'storyData'
      | 'graph'
      | 'inspector'
      | 'preview'
      | 'problems'
      | 'aiCommands'
      | 'storyMerge'
      | 'history'
      | 'localization',
  ) => void;
}

export function MenuBar({ onResetLayout, onShowPanel }: MenuBarProps) {
  const {
    hasActiveStory,
    workspace,
    newStory,
    openStory,
    openWorkspace,
    newProject,
    openProject,
    syncWorkspaceProject,
    saveStory,
    saveAllStories,
    buildProject,
    importInkFile,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
  } = useStoryGraphStore();
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [automaticUpdateResult, setAutomaticUpdateResult] = useState<UpdateCheckResult>();
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
    const api = window.electronAPI;
    if (!api) return;
    void api
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => undefined);
    void api
      .getUpdateSettings()
      .then((settings) => {
        if (!settings.enabled || !settings.autoCheck || !settings.feedUrl) return;
        return api.checkForUpdates();
      })
      .then((result) => {
        if (result?.status === 'available') {
          setAutomaticUpdateResult(result);
          setUpdatesOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.getWindowState().then((state) => setMaximized(state.maximized));
    return api.onWindowStateChanged((state) => setMaximized(state.maximized));
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
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault();
        void buildProject();
      } else if (key === 's') {
        event.preventDefault();
        if (event.altKey) void saveAllStories();
        else if (hasActiveStory) void saveStory(event.shiftKey);
        else if (workspace?.project) void syncWorkspaceProject();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hasActiveStory,
    buildProject,
    newStory,
    openStory,
    saveAllStories,
    saveStory,
    syncWorkspaceProject,
    workspace?.project,
  ]);

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
      case 'open-folder':
        void openWorkspace();
        break;
      case 'new-project':
        void newProject();
        break;
      case 'open-project':
        void openProject();
        break;
      case 'save-project':
        void syncWorkspaceProject();
        break;
      case 'save':
        void saveStory();
        break;
      case 'save-all':
        void saveAllStories();
        break;
      case 'save-as':
        void saveStory(true);
        break;
      case 'build-project':
        onShowPanel('problems');
        void buildProject();
        break;
      case 'import-ink':
        void importInkFile();
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'zoom-in':
        void window.electronAPI?.setWindowZoom('in');
        break;
      case 'zoom-out':
        void window.electronAPI?.setWindowZoom('out');
        break;
      case 'zoom-reset':
        void window.electronAPI?.setWindowZoom('reset');
        break;
      case 'exit':
        void window.electronAPI?.closeWindow();
        break;
      case 'copy-text':
        document.execCommand('copy');
        break;
      case 'reset-layout':
        onResetLayout();
        break;
      case 'about':
        setAboutOpen(true);
        void window.electronAPI?.getAppInfo().then(setAppInfo);
        break;
      case 'updates':
        setAutomaticUpdateResult(undefined);
        setUpdatesOpen(true);
        void window.electronAPI?.getAppInfo().then(setAppInfo);
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
                    className={`${styles.subItem} ${sub.disabled || (sub.action === 'undo' && !canUndo) || (sub.action === 'redo' && !canRedo) || (!sub.action && !sub.panelId) ? styles.disabled : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setOpenMenu(null);
                      const historyDisabled =
                        (sub.action === 'undo' && !canUndo) || (sub.action === 'redo' && !canRedo);
                      if (!sub.disabled && !historyDisabled && sub.action) runAction(sub.action);
                      if (!sub.disabled && sub.panelId) onShowPanel(sub.panelId);
                    }}
                  >
                    <span>
                      {sub.action === 'undo' && undoLabel
                        ? `Undo ${undoLabel}`
                        : sub.action === 'redo' && redoLabel
                          ? `Redo ${redoLabel}`
                          : sub.label}
                    </span>
                    {sub.shortcut && <span className={styles.shortcut}>{sub.shortcut}</span>}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div
        className={styles.dragSpace}
        onDoubleClick={() =>
          void window.electronAPI
            ?.toggleMaximizeWindow()
            .then((state) => setMaximized(state.maximized))
        }
      />
      <div className={styles.windowControls}>
        <button
          type="button"
          className={styles.windowButton}
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => void window.electronAPI?.minimizeWindow()}
        >
          <span className={styles.minimizeIcon} />
        </button>
        <button
          type="button"
          className={styles.windowButton}
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() =>
            void window.electronAPI
              ?.toggleMaximizeWindow()
              .then((state) => setMaximized(state.maximized))
          }
        >
          <span className={maximized ? styles.restoreIcon : styles.maximizeIcon} />
        </button>
        <button
          type="button"
          className={`${styles.windowButton} ${styles.closeButton}`}
          aria-label="Close window"
          title="Close"
          onClick={() => void window.electronAPI?.closeWindow()}
        >
          <span className={styles.closeIcon} />
        </button>
      </div>
      {aboutOpen && (
        <AboutDialog
          appInfo={appInfo}
          projectPath={workspace?.rootPath}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {updatesOpen && (
        <UpdateDialog
          currentVersion={appInfo?.version}
          initialResult={automaticUpdateResult}
          onClose={() => setUpdatesOpen(false)}
        />
      )}
    </div>
  );
}
