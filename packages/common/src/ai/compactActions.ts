import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  type BlueprintCommand,
  type BlueprintCommandTransaction,
  type BlueprintGraphTarget,
} from './blueprintCommands';
import { StoryNodeType, type StoryNodeDataMap } from '../types/nodes';
import {
  createStableId,
  type ChapterId,
  type CharacterId,
  type DialogueLineId,
  type NodeId,
  type OptionId,
  type TextId,
} from '../types/ids';
import type { CharacterSource } from '../types/source';
import type { StorySemanticSnapshot } from './semanticModel';

export type CompactBlueprintAction =
  | {
      type: 'update_line' | 'update_dialogue_line';
      nodeId?: string;
      lineId?: string;
      lineIndex?: number;
      text: string;
      speaker?: string;
      emotion?: string;
    }
  | {
      type: 'add_line' | 'append_line';
      nodeId?: string;
      speaker?: string;
      text: string;
      emotion?: string;
    }
  | {
      type: 'remove_line';
      nodeId?: string;
      lineId?: string;
      lineIndex?: number;
    }
  | {
      type: 'update_choice_option' | 'update_option';
      nodeId?: string;
      optionId?: string;
      optionIndex?: number;
      text: string;
    }
  | {
      type: 'add_choice_option' | 'add_option';
      nodeId?: string;
      text: string;
    }
  | {
      type: 'remove_choice_option' | 'remove_option';
      nodeId?: string;
      optionId?: string;
      optionIndex?: number;
    }
  | {
      type: 'update_narration';
      nodeId?: string;
      text: string;
    }
  | {
      type: 'adjust_variable';
      variable: string;
      delta: number;
    }
  | {
      type: 'connect';
      fromNodeId: string;
      toNodeId: string;
      fromPort?: string;
      toPort?: string;
    }
  | {
      type: 'disconnect';
      fromNodeId: string;
      toNodeId: string;
      fromPort?: string;
      toPort?: string;
    }
  | {
      type: 'remove_node';
      nodeId: string;
    }
  | {
      type: 'append_dialogue';
      afterNodeId?: string;
      speaker?: string;
      text: string;
      emotion?: string;
    }
  | {
      type: 'append_narration';
      afterNodeId?: string;
      text: string;
    }
  | {
      type: 'append_choice';
      afterNodeId?: string;
      prompt: string;
      options: string[];
    };

export interface CompactActionCompilationContext {
  snapshot: StorySemanticSnapshot;
  activeGraphId?: string;
  selectedNodeIds?: readonly string[];
  characters?: readonly CharacterSource[];
}

function resolveCharacterId(
  speakerNameOrId: string | undefined,
  characters: readonly CharacterSource[],
  autoCreatedCharacters: Map<string, string>,
): CharacterId | undefined {
  if (!speakerNameOrId || !speakerNameOrId.trim()) return undefined;
  const target = speakerNameOrId.trim();

  // If already a valid c_ ID
  if (/^c_[a-z0-9][a-z0-9_-]{2,}$/i.test(target)) {
    return target.toLowerCase() as CharacterId;
  }

  // Look in existing characters by displayName or name
  const existing = characters.find(
    (c) =>
      c.displayName.toLowerCase() === target.toLowerCase() ||
      c.name.toLowerCase() === target.toLowerCase() ||
      c.id.toLowerCase() === target.toLowerCase(),
  );
  if (existing) return existing.id as CharacterId;

  // Check if we already created a character in this session
  if (autoCreatedCharacters.has(target)) {
    return autoCreatedCharacters.get(target) as CharacterId;
  }

  // Create new character ID
  const newId = createStableId('character');
  autoCreatedCharacters.set(target, newId);
  return newId;
}

function resolveGraphTarget(graphId?: string): BlueprintGraphTarget {
  if (!graphId || graphId === 'root') {
    return { kind: 'root' };
  }
  return { kind: 'chapter', chapterId: graphId as ChapterId };
}

/**
 * Compiles a list of simplified actions emitted by 8B/14B models into a valid,
 * robust Story Blueprint Command Transaction.
 */
