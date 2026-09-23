import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  buildMultiTurnContextBlock,
  formatPendingProposalState,
  formatSelectedNodesDetails,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  type BlueprintCommandTransaction,
  type CharacterSource,
  type StorySourceDocument,
} from '../packages/common/src';

const sampleHero: CharacterSource = {
  id: 'c_hero',
  name: 'lin_xiao',
  displayName: '林萧',
  description: '一名见习侦探。',
  emotions: {},
};

const sampleRival: CharacterSource = {
  id: 'c_rival',
  name: 'ye_lan',
  displayName: '叶岚',
  description: '神秘情报商人。',
  emotions: {},
};

function baseStoryWithChoiceAndDialogue(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_multi_turn_test',
    name: 'multi-turn-test',
    displayName: 'Multi-turn Test',
    variables: [],
    characters: [sampleHero, sampleRival],
    assets: [],
    events: [],
    signals: [],
    chapters: [],
    root: {
      nodes: [
        {
          id: 'n_start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: { title: 'Start' },
        },
        {
          id: 'n_dialogue_1',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_d01',
                textId: 't_d01',
                speakerId: 'c_rival',
                emotion: '狡黠',
                text: { source: '你终于还是来了，比我预想的要早五分钟。' },
              },
              {
                id: 'ln_d02',
                textId: 't_d02',
                speakerId: 'c_hero',
                emotion: '平静',
                text: { source: '我们直接谈正事吧，名单在哪里？' },
              },
            ],
          },
        },
        {
          id: 'n_choice_1',
          type: StoryNodeType.Choice,
          definitionVersion: 1,
          position: { x: 450, y: 0 },
          data: {
            prompt: { source: '面对叶岚抛出的条件，你的抉择是：' },
            options: [
              { id: 'o_opt_1', text: { source: '同意合作，共享情报' } },
              { id: 'o_opt_2', text: { source: '断然拒绝，拔枪相对' } },
              { id: 'o_opt_3', text: { source: '你别得寸进尺，把条件收回去！' } },
            ],
          },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_dialogue_1', portId: 'in' } },
        { from: { nodeId: 'n_dialogue_1', portId: 'out' }, to: { nodeId: 'n_choice_1', portId: 'in' } },
      ],
    },
  };
}

