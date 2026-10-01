import { useEffect, useState } from 'react';
import type {
  UpdateCheckResult,
  UpdateChannel,
  UpdateDownloadProgress,
  UpdateSettings,
} from '../../../shared/electronApi';
import styles from './UpdateDialog.module.css';

interface UpdateDialogProps {
  currentVersion?: string;
  initialResult?: UpdateCheckResult;
  onClose: () => void;
}

const defaultSettings: UpdateSettings = {
  enabled: true,
  feedUrl: 'https://storyblueprint.biaozi.biz:8443/updates',
  channel: 'stable',
  autoCheck: true,
};

function resultMessage(result: UpdateCheckResult): string {
  if (result.status === 'disabled') return 'Update checks are disabled.';
  if (result.status === 'up-to-date') return `You are up to date (${result.currentVersion}).`;
  if (result.status === 'available') return `Version ${result.latestVersion} is available.`;
  return 'error' in result ? result.error : 'Update check failed.';
}

export function UpdateDialog({ currentVersion, initialResult, onClose }: UpdateDialogProps) {
  const [settings, setSettings] = useState<UpdateSettings>(defaultSettings);
  const [draft, setDraft] = useState<UpdateSettings>(defaultSettings);
  const [result, setResult] = useState<UpdateCheckResult | undefined>(initialResult);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [download, setDownload] = useState<UpdateDownloadProgress>();
  const [downloadedPath, setDownloadedPath] = useState<string>();
  const [downloadedKind, setDownloadedKind] = useState<'installer' | 'portable'>();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api
      .getUpdateSettings()
      .then((value) => {
        setSettings(value);
        setDraft(value);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => window.electronAPI?.onUpdateDownloadProgress(setDownload), []);

  const saveSettings = async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const next = await window.electronAPI.updateUpdateSettings(draft);
      setSettings(next);
      setDraft(next);
      setStatus('Update settings saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const checkForUpdates = async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const saved = await window.electronAPI.updateUpdateSettings(draft);
      setSettings(saved);
      setDraft(saved);
      const next = await window.electronAPI.checkForUpdates();
      setResult(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const downloadUpdate = async (kind: 'installer' | 'portable') => {
    if (!window.electronAPI || result?.status !== 'available') return;
    setBusy(true);
    setDownload({ received: 0, total: kind === 'installer' ? result.installerSize ?? 0 : result.portableSize ?? 0 });
    setDownloadedPath(undefined);
    setDownloadedKind(undefined);
    setStatus(undefined);
    try {
      const downloaded = await window.electronAPI.downloadUpdate(kind);
      setDownloadedPath(downloaded.path);
      setDownloadedKind(downloaded.kind);
      setStatus(`${kind === 'installer' ? 'Installer' : 'Portable update'} downloaded and verified.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message === 'This operation was aborted' ? 'Update download cancelled.' : message);
    } finally {
      setBusy(false);
      setDownload(undefined);
    }
  };

  const cancelDownload = async () => {
    await window.electronAPI?.cancelUpdateDownload();
  };

  const installDownloadedUpdate = async () => {
    if (!downloadedPath || downloadedKind !== 'installer' || !window.electronAPI) return;
    setBusy(true);
    setStatus(undefined);
    try {
      await window.electronAPI.installDownloadedUpdate(downloadedPath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h1 id="update-title">Updates</h1>
        <p className={styles.subtitle}>
          Configure a signed update feed. Downloads are verified before being saved; installation
          and replacement remain explicit user actions.
        </p>

        <label>
          <span>Feed URL</span>
          <input
            value={draft.feedUrl}
            onChange={(event) => setDraft((value) => ({ ...value, feedUrl: event.target.value }))}
            placeholder="https://storyblueprint.biaozi.biz:8443/updates"
            spellCheck={false}
            inputMode="url"
          />
        </label>
        <div className={styles.row}>
          <label>
            <span>Channel</span>
            <select
              value={draft.channel}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  channel: event.target.value as UpdateChannel,
                }))
              }
            >
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </select>
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((value) => ({ ...value, enabled: event.target.checked }))
              }
            />
            <span>Enable checks</span>
          </label>
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={draft.autoCheck}
            onChange={(event) =>
              setDraft((value) => ({ ...value, autoCheck: event.target.checked }))
            }
          />
          <span>Check when the app starts (notification only)</span>
        </label>

        <div className={styles.actions}>
          <button type="button" onClick={() => void saveSettings()} disabled={busy}>
            Save Settings
          </button>
          <button type="button" onClick={() => void checkForUpdates()} disabled={busy}>
            Check Now
          </button>
        </div>

        <div className={styles.result} aria-live="polite">
          <strong>
            {result ? resultMessage(result) : `Current version: ${currentVersion ?? 'unknown'}`}
          </strong>
          {result?.status === 'available' && (
            <>
              {result.releaseDate && <span>Released {result.releaseDate}</span>}
              {result.notes && <p>{result.notes}</p>}
              <div className={styles.links}>
                {result.installerUrl && result.installerSha512 && result.installerSize && (
                  <button
                    type="button"
                    onClick={() => void downloadUpdate('installer')}
                    disabled={busy}
                  >
                    Download Installer
                  </button>
                )}
                {result.portableUrl && result.portableSha512 && result.portableSize && (
                  <button
                    type="button"
                    onClick={() => void downloadUpdate('portable')}
                    disabled={busy}
                  >
                    Download Portable
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {download && (
          <div className={styles.download} aria-live="polite">
            <div>
              <span>Downloading and verifying</span>
              <strong>{Math.min(100, Math.round((download.received / Math.max(1, download.total)) * 100))}%</strong>
            </div>
            <progress value={download.received} max={download.total} />
            <button type="button" onClick={() => void cancelDownload()}>Cancel</button>
          </div>
        )}
        {status && <p className={styles.status}>{status}</p>}
        {downloadedPath && (
          <div className={styles.downloadActions}>
            <button
              type="button"
              className={styles.reveal}
              onClick={() => void window.electronAPI?.revealDownloadedUpdate(downloadedPath)}
            >
              Show Downloaded File
            </button>
            {downloadedKind === 'installer' && (
              <button type="button" className={styles.install} onClick={() => void installDownloadedUpdate()}>
                Install and Restart
              </button>
            )}
          </div>
        )}
        <p className={styles.hint}>
          HTTPS is required for remote feeds. HTTP is allowed for localhost testing.
        </p>
        <p className={styles.saved}>Saved feed: {settings.feedUrl || 'Not configured'}</p>
      </section>
    </div>
  );
}