export function compileCompactActionsToTransaction(
  actions: readonly CompactBlueprintAction[],
  context: CompactActionCompilationContext,
): BlueprintCommandTransaction {
  const operations: BlueprintCommand[] = [];
  const graph = resolveGraphTarget(context.activeGraphId);
  const autoCreatedCharacters = new Map<string, string>();
  let opSeq = 1;
  const nextOpId = () => `op_action_${opSeq++}`;

  const activeGraph = context.snapshot.graphs.find((g) =>
    graph.kind === 'root' ? g.kind === 'root' : g.kind === 'chapter' && g.chapterId === graph.chapterId,
  );
  const defaultSelectedNodeId = context.selectedNodeIds && context.selectedNodeIds.length > 0
    ? context.selectedNodeIds[0]
    : undefined;

  for (const action of actions) {
    switch (action.type) {
      case 'update_line':
      case 'update_dialogue_line': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Dialogue) break;
        const dialogueData = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
        const lines = dialogueData.lines || [];

        let targetLineId = action.lineId;
        if (!targetLineId) {
          if (typeof action.lineIndex === 'number') {
            // Support 1-based (index 1 is 0) or 0-based
            const idx = action.lineIndex > 0 && action.lineIndex <= lines.length
              ? action.lineIndex - 1
              : action.lineIndex >= 0 && action.lineIndex < lines.length
                ? action.lineIndex
                : 0;
            targetLineId = lines[idx]?.id;
          } else if (lines.length > 0) {
            targetLineId = lines[0].id;
          }
        }
        if (!targetLineId) break;

        const speakerId = resolveCharacterId(
          action.speaker,
          context.characters || [],
          autoCreatedCharacters,
        );

        operations.push({
          operationId: nextOpId(),
          kind: 'update-dialogue-line',
          graph,
          nodeId: nodeId as NodeId,
          lineId: targetLineId as DialogueLineId,
          patch: {
            text: action.text,
            ...(speakerId ? { speakerId } : {}),
            ...(action.emotion ? { emotion: action.emotion } : {}),
          },
        });
        break;
      }

      case 'add_line':
      case 'append_line': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Dialogue) break;

        const speakerId = resolveCharacterId(
          action.speaker,
          context.characters || [],
          autoCreatedCharacters,
        );

        operations.push({
          operationId: nextOpId(),
          kind: 'add-dialogue-line',
          graph,
          nodeId: nodeId as NodeId,
          line: {
            id: createStableId('line'),
            textId: createStableId('text'),
            text: action.text,
            ...(speakerId ? { speakerId } : {}),
            ...(action.emotion ? { emotion: action.emotion } : {}),
          },
        });
        break;
      }

      case 'remove_line': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Dialogue) break;
        const dialogueData = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
        const lines = dialogueData.lines || [];

        let targetLineId = action.lineId;
        if (!targetLineId && typeof action.lineIndex === 'number') {
          const idx = action.lineIndex > 0 && action.lineIndex <= lines.length
            ? action.lineIndex - 1
            : action.lineIndex;
          targetLineId = lines[idx]?.id;
        }
        if (!targetLineId) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'remove-dialogue-line',
          graph,
          nodeId: nodeId as NodeId,
          lineId: targetLineId as DialogueLineId,
        });
        break;
      }

      case 'update_choice_option':
      case 'update_option': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Choice) break;
        const choiceData = node.data as StoryNodeDataMap[StoryNodeType.Choice];
        const options = choiceData.options || [];

        let targetOptionId = action.optionId;
        if (!targetOptionId) {
          if (typeof action.optionIndex === 'number') {
            const idx = action.optionIndex > 0 && action.optionIndex <= options.length
              ? action.optionIndex - 1
              : action.optionIndex >= 0 && action.optionIndex < options.length
                ? action.optionIndex
                : 0;
            targetOptionId = options[idx]?.id;
          } else if (options.length > 0) {
            targetOptionId = options[0].id;
          }
        }
        if (!targetOptionId) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'update-choice-option',
          graph,
          nodeId: nodeId as NodeId,
          optionId: targetOptionId as OptionId,
          patch: {
            text: action.text,
          },
        });
        break;
      }

      case 'add_choice_option':
      case 'add_option': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Choice) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'add-choice-option',
          graph,
          nodeId: nodeId as NodeId,
          option: {
            id: createStableId('option'),
            text: action.text,
          },
        });
        break;
      }

      case 'remove_choice_option':
      case 'remove_option': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Choice) break;
        const choiceData = node.data as StoryNodeDataMap[StoryNodeType.Choice];
        const options = choiceData.options || [];

        let targetOptionId = action.optionId;
        if (!targetOptionId && typeof action.optionIndex === 'number') {
          const idx = action.optionIndex > 0 && action.optionIndex <= options.length
            ? action.optionIndex - 1
            : action.optionIndex;
          targetOptionId = options[idx]?.id;
        }
        if (!targetOptionId) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'remove-choice-option',
          graph,
          nodeId: nodeId as NodeId,
          optionId: targetOptionId as OptionId,
        });
        break;
      }

      case 'update_narration': {
        const nodeId = action.nodeId || defaultSelectedNodeId;
        if (!nodeId || !activeGraph) break;
        const node = activeGraph.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== StoryNodeType.Narration) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'update-node',
          graph,
          nodeId: nodeId as NodeId,
          patch: {
            data: {
              text: { source: action.text },
            },
          },
        });
        break;
      }

      case 'adjust_variable': {
        const varTarget = action.variable.trim();
        const existingVar = context.snapshot.variables.find(
          (v) => v.name.toLowerCase() === varTarget.toLowerCase() || v.id.toLowerCase() === varTarget.toLowerCase(),
        );
        if (!existingVar) break;

        operations.push({
          operationId: nextOpId(),
          kind: 'add-variable-adjustment',
          graph,
          node: {
            id: createStableId('node'),
            name: `Adjust ${existingVar.name}`,
          },
          variableId: existingVar.id,
          delta: action.delta || 1,
        });
        break;
      }

      case 'connect': {
        if (!action.fromNodeId || !action.toNodeId) break;
        operations.push({
          operationId: nextOpId(),
          kind: 'connect',
          graph,
          from: { nodeId: action.fromNodeId as NodeId, portId: action.fromPort || 'out' },
          to: { nodeId: action.toNodeId as NodeId, portId: action.toPort || 'in' },
        });
        break;
      }

      case 'disconnect': {
        if (!action.fromNodeId || !action.toNodeId) break;
        operations.push({
          operationId: nextOpId(),
          kind: 'disconnect',
          graph,
          from: { nodeId: action.fromNodeId as NodeId, portId: action.fromPort || 'out' },
          to: { nodeId: action.toNodeId as NodeId, portId: action.toPort || 'in' },
        });
        break;
      }

      case 'remove_node': {
        if (!action.nodeId) break;
        operations.push({
          operationId: nextOpId(),
          kind: 'remove-node',
          graph,
          nodeId: action.nodeId as NodeId,
        });
        break;
      }

      case 'append_dialogue': {
        const predecessorId = action.afterNodeId || defaultSelectedNodeId;
        const newNodeId = createStableId('node');
        const speakerId = resolveCharacterId(
          action.speaker,
          context.characters || [],
          autoCreatedCharacters,
        );

        operations.push({
          operationId: nextOpId(),
          kind: 'add-node',
          graph,
          node: {
            id: newNodeId,
            type: StoryNodeType.Dialogue,
            name: action.speaker ? `${action.speaker} 对白` : '对白',
            data: {
              lines: [
                {
                  id: createStableId('line'),
                  textId: createStableId('text'),
                  text: { source: action.text },
                  ...(speakerId ? { speakerId } : {}),
                  ...(action.emotion ? { emotion: action.emotion } : {}),
                },
              ],
            },
          },
        });

        if (predecessorId) {
          operations.push({
            operationId: nextOpId(),
            kind: 'connect',
            graph,
            from: { nodeId: predecessorId as NodeId, portId: 'out' },
            to: { nodeId: newNodeId as NodeId, portId: 'in' },
          });
        }
        break;
      }

      case 'append_narration': {
        const predecessorId = action.afterNodeId || defaultSelectedNodeId;
        const newNodeId = createStableId('node');

        operations.push({
          operationId: nextOpId(),
          kind: 'add-node',
          graph,
          node: {
            id: newNodeId,
            type: StoryNodeType.Narration,
            name: '旁白',
            data: {
              textId: createStableId('text'),
              text: { source: action.text },
            },
          },
        });

        if (predecessorId) {
          operations.push({
            operationId: nextOpId(),
            kind: 'connect',
            graph,
            from: { nodeId: predecessorId as NodeId, portId: 'out' },
            to: { nodeId: newNodeId as NodeId, portId: 'in' },
          });
        }
        break;
      }

      case 'append_choice': {
        const predecessorId = action.afterNodeId || defaultSelectedNodeId;
        const newNodeId = createStableId('node');
        const optionsList = Array.isArray(action.options) && action.options.length > 0
          ? action.options
          : ['选项 1', '选项 2'];

        operations.push({
          operationId: nextOpId(),
          kind: 'add-node',
          graph,
          node: {
            id: newNodeId,
            type: StoryNodeType.Choice,
            name: '选择肢',
            data: {
              prompt: { source: action.prompt || '做出选择' },
              options: optionsList.map((optText: string) => ({
                id: createStableId('option'),
                text: { source: optText },
              })),
            },
          },
        });

        if (predecessorId) {
          operations.push({
            operationId: nextOpId(),
            kind: 'connect',
            graph,
            from: { nodeId: predecessorId as NodeId, portId: 'out' },
            to: { nodeId: newNodeId as NodeId, portId: 'in' },
          });
        }
        break;
      }
    }
  }

  // Prepend any auto-created characters
  const characterOps: BlueprintCommand[] = [];
  for (const [charName, charId] of autoCreatedCharacters.entries()) {
    characterOps.push({
      operationId: nextOpId(),
      kind: 'add-character',
      character: {
        id: charId as any,
        name: charName.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'char',
        displayName: charName,
        emotions: {},
      },
    });
  }

  return {
    format: BLUEPRINT_COMMAND_FORMAT,
    version: BLUEPRINT_COMMAND_VERSION,
    baseRevision: context.snapshot.revision,
    operations: [...characterOps, ...operations],
  };
}

