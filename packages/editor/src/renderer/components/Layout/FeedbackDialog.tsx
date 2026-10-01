import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/electronApi';
import styles from './FeedbackDialog.module.css';

export type FeedbackCategory = 'bug' | 'feature' | 'ai_diagnostic';

export interface FeedbackAIContext {
  model?: string;
  errorMessage?: string;
  errorStack?: string;
}

interface FeedbackDialogProps {
  initialCategory?: FeedbackCategory;
  aiContext?: FeedbackAIContext;
  onClose: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/Cola-s-Commune/StoryBlueprint';

export function FeedbackDialog({
  initialCategory = 'bug',
  aiContext,
  onClose,
}: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>(
    aiContext ? 'ai_diagnostic' : initialCategory,
  );
  const [title, setTitle] = useState(
    aiContext?.errorMessage ? `[AI Diagnostic] ${aiContext.errorMessage.slice(0, 60)}` : '',
  );
  const [description, setDescription] = useState('');
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    void window.electronAPI?.getAppInfo().then(setAppInfo).catch(() => undefined);
  }, []);

  const buildIssueMarkdown = () => {
    const lines: string[] = [];

    if (category === 'ai_diagnostic') {
      lines.push('### 🤖 AI Diagnostic Details');
      if (aiContext?.model) lines.push(`- **Model Profile**: ${aiContext.model}`);
      if (aiContext?.errorMessage) lines.push(`- **Error Message**: ${aiContext.errorMessage}`);
      if (aiContext?.errorStack) {
        lines.push('```');
        lines.push(aiContext.errorStack.slice(0, 2000));
        lines.push('```');
      }
      lines.push('');
    }

    lines.push('### Description');
    lines.push(description.trim() || '(No description provided)');
    lines.push('');

    lines.push('### Environment');
    lines.push(`- **App Version**: Story Blueprint v${appInfo?.version ?? 'unknown'}`);
    lines.push(`- **Platform**: ${navigator.userAgent}`);
    lines.push(`- **Timestamp**: ${new Date().toISOString()}`);

    return lines.join('\n');
  };

  const handleOpenGitHub = async () => {
    const markdownBody = buildIssueMarkdown();
    const issueTitle = title.trim() || (category === 'bug' ? '[Bug Report]' : category === 'feature' ? '[Feature Request]' : '[AI Diagnostic]');
    const labels =
      category === 'ai_diagnostic'
        ? 'ai-diagnostic,bug'
        : category === 'bug'
          ? 'bug,user-feedback'
          : 'enhancement,user-feedback';

    const url = `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent(issueTitle)}&labels=${encodeURIComponent(labels)}&body=${encodeURIComponent(markdownBody)}`;

    try {
      await window.electronAPI?.openExternal(url);
      onClose();
    } catch {
      // Fallback: Copy to clipboard if opening external fails
      await navigator.clipboard.writeText(markdownBody);
      setCopied(true);
    }
  };

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(buildIssueMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h1 id="feedback-title">Report Issue & Feedback</h1>
        <p className={styles.subtitle}>
          Feedback and AI diagnostics are submitted directly to GitHub Issues for tracking and community visibility.
        </p>

        <div className={styles.row}>
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            >
              <option value="bug">🐛 Bug Report</option>
              <option value="feature">💡 Feature Request</option>
              <option value="ai_diagnostic">🤖 AI / Compiler Diagnostic</option>
            </select>
          </label>
        </div>

        <label>
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brief summary of the issue or feedback"
            autoFocus
          />
        </label>

        <label>
          <span>Details & Steps to Reproduce</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain what happened, expected behavior, or your suggestion..."
          />
        </label>

        {aiContext && (
          <div className={styles.aiBox}>
            <strong>Captured AI Error:</strong>
            <pre>{aiContext.errorMessage || aiContext.errorStack || 'AI execution failed'}</pre>
          </div>
        )}

        <div className={styles.envBox}>
          <span>Environment: v{appInfo?.version ?? '...'} · Win32</span>
          <span>Target: Cola-s-Commune/StoryBlueprint</span>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => void handleCopyMarkdown()}>
            {copied ? '✓ Copied Markdown' : 'Copy Content'}
          </button>
          <button type="button" className={styles.submitBtn} onClick={() => void handleOpenGitHub()}>
            Submit to GitHub
          </button>
        </div>
      </section>
    </div>
  );
}
