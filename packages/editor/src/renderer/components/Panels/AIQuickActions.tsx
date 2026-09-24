import { useMemo } from 'react';
import {
  StoryNodeType,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import { AI_SLASH_COMMANDS, type AISlashCommand } from './aiSlashCommands';
import styles from './AICommands.module.css';

export interface AIQuickActionsProps {
  semanticSnapshot: StorySemanticSnapshot;
  activeGraphId: string;
  selectedNodes: Array<{ id: string; type: StoryNodeType; data: unknown }>;
  disabled?: boolean;
  onSelectCommand?: (command: AISlashCommand) => void;
  onApplyPrompt?: (
    prompt: string,
    autoSend?: boolean,
    recommendedScope?: 'selection' | 'graph' | 'story',
  ) => void;
}

export function AIQuickActions({
  semanticSnapshot,
  activeGraphId: _activeGraphId,
  selectedNodes,
  disabled,
  onSelectCommand,
  onApplyPrompt,
}: AIQuickActionsProps) {
  const selectedDialogueCount = useMemo(
    () => selectedNodes.filter((node) => node.type === StoryNodeType.Dialogue).length,
    [selectedNodes],
  );

  const handleCommandClick = (cmdId: string) => {
    const cmd = AI_SLASH_COMMANDS.find((c) => c.id === cmdId);
    if (!cmd) return;

    if (onSelectCommand) {
      onSelectCommand(cmd);
      return;
    }

    if (onApplyPrompt) {
      const template = cmd.buildTemplate({
        selectedNodeId: selectedNodes[0]?.id,
        selectedNodeType: selectedNodes[0]?.type,
        hasAttachments: false,
      });
      onApplyPrompt(template, false, cmd.recommendedScope);
    }
  };

  return (
    <div className={styles.quickActionsContainer}>
      <div className={styles.quickActionsBar} role="toolbar" aria-label="AI Story Assistants">
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('script')}
          title="将附件剧本或输入文本转换为对白与旁白蓝图节点并自动连线 (/script)"
        >
          📖 剧本转蓝图
        </button>
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('branch')}
          title="为当前选中的剧情/对白节点设计多分支决策抉择与后续走向 (/branch)"
        >
          🔀 生成分支
        </button>
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('polish')}
          title={
            selectedDialogueCount === 0
              ? '润色对白台词与语言风格 (/polish) · 建议先选中对白节点'
              : `润色选中的对白台词 (${selectedDialogueCount} 个节点) (/polish)`
          }
        >
          ✨ 润色台词{selectedDialogueCount > 0 ? ` (${selectedDialogueCount})` : ''}
        </button>
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('continue')}
          title="顺承当前选中的对白节点与上下文，继续向下续写后续对白 (/continue)"
        >
          💬 对话续写
        </button>
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('fix')}
          title="检查当前蓝图中的逻辑连线与孤立节点，优化引脚与结构 (/fix)"
        >
          🔧 检查修复
        </button>
        <button
          type="button"
          className={styles.quickActionButton}
          disabled={disabled}
          onClick={() => handleCommandClick('discuss')}
          title="与 AI 探讨剧情构想、角色人设或头脑风暴，不生成蓝图节点 (/discuss)"
        >
          💭 讨论剧情
        </button>
      </div>
      <span className={styles.quickActionTip} title="支持直接拖入文件附加至上下文，输入 / 可随时调出指令菜单">
        💡 输入 <code>/</code> 调出指令 · 支持 Attach / 拖入剧本
      </span>
    </div>
  );
}
