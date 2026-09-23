import { StoryNodeType, type StoryNodeDataMap } from '../types/nodes';
import type { CharacterSource } from '../types/source';
import type { BlueprintCommandTransaction, BlueprintCommand } from './blueprintCommands';

export interface SelectedNodeDetail {
  id: string;
  type: StoryNodeType | string;
  data: unknown;
  title?: string;
}

export interface MultiTurnContextParams {
  selectedNodes?: readonly SelectedNodeDetail[];
  characters?: readonly CharacterSource[];
  pendingProposal?: BlueprintCommandTransaction | null;
  currentStoryRevision: string;
}

/**
 * Formats details of currently selected nodes on the canvas, indexing lines and options
 * so LLMs can unambiguously resolve ordinals like "third option" or "second line".
 */
export function formatSelectedNodesDetails(
  selectedNodes: readonly SelectedNodeDetail[],
  characters: readonly CharacterSource[] = [],
): string {
  if (!selectedNodes || selectedNodes.length === 0) {
    return '';
  }

  const charMap = new Map<string, string>();
  for (const char of characters) {
    charMap.set(char.id, char.displayName || char.name);
  }

  const lines: string[] = ['ACTIVE SELECTION DETAILS (Explicitly selected nodes on canvas):'];

  selectedNodes.forEach((node, nodeIndex) => {
    const nodeLabel = node.title ? `"${node.title}"` : `node`;
    lines.push(`- Selected Node ${nodeIndex + 1}: ID "${node.id}" (Type: ${node.type}) ${nodeLabel}`);

    if (node.type === StoryNodeType.Dialogue) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue] | undefined;
      const dialogueLines = data?.lines ?? [];
      if (dialogueLines.length === 0) {
        lines.push('  (Dialogue node has no lines authored yet)');
      } else {
        lines.push('  Dialogue Lines:');
        dialogueLines.forEach((line, lineIndex) => {
          const speakerName = line.speakerId ? (charMap.get(line.speakerId) ?? line.speakerId) : 'Narration / Unassigned';
          const emotion = line.emotion ? `, Emotion: "${line.emotion}"` : '';
          const textContent = typeof line.text === 'object' && line.text !== null && 'source' in line.text
            ? (line.text as { source: string }).source
            : String(line.text ?? '');
          lines.push(`    Line ${lineIndex + 1} [ID: "${line.id}", Speaker: ${speakerName}${emotion}]: "${textContent}"`);
        });
      }
    } else if (node.type === StoryNodeType.Choice) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice] | undefined;
      const promptText = typeof data?.prompt === 'object' && data?.prompt !== null && 'source' in data.prompt
        ? (data.prompt as { source: string }).source
        : String(data?.prompt ?? '');
      if (promptText) {
        lines.push(`  Choice Prompt: "${promptText}"`);
      }
      const options = data?.options ?? [];
      if (options.length === 0) {
        lines.push('  (Choice node has no options configured yet)');
      } else {
        lines.push('  Choice Options (indexed in order):');
        options.forEach((opt, optIndex) => {
          const optText = typeof opt.text === 'object' && opt.text !== null && 'source' in opt.text
            ? (opt.text as { source: string }).source
            : String(opt.text ?? '');
          lines.push(`    Option ${optIndex + 1} [ID: "${opt.id}"]: "${optText}"`);
        });
      }
    } else if (node.type === StoryNodeType.Narration) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Narration] | undefined;
      const narrationText = typeof data?.text === 'object' && data?.text !== null && 'source' in data.text
        ? (data.text as { source: string }).source
        : String(data?.text ?? '');
      lines.push(`  Narration Text: "${narrationText}"`);
    } else if (node.type === StoryNodeType.Branch) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Branch] | undefined;
      if (data?.conditionId) {
        lines.push(`  Branch Condition Resource ID: "${data.conditionId}"`);
      } else if (data?.condition?.source) {
        lines.push(`  Branch Expression: "${data.condition.source}"`);
      }
    } else if (node.type === StoryNodeType.SetVariable) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable] | undefined;
      const op = data?.containerOperation ?? 'assign';
      lines.push(`  SetVariable: Target "${data?.variableId ?? ''}", Op "${op}"`);
    }
  });

  return lines.join('\n');
}

/**
 * Formats the pending unapplied proposal state.
 * When the author is in multi-turn conversation and hasn't clicked "Apply" yet,
 * this informs the LLM that the proposal is in preview and how to modify it.
 */
