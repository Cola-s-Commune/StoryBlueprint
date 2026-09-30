import { useEffect, useState } from 'react';
import { useEditorSettings } from '../../settings/EditorSettingsContext';
import styles from './SettingsDialog.module.css';

interface SettingsDialogProps {
  onClose: () => void;
  onResetLayout?: () => void;
}

export function SettingsDialog({ onClose, onResetLayout }: SettingsDialogProps) {
  const { settings, updateSettings } = useEditorSettings();
  const [activeTab, setActiveTab] = useState<'experimental' | 'general'>('experimental');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleAiCommands = () => {
    updateSettings((prev) => ({
      ...prev,
      experimental: {
        ...prev.experimental,
        aiCommands: !prev.experimental.aiCommands,
      },
    }));
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <h2 id="settings-title">Preferences</h2>
            <span>偏好设置</span>
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <nav className={styles.tabBar} aria-label="Settings categories">
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'experimental' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('experimental')}
          >
            🧪 实验性功能 (Experimental)
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'general' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('general')}
          >
            ⚙️ 常规 (General)
          </button>
        </nav>

        <div className={styles.content}>
          {activeTab === 'experimental' && (
            <>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>测试版与实验性功能</h3>
                <p className={styles.sectionDescription}>
                  以下功能仍在早期探索与试验阶段，可能存在不稳定性或逻辑校验缺陷。默认处于关闭状态。
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureCardHeader}>
                  <div className={styles.featureTitleGroup}>
                    <span className={styles.featureName}>AI 剧情指令 (AI Commands)</span>
                    <span className={styles.betaBadge}>Beta 测试版</span>
                  </div>
                  <label className={styles.switchLabel}>
                    <span
                      className={`${styles.switchStatus} ${
                        settings.experimental.aiCommands ? styles.switchStatusActive : ''
                      }`}
                    >
                      {settings.experimental.aiCommands ? '已开启' : '已关闭'}
                    </span>
                    <span className={styles.switch}>
                      <input
                        type="checkbox"
                        checked={settings.experimental.aiCommands}
                        onChange={toggleAiCommands}
                        aria-label="Toggle AI Commands Beta feature"
                      />
                      <span className={styles.slider} />
                    </span>
                  </label>
                </div>

                <p className={styles.featureDescription}>
                  基于大语言模型自动分析当前剧情大纲与节点上下文，辅助扩写对话分支、调整状态变量并执行蓝图直接修改或
                  Ink 转换。开启后将在工作台提供 AI 侧边栏面板及视图菜单入口。
                </p>

                <div className={styles.warningBox}>
                  <strong>⚠️ 测试版说明：</strong>
                  当前 8B / 14B
                  等本地及轻量模型的复杂结构理解能力仍在演进中，可能产生校验报错。关闭此功能可保持工作区界面的纯净与稳定。
                </div>
              </div>
            </>
          )}

          {activeTab === 'general' && (
            <div className={styles.actionList}>
              <div className={styles.actionItem}>
                <div className={styles.actionItemInfo}>
                  <span className={styles.actionItemTitle}>重置工作区布局 (Reset Layout)</span>
                  <span className={styles.actionItemDesc}>
                    恢复默认的面板排列结构（图编辑器、检查器、资源与剧情数据）。
                  </span>
                </div>
                {onResetLayout && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => {
                      onResetLayout();
                      onClose();
                    }}
                  >
                    重置布局
                  </button>
                )}
              </div>

              <div className={styles.actionItem}>
                <div className={styles.actionItemInfo}>
                  <span className={styles.actionItemTitle}>查看应用日志 (Application Logs)</span>
                  <span className={styles.actionItemDesc}>
                    在文件管理器中打开 Electron 与编辑器的运行日志文件夹。
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void window.electronAPI?.revealLogs()}
                >
                  打开日志目录
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.doneButton} onClick={onClose}>
            完成 (Done)
          </button>
        </div>
      </section>
    </div>
  );
}
