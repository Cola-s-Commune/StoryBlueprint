import {
  type StorySemanticSnapshot,
  type BlueprintCommandTransaction,
  type BlueprintTransactionResult,
  type StoryNodeType,
  type AIHarnessMode,
  type NodeId,
  buildSmallModelPrompt,
  compileCompactActionsToTransaction,
  BLUEPRINT_COMMAND_JSON_SCHEMA,
} from '@story-blueprint/common';
import { normalizeAIBlueprintCommand, parseAIAssistantResponse } from '../../../shared/aiProvider';
import { convertInkToBlueprintTransaction } from '../../dialogue/inkImport';

export type { AIHarnessMode };

export interface HarnessModeOption {
  id: AIHarnessMode;
  label: string;
  icon: string;
  badge: string;
  description: string;
}

export const HARNESS_MODE_OPTIONS: readonly HarnessModeOption[] = [
  {
    id: 'auto',
    label: '自动',
    icon: '🤖',
    badge: '智能分流',
    description: '自动识别需求：创作新剧情使用 Ink 剧本转换，微调节点使用直接编辑。',
  },
  {
    id: 'direct',
    label: '直接编辑',
    icon: '⚡',
    badge: '修改节点',
    description: '专注对已有节点台词、选项分支、变量及连线进行精准增删改（适合 8B/14B 小模型微调）。',
  },
  {
    id: 'ink',
    label: 'Ink 转换',
    icon: '📜',
    badge: '剧本创作',
    description: '专注根据自然文本或 Ink 语法创作对白分支并自动转译为蓝图节点（适合剧情创作与续写）。',
  },
] as const;

export const SMALL_MODEL_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reply'],
  properties: {
    reply: { type: 'string', minLength: 1 },
    ink: {
      type: ['string', 'null'],
    },
    actions: {
      type: 'array',
      items: { type: 'object' },
    },
  },
} as const;

export const AI_ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: {
    reply: { type: 'string', minLength: 1 },
    ink: {
      type: ['string', 'null'],
    },
    command: {
      anyOf: [BLUEPRINT_COMMAND_JSON_SCHEMA, { type: 'null' }],
    },
    actions: {
      type: 'array',
      items: { type: 'object' },
    },
    needsClarification: { type: 'boolean' },
    questions: { type: 'array', items: { type: 'string', minLength: 1 } },
    toolRequest: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        name: {
          enum: [
            'story.search',
            'story.get_nodes',
            'story.get_characters',
            'story.get_graph',
            'story.validate_command',
          ],
        },
        arguments: { type: 'object' },
      },
      required: ['name', 'arguments'],
    },
  },
} as const;

export interface PrepareHarnessPromptOptions {
  mode: AIHarnessMode;
  isSmallModel: boolean;
  revision: string;
  selectedNodes?: readonly {
    id: string;
    type: StoryNodeType | string;
    data: unknown;
    title?: string;
  }[];
  characters?: readonly { id: string; name: string; displayName: string }[];
  activeGraphId?: string;
  userInstruction?: string;
  multiTurnBlock?: string;
  buildFullContextPrompt: () => string;
}

/**
 * Prepares the AI prompt based on whether a small model is detected and the author's chosen harness mode.
 * When in small model mode or an explicit mode (direct/ink), strips massive schema noise to prevent model confusion.
 */
export function prepareHarnessPrompt(options: PrepareHarnessPromptOptions): string {
  if (options.isSmallModel || options.mode !== 'auto') {
    return buildSmallModelPrompt({
      revision: options.revision,
      mode: options.mode,
      selectedNodes: options.selectedNodes,
      characters: options.characters,
      activeGraphId: options.activeGraphId,
      userInstruction: options.userInstruction,
      multiTurnBlock: options.multiTurnBlock,
    });
  }

  return options.buildFullContextPrompt();
}

/**
 * Returns the appropriate JSON response schema constraint for the model and harness mode.
 */
export function getHarnessResponseSchema(isSmallModel: boolean, mode: AIHarnessMode): Record<string, unknown> {
  if (isSmallModel || mode !== 'auto') {
    return SMALL_MODEL_RESPONSE_SCHEMA;
  }
  return AI_ASSISTANT_RESPONSE_SCHEMA;
}

export interface ProcessHarnessResponseOptions {
  mode: AIHarnessMode;
  responseContent: string;
  modelName?: string;
  semanticSnapshot: StorySemanticSnapshot;
  activeGraphId?: string;
  selectedNodeIds: readonly string[];
  characters?: readonly any[];
  assets?: readonly any[];
  events?: readonly any[];
  dryRunTransaction: (transaction: BlueprintCommandTransaction) => BlueprintTransactionResult | undefined;
}