export function formatPendingProposalState(
  proposal: BlueprintCommandTransaction | null | undefined,
  currentStoryRevision: string,
): string {
  if (!proposal || !proposal.operations || proposal.operations.length === 0) {
    return [
      'CURRENT PROPOSAL STATE:',
      `There is NO unapplied preview proposal pending. All previous transactions have been applied to Story revision ${currentStoryRevision}.`,
      'Any follow-up edits must operate on current Story nodes.',
    ].join('\n');
  }

  const lines: string[] = [
    'CURRENT PROPOSAL STATE (Awaiting Author Review):',
    `Status: Unapplied proposal is in PREVIEW (not yet applied to Story revision ${currentStoryRevision}).`,
    'Pending Operations:',
  ];

  proposal.operations.forEach((opRaw, opIndex) => {
    const op = opRaw as BlueprintCommand;
    if (op.kind === 'add-node') {
      const node = op.node;
      lines.push(`  Op ${opIndex + 1}: add-node [ID: "${node.id}", Type: ${node.type}]`);
      if (node.type === StoryNodeType.Choice) {
        const choiceData = node.data as StoryNodeDataMap[StoryNodeType.Choice] | undefined;
        const options = choiceData?.options ?? [];
        options.forEach((opt, idx) => {
          const text = typeof opt.text === 'object' && opt.text !== null && 'source' in opt.text
            ? (opt.text as { source: string }).source
            : String(opt.text ?? '');
          lines.push(`    Option ${idx + 1} [ID: "${opt.id}"]: "${text}"`);
        });
      } else if (node.type === StoryNodeType.Dialogue) {
        const dialogueData = node.data as StoryNodeDataMap[StoryNodeType.Dialogue] | undefined;
        const dLines = dialogueData?.lines ?? [];
        dLines.forEach((ln, idx) => {
          const text = typeof ln.text === 'object' && ln.text !== null && 'source' in ln.text
            ? (ln.text as { source: string }).source
            : String(ln.text ?? '');
          lines.push(`    Line ${idx + 1} [ID: "${ln.id}", Speaker: "${ln.speakerId ?? ''}"]: "${text}"`);
        });
      }
    } else if (op.kind === 'update-choice-option') {
      lines.push(`  Op ${opIndex + 1}: update-choice-option [Node: "${op.nodeId}", Option: "${op.optionId}", Text: "${op.patch?.text ?? ''}"]`);
    } else if (op.kind === 'update-dialogue-line') {
      lines.push(`  Op ${opIndex + 1}: update-dialogue-line [Node: "${op.nodeId}", Line: "${op.lineId}"]`);
    } else if (op.kind === 'connect') {
      lines.push(`  Op ${opIndex + 1}: connect [${op.from.nodeId}:${op.from.portId} -> ${op.to.nodeId}:${op.to.portId}]`);
    } else {
      lines.push(`  Op ${opIndex + 1}: ${op.kind}`);
    }
  });

  lines.push(
    'FOLLOW-UP INSTRUCTION ON PENDING PROPOSAL:',
    `- If the author asks to revise or adjust this pending proposal (e.g., "把刚才生成的第三个选项改得委婉一点", "再加一个分支", "修改第二句台词"):`,
    `  Do NOT assume these nodes exist in the Story yet. Instead, incorporate the requested adjustments into the operations and return the COMPLETE updated transaction based on Story revision ${currentStoryRevision}.`,
  );

  return lines.join('\n');
}

/**
 * Builds the complete multi-turn context enhancement block.
 */
export function buildMultiTurnContextBlock(params: MultiTurnContextParams): string {
  const sections: string[] = [];

  const selectionBlock = formatSelectedNodesDetails(params.selectedNodes ?? [], params.characters ?? []);
  if (selectionBlock) {
    sections.push(selectionBlock);
  }

  const proposalBlock = formatPendingProposalState(params.pendingProposal, params.currentStoryRevision);
  if (proposalBlock) {
    sections.push(proposalBlock);
  }

  sections.push(
    [
      'MULTI-TURN PRONOUN & ORDINAL RESOLUTION RULES:',
      '1. Ordinal References: When the author refers to "第一个/第一句" (1st), "第二个/第二句" (2nd), "第三个/第三句" (3rd), "最后一个" (last):',
      '   - If referring to options (选项): Map to the 1-based index in the Choice node\'s options array from ACTIVE SELECTION DETAILS or CURRENT PROPOSAL STATE.',
      '   - If referring to lines (台词): Map to the 1-based index in the Dialogue node\'s lines array from ACTIVE SELECTION DETAILS or CURRENT PROPOSAL STATE.',
      '2. Pronoun References: "刚才选中的" / "当前节点" refers to ACTIVE SELECTION DETAILS. "刚才生成的" refers to CURRENT PROPOSAL STATE.',
      '3. Granular Updates: When modifying existing elements in already-applied Story nodes:',
      '   - To alter an existing choice option, use operation "update-choice-option" with target optionId.',
      '   - To alter an existing dialogue line, use operation "update-dialogue-line" with target lineId.',
      '   - Do NOT delete and recreate the entire node when only modifying a single line or option.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}
