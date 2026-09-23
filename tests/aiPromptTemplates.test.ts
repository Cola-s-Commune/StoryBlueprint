import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  buildDialogueContinuationPrompt,
  buildBranchSuggestionPrompt,
  buildDialoguePolishPrompt,
  buildScriptAdaptationPrompt,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  type BlueprintCommandTransaction,
  type CharacterPromptContext,
  type StorySourceDocument,
} from '../packages/common/src';

const sampleHero: CharacterPromptContext = {
  id: 'c_hero',
  name: 'lin_xiao',
  displayName: '林萧',
  description: '一名性格沉着、内心敏锐的见习侦探。',
  dialogueStyle: '语速平缓，逻辑严密，很少使用感叹号。',
  tags: ['冷静', '推理', '外冷内热'],
  emotions: ['自然', '沉思', '警惕', '微笑'],
};

const sampleRival: CharacterPromptContext = {
  id: 'c_rival',
  name: 'ye_lan',
  displayName: '叶岚',
  description: '神秘的情报商人，说话带有戏谑与试探。',
  dialogueStyle: '轻佻、富有幽默感、喜欢设问句。',
  tags: ['神秘', '敏捷', '谜团'],
  emotions: ['狡黠', '嘲弄', '认真'],
};

function baseStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_ai_prompt_test',
    name: 'ai-prompt-test',
    displayName: 'AI Prompt Test',
    variables: [],
    characters: [
      {
        id: 'c_hero',
        name: 'lin_xiao',
        displayName: '林萧',
        description: '一名性格沉着、内心敏锐的见习侦探。',
        dialogueStyle: '语速平缓，逻辑严密，很少使用感叹号。',
        tags: ['冷静', '推理', '外冷内热'],
        emotions: {},
      },
      {
        id: 'c_rival',
        name: 'ye_lan',
        displayName: '叶岚',
        description: '神秘的情报商人，说话带有戏谑与试探。',
        dialogueStyle: '轻佻、富有幽默感、喜欢设问句。',
        tags: ['神秘', '敏捷', '谜团'],
        emotions: {},
      },
    ],
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
          position: { x: 100, y: 100 },
          data: { title: 'Start' },
        },
        {
          id: 'n_prev_dialogue',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 300, y: 100 },
          data: {
            lines: [
              {
                id: 'ln_init',
                textId: 't_init',
                speakerId: 'c_rival',
                text: { source: '你终于还是来了，比我预想的要早五分钟。' },
              },
            ],
          },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_prev_dialogue', portId: 'in' },
        },
      ],
    },
  };
}