export interface ProcessHarnessResult {
  reply: string;
  status: string;
  error?: string;
  transaction?: BlueprintCommandTransaction;
  dryRunResult?: BlueprintTransactionResult;
  hasProposal: boolean;
  needsClarification?: boolean;
  unstructured?: boolean;
  toolRequest?: { name: string; arguments: Record<string, unknown> };
  sourceMode: 'direct_actions' | 'ink_script' | 'blueprint_command' | 'conversation';
}

/**
 * Unified runtime harness execution layer:
 * Takes raw AI response text, parses it, adapts compact actions or Ink scripts to full BlueprintCommandTransaction,
 * executes sandbox dry-run verification, and produces structured diagnostic results.
 */
export function processHarnessResponse(options: ProcessHarnessResponseOptions): ProcessHarnessResult {
  const {
    mode,
    responseContent,
    modelName,
    semanticSnapshot,
    activeGraphId,
    selectedNodeIds,
    characters = [],
    assets = [],
    events = [],
    dryRunTransaction,
  } = options;

  const assistant = parseAIAssistantResponse(responseContent, semanticSnapshot.revision);

  if (assistant.toolRequest) {
    return {
      reply: assistant.reply,
      status: `AI 请求调用只读工具: ${assistant.toolRequest.name}`,
      hasProposal: false,
      toolRequest: assistant.toolRequest,
      sourceMode: 'conversation',
    };
  }

  const modelLabel = modelName ? ` · ${modelName}` : '';

  // 1. Direct mode priority
  if (mode === 'direct') {
    if (assistant.actions && assistant.actions.length > 0) {
      const transaction = compileCompactActionsToTransaction(assistant.actions, {
        snapshot: semanticSnapshot,
        activeGraphId: activeGraphId === 'root' ? undefined : activeGraphId,
        selectedNodeIds: selectedNodeIds as string[],
        characters,
      });
      const dryRunResult = dryRunTransaction(transaction);
      return {
        reply: assistant.reply,
        transaction,
        dryRunResult,
        hasProposal: Boolean(dryRunResult?.ok),
        status: dryRunResult?.ok
          ? `蓝图修改动作已应用 (${assistant.actions.length} 项变更)${modelLabel} · 预览就绪`
          : `蓝图修改动作校验未通过 · 请查看下方错误诊断`,
        error: dryRunResult?.ok ? undefined : '蓝图修改动作校验未通过',
        sourceMode: 'direct_actions',
      };
    }

    if (assistant.command) {
      const transaction = normalizeAIBlueprintCommand(
        assistant.command,
        semanticSnapshot.revision,
      ) as BlueprintCommandTransaction;
      const dryRunResult = dryRunTransaction(transaction);
      return {
        reply: assistant.reply,
        transaction,
        dryRunResult,
        hasProposal: Boolean(dryRunResult?.ok),
        status: dryRunResult?.ok
          ? `蓝图修改已由 AI 生成${modelLabel} · 预览就绪`
          : `蓝图指令校验未通过 · 请查看下方错误诊断`,
        error: dryRunResult?.ok ? undefined : '蓝图指令校验未通过',
        sourceMode: 'blueprint_command',
      };
    }

    // Fallback: If model generated ink in direct mode, tolerate it
    if (assistant.ink) {
      return compileInkScriptProposal(assistant.ink, assistant.reply, options, modelLabel);
    }
  }

  // 2. Ink mode priority
  if (mode === 'ink') {
    if (assistant.ink) {
      return compileInkScriptProposal(assistant.ink, assistant.reply, options, modelLabel);
    }

    // Fallback: If model generated compact actions in ink mode, tolerate it
    if (assistant.actions && assistant.actions.length > 0) {
      const transaction = compileCompactActionsToTransaction(assistant.actions, {
        snapshot: semanticSnapshot,
        activeGraphId: activeGraphId === 'root' ? undefined : activeGraphId,
        selectedNodeIds: selectedNodeIds as string[],
        characters,
      });
      const dryRunResult = dryRunTransaction(transaction);
      return {
        reply: assistant.reply,
        transaction,
        dryRunResult,
        hasProposal: Boolean(dryRunResult?.ok),
        status: dryRunResult?.ok
          ? `蓝图修改动作已应用 (${assistant.actions.length} 项变更)${modelLabel} · 预览就绪`
          : `蓝图修改动作校验未通过 · 请查看下方错误诊断`,
        error: dryRunResult?.ok ? undefined : '蓝图修改动作校验未通过',
        sourceMode: 'direct_actions',
      };
    }

    if (assistant.command) {
      const transaction = normalizeAIBlueprintCommand(
        assistant.command,
        semanticSnapshot.revision,
      ) as BlueprintCommandTransaction;
      const dryRunResult = dryRunTransaction(transaction);
      return {
        reply: assistant.reply,
        transaction,
        dryRunResult,
        hasProposal: Boolean(dryRunResult?.ok),
        status: dryRunResult?.ok
          ? `蓝图修改已由 AI 生成${modelLabel} · 预览就绪`
          : `蓝图指令校验未通过 · 请查看下方错误诊断`,
        error: dryRunResult?.ok ? undefined : '蓝图指令校验未通过',
        sourceMode: 'blueprint_command',
      };
    }
  }

  // 3. Auto mode: examine command, then actions, then ink
  if (assistant.command) {
    const transaction = normalizeAIBlueprintCommand(
      assistant.command,
      semanticSnapshot.revision,
    ) as BlueprintCommandTransaction;
    const dryRunResult = dryRunTransaction(transaction);
    return {
      reply: assistant.reply,
      transaction,
      dryRunResult,
      hasProposal: Boolean(dryRunResult?.ok),
      status: dryRunResult?.ok
        ? `蓝图修改已由 AI 生成${assistant.jsonRepaired ? ' (自动修复非转义字符)' : ''}${modelLabel} · 预览就绪`
        : `AI 生成的蓝图指令格式不匹配或校验未通过 · 请查看下方错误诊断`,
      error: dryRunResult?.ok ? undefined : 'AI 生成的蓝图指令格式不匹配或校验未通过',
      sourceMode: 'blueprint_command',
    };
  }

  if (assistant.actions && assistant.actions.length > 0) {
    const transaction = compileCompactActionsToTransaction(assistant.actions, {
      snapshot: semanticSnapshot,
      activeGraphId: activeGraphId === 'root' ? undefined : activeGraphId,
      selectedNodeIds: selectedNodeIds as string[],
      characters,
    });
    const dryRunResult = dryRunTransaction(transaction);
    return {
      reply: assistant.reply,
      transaction,
      dryRunResult,
      hasProposal: Boolean(dryRunResult?.ok),
      status: dryRunResult?.ok
        ? `蓝图修改动作已应用 (${assistant.actions.length} 项变更)${modelLabel} · 预览就绪`
        : `蓝图修改动作校验未通过 · 请查看下方错误诊断`,
      error: dryRunResult?.ok ? undefined : '蓝图修改动作校验未通过',
      sourceMode: 'direct_actions',
    };
  }

  if (assistant.ink) {
    return compileInkScriptProposal(assistant.ink, assistant.reply, options, modelLabel);
  }

  // No modification or script proposed
  return {
    reply: assistant.reply,
    hasProposal: false,
    needsClarification: assistant.needsClarification,
    unstructured: assistant.unstructured,
    status: assistant.needsClarification
      ? '需要作者进一步提供澄清信息'
      : assistant.unstructured
        ? `回复来自 ${modelName || 'AI 模型'} (未包含蓝图修改指令)`
        : `已回复${modelLabel}`,
    sourceMode: 'conversation',
  };
}

