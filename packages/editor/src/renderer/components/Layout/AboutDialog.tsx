import { useEffect } from 'react';
import type { AppInfo } from '../../../shared/electronApi';
import appIcon from '../../assets/story-blueprint-icon.png';
import styles from './AboutDialog.module.css';

interface AboutDialogProps {
  appInfo?: AppInfo;
  projectPath?: string;
  onClose: () => void;
}

export function AboutDialog({ appInfo, projectPath, onClose }: AboutDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
        <img className={styles.icon} src={appIcon} alt="" />
        <h1 id="about-title">Story Blueprint</h1>
        <p className={styles.tagline}>Blueprint-style visual narrative editor</p>

        <dl className={styles.details}>
          <div>
            <dt>Version</dt>
            <dd>{appInfo?.version ?? 'Loading…'}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>
              {appInfo
                ? `Electron ${appInfo.electron} · Chromium ${appInfo.chrome} · Node ${appInfo.node}`
                : 'Loading…'}
            </dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{appInfo ? `${appInfo.platform} ${appInfo.arch}` : 'Loading…'}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd className={styles.path} title={projectPath}>
              {projectPath ?? 'No project open'}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          className={styles.logs}
          onClick={() => void window.electronAPI?.revealLogs()}
        >
          Open Logs Folder
        </button>

        <p className={styles.copyright}>© 2026 Story Blueprint Contributors</p>
      </section>
    </div>
  );
}