describe('AI Dialogue and Branch Prompt Generators', () => {
  it('builds a single speaker dialogue continuation prompt with character voice and auto-connect', () => {
    const prompt = buildDialogueContinuationPrompt({
      targetCharacter: sampleHero,
      speakerMode: 'single',
      emotion: '警惕',
      toneOrDirection: '直截了当地质问对方昨夜在钟楼留下的密信内容。',
      lineCount: 3,
      sourceNode: {
        id: 'n_prev_dialogue',
        type: StoryNodeType.Dialogue,
        speakerName: '叶岚',
        text: '你终于还是来了，比我预想的要早五分钟。',
      },
      autoConnect: true,
    });

    expect(prompt).toContain('TASK: Generate continuation dialogue in the root graph.');
    expect(prompt).toContain('PRIMARY SPEAKER: 林萧 (lin_xiao, ID: c_hero)');
    expect(prompt).toContain('Speaking Style: "语速平缓，逻辑严密，很少使用感叹号。"');
    expect(prompt).toContain('Personality Tags: [冷静, 推理, 外冷内热]');
    expect(prompt).toContain('EMOTION: 警惕');
    expect(prompt).toContain('NARRATIVE DIRECTION & TONE: 直截了当地质问对方昨夜在钟楼留下的密信内容。');
    expect(prompt).toContain('LENGTH: Generate approximately 3 lines');
    expect(prompt).toContain('CONTINUE AFTER NODE: "n_prev_dialogue"');
    expect(prompt).toContain('Connect predecessor node "n_prev_dialogue" port "out" to the new Dialogue node port "in"');
  });

  it('builds an alternating two-character dialogue prompt', () => {
    const prompt = buildDialogueContinuationPrompt({
      targetCharacter: sampleHero,
      secondCharacter: sampleRival,
      speakerMode: 'alternating',
      toneOrDirection: '就密信的真伪展开交锋，互相试探对方底牌。',
      lineCount: 4,
      sourceNode: {
        id: 'n_prev_dialogue',
        type: StoryNodeType.Dialogue,
      },
      autoConnect: false,
    });

    expect(prompt).toContain('CONVERSATION MODE: Alternating dialogue between two characters:');
    expect(prompt).toContain('1. Primary: 林萧');
    expect(prompt).toContain('2. Interlocutor: 叶岚');
    expect(prompt).toContain('LENGTH: Generate approximately 4 lines');
    expect(prompt).not.toContain('Connect predecessor node');
  });

  it('builds a branch suggestion prompt with dilemma conflict and expanded consequence nodes', () => {
    const prompt = buildBranchSuggestionPrompt({
      sourceNode: {
        id: 'n_prev_dialogue',
        type: StoryNodeType.Dialogue,
        speakerName: '叶岚',
        text: '加入我们，或者继续做你毫无意义的独行侠。',
      },
      choicePrompt: '面对叶岚抛出的橄榄枝，你的选择是...',
      branchCount: 3,
      conflictType: 'rational_vs_impulsive',
      includeConsequenceNodes: true,
      reactingCharacter: sampleRival,
      autoConnect: true,
    });

    expect(prompt).toContain('TASK: Generate an interactive decision branch with 3 distinct options in the root graph.');
    expect(prompt).toContain('CHOICE PROMPT: "面对叶岚抛出的橄榄枝，你的选择是..."');
    expect(prompt).toContain('CONFLICT & CHOICE NATURE: A contrast between a calm, logical approach and an impulsive, passion-driven one.');
    expect(prompt).toContain('EXPAND BRANCH CONSEQUENCES: For each choice option, create a follow-up Dialogue node');
    expect(prompt).toContain('REACTING CHARACTER: 叶岚 (ye_lan, ID: c_rival)');
    expect(prompt).toContain('Add one Choice node (e.g. ID "n_ai_choice_...") with prompt and 3 options');
    expect(prompt).toContain('Connect predecessor node "n_prev_dialogue" port "out" to Choice node port "in"');
    expect(prompt).toContain('Add a "connect" operation from the Choice node port "o_ai_opt_X" to the corresponding Dialogue node port "in"');
  });

  it('builds a dialogue polish prompt for existing lines in character voice', () => {
    const prompt = buildDialoguePolishPrompt({
      lines: [
        { id: 'ln_1', text: '我不相信你，你在撒谎。', speakerName: '林萧' },
        { id: 'ln_2', text: '把证据拿出来看看。', speakerName: '林萧' },
      ],
      targetCharacter: sampleHero,
      targetEmotion: '冷峻',
      polishGoal: 'in_character',
    });

    expect(prompt).toContain('TASK: Polish and rewrite the following dialogue lines');
    expect(prompt).toContain('TARGET CHARACTER VOICE: 林萧 (lin_xiao, ID: c_hero)');
    expect(prompt).toContain('TARGET EMOTION: 冷峻');
    expect(prompt).toContain('POLISH GOAL: Strengthen character persona, speech habits');
    expect(prompt).toContain('- Line ID "ln_1" [林萧]: "我不相信你，你在撒谎。"');
    expect(prompt).toContain('- Line ID "ln_2" [林萧]: "把证据拿出来看看。"');
    expect(prompt).toContain('Propose a Blueprint Command transaction using "update-dialogue-line" operations');
  });

  it('builds a script adaptation prompt with character awareness', () => {
    const prose = `
雨夜。钟楼的秒针沉重跳动。
林萧收起雨伞，注视着站在阴影里的风衣女子。
「你迟到了整整三分钟。」林萧冷冷地开口。
叶岚笑了笑，转动手中的打火机：「但重要的不是时间，而是我带来的消息，对吧？」
`;
    const prompt = buildScriptAdaptationPrompt({
      scriptText: prose,
      knownCharacters: [sampleHero, sampleRival],
      sourceNode: { id: 'n_prev_dialogue', type: StoryNodeType.Dialogue },
      autoConnect: true,
    });

    expect(prompt).toContain('TASK: Adapt the following prose/screenplay script into executable Story Blueprint nodes.');
    expect(prompt).toContain('AVAILABLE CHARACTERS IN STORY');
    expect(prompt).toContain('- 林萧 (lin_xiao, ID: c_hero)');
    expect(prompt).toContain('- 叶岚 (ye_lan, ID: c_rival)');
    expect(prompt).toContain('Split mixed prose into separate Dialogue Lines: Narration lines (without speakerId) vs Spoken lines (with speakerId bound to the character)');
    expect(prompt).toContain('Connect predecessor node "n_prev_dialogue" port "out" to the first adapted node port "in"');
    expect(prompt).toContain('你迟到了整整三分钟');
  });
});

