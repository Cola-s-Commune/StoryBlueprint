import { useEffect, useState } from 'react';
import styles from './CopyButton.module.css';

async function copyToClipboard(text: string): Promise<void> {
  if (window.electronAPI?.copyText) {
    try {
      await window.electronAPI.copyText(text);
      return;
    } catch {
      // A renderer hot reload can temporarily retain an older preload implementation.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (copied) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('Clipboard is unavailable');
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = window.setTimeout(() => setStatus('idle'), 1_200);
    return () => window.clearTimeout(timer);
  }, [status]);

  return (
    <button
      type="button"
      className={styles.button}
      disabled={!text}
      title="Copy to clipboard"
      onClick={(event) => {
        event.stopPropagation();
        void copyToClipboard(text)
          .then(() => setStatus('copied'))
          .catch(() => setStatus('failed'));
      }}
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
