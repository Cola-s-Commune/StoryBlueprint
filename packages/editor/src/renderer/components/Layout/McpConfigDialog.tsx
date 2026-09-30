import { useEffect, useState } from 'react';
import type { McpServerConfigInfo } from '../../../shared/electronApi';
import styles from './McpConfigDialog.module.css';

interface McpConfigDialogProps {
  onClose: () => void;
}

const DEFAULT_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      'story-blueprint': {
        command: 'node',
        args: ['D:/Projects/StoryBlueprint/packages/mcp-server/dist/cli.js'],
      },
    },
  },
  null,
  2,
);

export function McpConfigDialog({ onClose }: McpConfigDialogProps) {
  const [copied, setCopied] = useState(false);
  const [configJson, setConfigJson] = useState<string>(DEFAULT_MCP_CONFIG);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    void window.electronAPI?.getMcpConfig?.().then((info: McpServerConfigInfo | undefined) => {
      if (info?.configJson) {
        setConfigJson(info.configJson);
      }
    });
  }, []);

  const handleCopy = async () => {
    try {
      if (window.electronAPI?.copyText) {
        await window.electronAPI.copyText(configJson);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(configJson);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-config-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <h2 id="mcp-config-title">🔌 MCP Server</h2>
            <span>Agent 接入配置</span>
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <p className={styles.description}>
          将下方 JSON 配置复制到您的 Agent Harness（如 Claude Desktop、Cursor、Codex、Windsurf 等）的 MCP 配置文件中即可完成接入，无需手动指定安装路径。
        </p>

        <div className={styles.codeBox}>
          <div className={styles.codeBoxHeader}>
            <span>mcpServers JSON (stdio 传输)</span>
            <button
              type="button"
              className={`${styles.copyButton} ${copied ? styles.copyButtonSuccess : ''}`}
              onClick={handleCopy}
            >
              {copied ? '✅ 已复制到剪贴板！' : '📋 复制配置 JSON'}
            </button>
          </div>
          <pre className={styles.codeContent}>{configJson}</pre>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerHint}>
            💡 包含读取上下文、全文搜索、沙盒预演、原子写入、编译器校验、项目资源检索及 Ink 导出等 7 项核心能力。
          </div>
          <button type="button" className={styles.doneButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