describe('Multi-Turn Context & Reference Resolution', () => {
  it('formats selected Choice node options with 1-based order and exact IDs', () => {
    const selected = [
      {
        id: 'n_choice_1',
        type: StoryNodeType.Choice,
        data: {
          prompt: { source: '面对叶岚抛出的条件，你的抉择是：' },
          options: [
            { id: 'o_opt_1', text: { source: '同意合作，共享情报' } },
            { id: 'o_opt_2', text: { source: '断然拒绝，拔枪相对' } },
            { id: 'o_opt_3', text: { source: '你别得寸进尺，把条件收回去！' } },
          ],
        },
      },
    ];

    const formatted = formatSelectedNodesDetails(selected, [sampleHero, sampleRival]);

    expect(formatted).toContain('ACTIVE SELECTION DETAILS');
    expect(formatted).toContain('Selected Node 1: ID "n_choice_1" (Type: choice)');
    expect(formatted).toContain('Choice Prompt: "面对叶岚抛出的条件，你的抉择是："');
    expect(formatted).toContain('Option 1 [ID: "o_opt_1"]: "同意合作，共享情报"');
    expect(formatted).toContain('Option 2 [ID: "o_opt_2"]: "断然拒绝，拔枪相对"');
    expect(formatted).toContain('Option 3 [ID: "o_opt_3"]: "你别得寸进尺，把条件收回去！"');
  });

  it('formats selected Dialogue node lines with 1-based line index, character names and emotions', () => {
    const selected = [
      {
        id: 'n_dialogue_1',
        type: StoryNodeType.Dialogue,
        data: {
          lines: [
            {
              id: 'ln_d01',
              speakerId: 'c_rival',
              emotion: '狡黠',
              text: { source: '你终于还是来了，比我预想的要早五分钟。' },
            },
            {
              id: 'ln_d02',
              speakerId: 'c_hero',
              emotion: '平静',
              text: { source: '我们直接谈正事吧，名单在哪里？' },
            },
          ],
        },
      },
    ];

    const formatted = formatSelectedNodesDetails(selected, [sampleHero, sampleRival]);

    expect(formatted).toContain('Selected Node 1: ID "n_dialogue_1" (Type: dialogue)');
    expect(formatted).toContain('Line 1 [ID: "ln_d01", Speaker: 叶岚, Emotion: "狡黠"]: "你终于还是来了，比我预想的要早五分钟。"');
    expect(formatted).toContain('Line 2 [ID: "ln_d02", Speaker: 林萧, Emotion: "平静"]: "我们直接谈正事吧，名单在哪里？"');
  });

  it('formats pending unapplied proposal state and follow-up guidance', () => {
    const pendingTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: 'rev_123',
      operations: [
        {
          operationId: 'op_add_choice',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_ai_choice',
            type: StoryNodeType.Choice,
            data: {
              prompt: { source: '下一步动作' },
              options: [
                { id: 'o_a1', text: { source: '调查现场' } },
                { id: 'o_a2', text: { source: '尾随目标' } },
                { id: 'o_a3', text: { source: '强行突击' } },
              ],
            },
          },
        },
      ],
    };

    const formatted = formatPendingProposalState(pendingTx, 'rev_123');

    expect(formatted).toContain('CURRENT PROPOSAL STATE (Awaiting Author Review):');
    expect(formatted).toContain('Status: Unapplied proposal is in PREVIEW (not yet applied to Story revision rev_123)');
    expect(formatted).toContain('Op 1: add-node [ID: "n_ai_choice", Type: choice]');
    expect(formatted).toContain('Option 1 [ID: "o_a1"]: "调查现场"');
    expect(formatted).toContain('Option 2 [ID: "o_a2"]: "尾随目标"');
    expect(formatted).toContain('Option 3 [ID: "o_a3"]: "强行突击"');
    expect(formatted).toContain('Do NOT assume these nodes exist in the Story yet. Instead, incorporate the requested adjustments into the operations and return the COMPLETE updated transaction');
  });

  it('formats committed state when no pending proposal exists', () => {
    const formatted = formatPendingProposalState(null, 'rev_committed_456');
    expect(formatted).toContain('There is NO unapplied preview proposal pending. All previous transactions have been applied to Story revision rev_committed_456');
  });

  it('builds full multi-turn context block with pronoun and ordinal resolution rules', () => {
    const block = buildMultiTurnContextBlock({
      selectedNodes: [
        {
          id: 'n_choice_1',
          type: StoryNodeType.Choice,
          data: {
            options: [
              { id: 'o_opt_1', text: { source: '合作' } },
              { id: 'o_opt_2', text: { source: '拒绝' } },
              { id: 'o_opt_3', text: { source: '强硬施压' } },
            ],
          },
        },
      ],
      characters: [sampleHero],
      pendingProposal: null,
      currentStoryRevision: 'rev_test_789',
    });

    expect(block).toContain('ACTIVE SELECTION DETAILS');
    expect(block).toContain('Option 3 [ID: "o_opt_3"]: "强硬施压"');
    expect(block).toContain('MULTI-TURN PRONOUN & ORDINAL RESOLUTION RULES:');
    expect(block).toContain('1. Ordinal References: When the author refers to "第一个/第一句" (1st), "第二个/第二句" (2nd), "第三个/第三句" (3rd)');
    expect(block).toContain('To alter an existing choice option, use operation "update-choice-option" with target optionId.');
    expect(block).toContain('To alter an existing dialogue line, use operation "update-dialogue-line" with target lineId.');
  });
});