describe('Execution of AI-Generated Dialogue and Branch Transactions', () => {
  it('executes an AI dialogue continuation transaction and binds lines correctly', () => {
    const doc = baseStory();

    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(doc).revision,
      operations: [
        {
          operationId: 'add-hero-dialogue',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_hero_reply',
            type: StoryNodeType.Dialogue,
            data: {
              lines: [
                {
                  id: 'ln_hero_1',
                  textId: 't_hero_1',
                  speakerId: 'c_hero',
                  emotion: '警惕',
                  text: { source: '昨夜钟楼的火漆印，只有你们商会才拿得到。' },
                },
                {
                  id: 'ln_hero_2',
                  textId: 't_hero_2',
                  speakerId: 'c_hero',
                  text: { source: '我来这里不是为了闲聊，把另一半名单交出来。' },
                },
              ],
            },
          },
        },
        {
          operationId: 'connect-prev-to-hero',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_prev_dialogue', portId: 'out' },
          to: { nodeId: 'n_hero_reply', portId: 'in' },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.root.nodes).toHaveLength(3);
    const heroNode = result.document.root.nodes.find((n) => n.id === 'n_hero_reply');
    expect(heroNode).toBeDefined();
    expect(heroNode?.data).toMatchObject({
      lines: [
        {
          id: 'ln_hero_1',
          speakerId: 'c_hero',
          emotion: '警惕',
          text: { source: '昨夜钟楼的火漆印，只有你们商会才拿得到。' },
        },
        {
          id: 'ln_hero_2',
          speakerId: 'c_hero',
          text: { source: '我来这里不是为了闲聊，把另一半名单交出来。' },
        },
      ],
    });

    expect(result.document.root.edges).toContainEqual({
      from: { nodeId: 'n_prev_dialogue', portId: 'out' },
      to: { nodeId: 'n_hero_reply', portId: 'in' },
    });
  });

  it('executes an AI choice branching transaction with consequence nodes', () => {
    const doc = baseStory();

    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(doc).revision,
      operations: [
        // 1. Add Choice Node with 2 options
        {
          operationId: 'add-choice',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_choice_deal',
            type: StoryNodeType.Choice,
            data: {
              prompt: { source: '面对叶岚的提议，你的决断是：' },
              options: [
                { id: 'o_accept', text: { source: '暂且相信她，合作调查。' } },
                { id: 'o_refuse', text: { source: '果断拒绝，拔枪相向。' } },
              ],
            },
          },
        },
        // 2. Connect prev dialogue to choice
        {
          operationId: 'connect-prev-to-choice',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_prev_dialogue', portId: 'out' },
          to: { nodeId: 'n_choice_deal', portId: 'in' },
        },
        // 3. Add Consequence Dialogue Node 1 (Accept)
        {
          operationId: 'add-branch-accept',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_consequence_accept',
            type: StoryNodeType.Dialogue,
            data: {
              lines: [
                {
                  id: 'ln_acc_1',
                  textId: 't_acc_1',
                  speakerId: 'c_rival',
                  emotion: '狡黠',
                  text: { source: '明智的决定。我喜欢和聪明人打交道。' },
                },
              ],
            },
          },
        },
        // 4. Connect choice option 1 to Dialogue Node 1
        {
          operationId: 'connect-opt1-to-accept',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_choice_deal', portId: 'o_accept' },
          to: { nodeId: 'n_consequence_accept', portId: 'in' },
        },
        // 5. Add Consequence Dialogue Node 2 (Refuse)
        {
          operationId: 'add-branch-refuse',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_consequence_refuse',
            type: StoryNodeType.Dialogue,
            data: {
              lines: [
                {
                  id: 'ln_ref_1',
                  textId: 't_ref_1',
                  speakerId: 'c_rival',
                  emotion: '嘲弄',
                  text: { source: '何必这么急躁呢，侦探先生？' },
                },
              ],
            },
          },
        },
        // 6. Connect choice option 2 to Dialogue Node 2
        {
          operationId: 'connect-opt2-to-refuse',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_choice_deal', portId: 'o_refuse' },
          to: { nodeId: 'n_consequence_refuse', portId: 'in' },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify Choice node
    const choiceNode = result.document.root.nodes.find((n) => n.id === 'n_choice_deal');
    expect(choiceNode).toBeDefined();

    // Verify Connections from options to consequence nodes
    expect(result.document.root.edges).toContainEqual({
      from: { nodeId: 'n_prev_dialogue', portId: 'out' },
      to: { nodeId: 'n_choice_deal', portId: 'in' },
    });
    expect(result.document.root.edges).toContainEqual({
      from: { nodeId: 'n_choice_deal', portId: 'o_accept' },
      to: { nodeId: 'n_consequence_accept', portId: 'in' },
    });
    expect(result.document.root.edges).toContainEqual({
      from: { nodeId: 'n_choice_deal', portId: 'o_refuse' },
      to: { nodeId: 'n_consequence_refuse', portId: 'in' },
    });
  });

  it('executes an AI dialogue polish transaction using update-dialogue-line', () => {
    const doc = baseStory();

    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(doc).revision,
      operations: [
        {
          operationId: 'polish-rival-line',
          kind: 'update-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_prev_dialogue',
          lineId: 'ln_init',
          patch: {
            text: '真让我吃惊，侦探先生……你竟然提前了整整五分钟赴约。',
            emotion: '狡黠',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(doc, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const node = result.document.root.nodes.find((n) => n.id === 'n_prev_dialogue');
    expect(node?.data).toMatchObject({
      lines: [
        {
          id: 'ln_init',
          speakerId: 'c_rival',
          emotion: '狡黠',
          text: { source: '真让我吃惊，侦探先生……你竟然提前了整整五分钟赴约。' },
        },
      ],
    });
  });
});