/**
 * Extracts compact actions from plain Markdown lists or bullet points commonly generated by 8B models.
 * For example:
 * - 修改台词: "新的内容"
 * - 修改第2句台词: "撤退！"
 * - 选项1修改为: "前进"
 * - 新增台词 [小明]: "好的"
 */
export function extractCompactActionsFromMarkdown(text: string): CompactBlueprintAction[] {
  const actions: CompactBlueprintAction[] = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('-') && !line.startsWith('*') && !/^\d+\./.test(line)) continue;
    const content = line.replace(/^[-*]|\d+\.\s*/, '').trim();

    // 1. 修改第X句台词 / 修改台词
    // Example: 修改第2句台词 [李四]: "撤退！" or 修改台词: "撤退！"
    const lineMatch = content.match(
      /(?:修改|更新|改动)(?:节点\s*(n_[a-z0-9_-]+)\s*的)?(?:第\s*([0-9一二三四五两]+)\s*句)?(?:台词|对白)(?:\s*\[([^\]]+)\])?\s*[:：为到]+\s*["“「']?([^"”」']+)["”」']?/iu,
    );
    if (lineMatch) {
      const nodeId = lineMatch[1];
      const rawIdx = lineMatch[2];
      const speaker = lineMatch[3];
      const textVal = lineMatch[4]?.trim();
      let lineIndex: number | undefined = undefined;
      if (rawIdx) {
        const numMap: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
        lineIndex = numMap[rawIdx] || parseInt(rawIdx, 10);
      }
      if (textVal) {
        actions.push({
          type: 'update_line',
          ...(nodeId ? { nodeId } : {}),
          ...(lineIndex ? { lineIndex } : {}),
          ...(speaker ? { speaker } : {}),
          text: textVal,
        });
        continue;
      }
    }

    // 2. 追加台词 / 新增台词
    // Example: 追加台词 [艾丽丝]: "我们走吧"
    const appendLineMatch = content.match(
      /(?:新增|追加|添加)(?:台词|对白)(?:\s*\[([^\]]+)\])?\s*[:：为到]+\s*["“「']?([^"”」']+)["”」']?/iu,
    );
    if (appendLineMatch) {
      const speaker = appendLineMatch[1];
      const textVal = appendLineMatch[2]?.trim();
      if (textVal) {
        actions.push({
          type: 'add_line',
          ...(speaker ? { speaker } : {}),
          text: textVal,
        });
        continue;
      }
    }

    // 3. 新增选项
    // Example: 新增选项: "寻找密道"
    const addOptionMatch = content.match(
      /(?:新增|追加|添加)选项\s*[:：为到]+\s*["“「']?([^"”」']+)["”」']?/iu,
    );
    if (addOptionMatch) {
      const textVal = addOptionMatch[1]?.trim();
      if (textVal) {
        actions.push({
          type: 'add_choice_option',
          text: textVal,
        });
        continue;
      }
    }

    // 4. 修改选项
    // Example: 修改选项2为: "拔剑迎战" or 选项1改为: "逃跑"
    const optionMatch = content.match(
      /(?:(?:修改|更新|改)(?:第\s*([0-9一二三四五两]+)\s*个)?选项\s*([0-9一二三四五两])?|(?:第\s*([0-9一二三四五两]+)\s*个)?选项\s*([0-9一二三四五两])+\s*(?:修改|更新|改)?)\s*(?:为|到|[:：])+\s*["“「']?([^"”」']+)["”」']?/iu,
    );
    if (optionMatch) {
      const rawIdx = optionMatch[1] || optionMatch[2] || optionMatch[3] || optionMatch[4];
      const textVal = optionMatch[5]?.trim();
      let optionIndex: number | undefined = undefined;
      if (rawIdx) {
        const numMap: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
        optionIndex = numMap[rawIdx] || parseInt(rawIdx, 10);
      }
      if (textVal) {
        actions.push({
          type: 'update_choice_option',
          ...(optionIndex ? { optionIndex } : {}),
          text: textVal,
        });
        continue;
      }
    }

    // 5. 变量调整
    // Example: 好感度增加 5 or 变量 affinity 减 1
    const varMatch = content.match(
      /(?:变量\s*)?([a-zA-Z0-9_\u4e00-\u9fa5]+?)\s*(增加|加|提高|提升|减少|减|降低)\s*([0-9]+)/iu,
    );
    if (varMatch) {
      const varName = varMatch[1].trim();
      const op = varMatch[2];
      const amount = parseInt(varMatch[3], 10) || 1;
      const isMinus = /减|降低/.test(op);
      actions.push({
        type: 'adjust_variable',
        variable: varName,
        delta: isMinus ? -amount : amount,
      });
      continue;
    }
  }

  return actions;
}