describe('Execution of Multi-Turn Follow-up Transactions', () => {
  it('executes a follow-up request: "把刚才选中的第三个选项改得更委婉一些"', () => {
    const doc = baseStoryWithChoiceAndDialogue();
    const baseRevision = createStorySemanticSnapshot(doc).revision;

    // Follow-up: User asks "把刚才选中的第三个选项改得更委婉一些"
    // With ACTIVE SELECTION DETAILS, AI resolves "第三个选项" -> option 3 -> ID "o_opt_3" on node "n_choice_1"
    const followUpTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'soften-option-3',
          kind: 'update-choice-option',
          graph: { kind: 'root' },
          nodeId: 'n_choice_1',
          optionId: 'o_opt_3',
          patch: {
            text: '换个条件吧，这个要求实在有些强人所难。',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, followUpTx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const choiceNode = result.document.root.nodes.find((n) => n.id === 'n_choice_1');
    const options = (choiceNode?.data as any)?.options;
    expect(options).toHaveLength(3);
    expect(options[0]).toMatchObject({ id: 'o_opt_1', text: { source: '同意合作，共享情报' } });
    expect(options[1]).toMatchObject({ id: 'o_opt_2', text: { source: '断然拒绝，拔枪相对' } });
    // Option 3 was softened successfully!
    expect(options[2]).toMatchObject({ id: 'o_opt_3', text: { source: '换个条件吧，这个要求实在有些强人所难。' } });
  });

  it('executes a follow-up request: "把第二句台词改成警惕的语气"', () => {
    const doc = baseStoryWithChoiceAndDialogue();
    const baseRevision = createStorySemanticSnapshot(doc).revision;

    // Follow-up: "把第二句台词改成警惕的语气" -> line 2 -> ID "ln_d2" on node "n_dialogue_1"
    const followUpTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'tune-line-2-emotion',
          kind: 'update-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_dialogue_1',
          lineId: 'ln_d02',
          patch: {
            emotion: '警惕',
            text: '名单到底在谁手里？别兜圈子了。',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, followUpTx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dialogueNode = result.document.root.nodes.find((n) => n.id === 'n_dialogue_1');
    const lines = (dialogueNode?.data as any)?.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].id).toBe('ln_d01');
    expect(lines[1]).toMatchObject({
      id: 'ln_d02',
      emotion: '警惕',
      text: { source: '名单到底在谁手里？别兜圈子了。' },
    });
  });

  it('adjusts an unapplied pending proposal when author refines generated choices', () => {
    const doc = baseStoryWithChoiceAndDialogue();
    const baseRevision = createStorySemanticSnapshot(doc).revision;

    // Turn 1 generated a pending choice node
    // Turn 2: Author says "把生成的第2个选项换成中立观望，并增加第4个选项"
    // Since it was unapplied, AI returns the revised full transaction based on baseRevision
    const revisedTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'add-refined-choice',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_refined_choice',
            type: StoryNodeType.Choice,
            data: {
              prompt: { source: '权衡利弊后的决定：' },
              options: [
                { id: 'o_r1', text: { source: '欣然同意' } },
                { id: 'o_r2', text: { source: '暂不表态，静观其变' } }, // revised 2nd option
                { id: 'o_r3', text: { source: '强行逼供' } },
                { id: 'o_r4', text: { source: '提出反制方案' } }, // new 4th option
              ],
            },
          },
        },
        {
          operationId: 'connect-choice-to-start',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_refined_choice', portId: 'in' },
          replaceExisting: true,
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, revisedTx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const node = result.document.root.nodes.find((n) => n.id === 'n_refined_choice');
    expect(node).toBeDefined();
    const options = (node?.data as any)?.options;
    expect(options).toHaveLength(4);
    expect(options[1].text.source).toBe('暂不表态，静观其变');
    expect(options[3].text.source).toBe('提出反制方案');
  });
});
