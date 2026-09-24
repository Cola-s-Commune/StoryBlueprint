export interface AISlashCommand {
  id: string;
  command: string;
  aliases: string[];
  label: string;
  icon: string;
  description: string;
  recommendedScope: 'selection' | 'graph' | 'story';
  buildTemplate: (context: {
    selectedNodeId?: string;
    selectedNodeType?: string;
    hasAttachments?: boolean;
  }) => string;
}

export const AI_SLASH_COMMANDS: AISlashCommand[] = [
  {
    id: 'script',
    command: '/script',
    aliases: ['/adapt'],
    label: '剧本转蓝图',
    icon: '📖',
    description: '将附件剧本或文本转换为对白与旁白蓝图节点并自动连线',
    recommendedScope: 'graph',
    buildTemplate: ({ selectedNodeId, hasAttachments }) => {
      const connectHint = selectedNodeId ? `，并连接至当前选中的节点 (${selectedNodeId})` : '';
      const sourceHint = hasAttachments
        ? '附带的剧本文件'
        : '附带的剧本文件（或以下剧本内容）';
      return `/script 请将${sourceHint}转换为对白(Dialogue)与旁白(Narration)蓝图节点${connectHint}：\n\n`;
    },
  },
  {
    id: 'branch',
    command: '/branch',
    aliases: ['/choice'],
    label: '生成分支',
    icon: '🔀',
    description: '为当前选中的剧情/对白节点设计多分支决策抉择与后续走向',
    recommendedScope: 'selection',
    buildTemplate: ({ selectedNodeId }) => {
      const targetHint = selectedNodeId ? `针对当前选中的节点 (${selectedNodeId}) ` : '';
      return `/branch 请${targetHint}设计分支抉择（Choice 节点），包含 2~3 个具有戏剧冲突/不同走向的选项，并为各选项生成后续剧情节点：\n\n`;
    },
  },
  {
    id: 'polish',
    command: '/polish',
    aliases: [],
    label: '润色台词',
    icon: '✨',
    description: '润色选中对白节点的台词与语言风格，强化角色个性与情绪张力',
    recommendedScope: 'selection',
    buildTemplate: ({ selectedNodeId }) => {
      const targetHint = selectedNodeId ? `当前选中节点 (${selectedNodeId}) 的` : '';
      return `/polish 请润色${targetHint}对白台词，使其更符合角色个性、情绪基调与剧情张力：\n\n`;
    },
  },
  {
    id: 'continue',
    command: '/continue',
    aliases: [],
    label: '对话续写',
    icon: '💬',
    description: '顺承当前选中的对白节点与上下文，继续向下续写后续对白',
    recommendedScope: 'selection',
    buildTemplate: ({ selectedNodeId }) => {
      const targetHint = selectedNodeId ? `当前选中的对白 (${selectedNodeId})` : '当前剧情上下文';
      return `/continue 请顺承${targetHint}，续写接下来的角色交谈与剧情发展（生成新的对白与旁白节点并连线）：\n\n`;
    },
  },
  {
    id: 'fix',
    command: '/fix',
    aliases: [],
    label: '检查与修复',
    icon: '🔧',
    description: '检查当前蓝图中的逻辑连线与孤立节点，优化引脚与结构',
    recommendedScope: 'graph',
    buildTemplate: () => {
      return `/fix 请检查当前蓝图中的逻辑连线、断点或孤立节点，并修复或优化连线：\n\n`;
    },
  },
];

export interface SlashMatchResult {
  query: string;
  startIndex: number;
  endIndex: number;
  commands: AISlashCommand[];
}

/**
 * Searches for a slash command query prefix at the current cursor position.
 * Matches `/query` at the start of input or directly following a newline.
 */
export function findMatchingSlashCommands(
  text: string,
  cursorPosition: number,
): SlashMatchResult | null {
  const textBeforeCursor = text.slice(0, cursorPosition);
  const match = textBeforeCursor.match(/(?:^|\n)\/([^\s]*)$/);
  if (!match) return null;

  const query = match[1].toLowerCase();
  const startIndex = textBeforeCursor.length - match[0].length + (match[0].startsWith('\n') ? 1 : 0);
  const endIndex = cursorPosition;

  const commands = AI_SLASH_COMMANDS.filter((cmd) => {
    if (!query) return true;
    const nameMatch = cmd.command.slice(1).toLowerCase().startsWith(query);
    const aliasMatch = cmd.aliases.some((alias) =>
      alias.slice(1).toLowerCase().startsWith(query),
    );
    const labelMatch = cmd.label.toLowerCase().includes(query);
    return nameMatch || aliasMatch || labelMatch;
  });

  return { query, startIndex, endIndex, commands };
}

/**
 * Replaces the slash query range with the command template.
 */
export function applySlashCommandToText(
  text: string,
  startIndex: number,
  endIndex: number,
  template: string,
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, startIndex);
  const after = text.slice(endIndex);
  const newText = before + template + after;
  return {
    newText,
    newCursorPos: before.length + template.length,
  };
}