function compileInkScriptProposal(
  inkScript: string,
  assistantReply: string,
  options: ProcessHarnessResponseOptions,
  modelLabel: string,
): ProcessHarnessResult {
  const { semanticSnapshot, activeGraphId, selectedNodeIds, characters = [], assets = [], events = [], dryRunTransaction } = options;
  const selectedSingleNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;

  const inkResult = convertInkToBlueprintTransaction(inkScript, {
    revision: semanticSnapshot.revision,
    chapterId: activeGraphId === 'root' ? undefined : activeGraphId,
    characters,
    assets,
    variables: semanticSnapshot.variables,
    events,
    autoCreateCharacters: true,
    connectToNodeId: selectedSingleNodeId as NodeId | undefined,
  });

  if (inkResult.ok && inkResult.transaction) {
    const transaction = inkResult.transaction;
    const dryRunResult = dryRunTransaction(transaction);
    const summaryText = inkResult.summary
      ? `${inkResult.summary.dialogueNodes} 对白 · ${inkResult.summary.choiceNodes} 抉择 · ${inkResult.summary.narrationNodes} 旁白`
      : '剧本节点';

    return {
      reply: assistantReply,
      transaction,
      dryRunResult,
      hasProposal: Boolean(dryRunResult?.ok),
      status: dryRunResult?.ok
        ? `Ink 剧本已自动编译为蓝图节点 (${summaryText})${modelLabel} · 预览就绪`
        : `Ink 剧本编译生成的蓝图操作校验未通过 · 请查看下方错误诊断`,
      error: dryRunResult?.ok ? undefined : 'Ink 剧本编译生成的蓝图操作校验未通过',
      sourceMode: 'ink_script',
    };
  }

  const errorDetails = (inkResult.diagnostics || [])
    .map((d) => `第 ${d.line} 行: ${d.message}`)
    .join('; ');

  return {
    reply: assistantReply,
    hasProposal: false,
    status: 'Ink 剧本编译未通过',
    error: `Ink 剧本编译异常: ${errorDetails || '无法转换为蓝图节点'}`,
    sourceMode: 'ink_script',
  };
}
