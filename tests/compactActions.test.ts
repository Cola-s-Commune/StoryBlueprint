import { describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  compileCompactActionsToTransaction,
  extractCompactActionsFromMarkdown,
  buildSmallModelPrompt,
  type CompactBlueprintAction,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import { parseAIAssistantResponse } from '../packages/editor/src/shared/aiProvider';

describe('Compact Actions for 8B/14B Small Models', () => {
  const dummySnapshot: StorySemanticSnapshot = {
    revision: 'rev_123',
    variables: [
      {
        id: 'v_affinity' as any,
        name: '好感度',
        displayName: '好感度',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ],
    characters: [
      {
        id: 'c_alice' as any,
        name: 'alice',
        displayName: '艾丽丝',
        emotions: {},
      },
      {
        id: 'c_bob' as any,
        name: 'bob',
        displayName: '鲍勃',
        emotions: {},
      },
    ],
    assets: [],
    events: [],
    signals: [],
    graphs: [
      {
        kind: 'root',
        nodes: [
          {
            id: 'n_dialogue_1' as any,
            type: StoryNodeType.Dialogue,
            name: '开场对话',
            data: {
              lines: [
                {
                  id: 'ln_1' as any,
                  textId: 't_1' as any,
                  text: { source: '今天天气真好。' },
                  speakerId: 'c_alice' as any,
                },
                {
                  id: 'ln_2' as any,
                  textId: 't_2' as any,
                  text: { source: '是啊，准备出发吧。' },
                  speakerId: 'c_bob' as any,
                },
              ],
            },
          },
          {
            id: 'n_choice_1' as any,
            type: StoryNodeType.Choice,
            name: '分支选择',
            data: {
              prompt: { source: '去哪里？' },
              options: [
                { id: 'o_1' as any, text: { source: '森林' } },
                { id: 'o_2' as any, text: { source: '城堡' } },
              ],
            },
          },
        ],
        connections: [],
      },
    ],
  };

  it('compiles update_line action using 1-based line index', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'update_line',
        nodeId: 'n_dialogue_1',
        lineIndex: 2,
        text: '等等，前面好像有动静！',
        emotion: 'shocked',
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: dummySnapshot.characters,
    });

    expect(transaction.format).toBe('story-blueprint-commands');
    expect(transaction.baseRevision).toBe('rev_123');
    expect(transaction.operations).toHaveLength(1);
    const op = transaction.operations[0] as any;
    expect(op.kind).toBe('update-dialogue-line');
    expect(op.nodeId).toBe('n_dialogue_1');
    expect(op.lineId).toBe('ln_2');
    expect(op.patch.text).toBe('等等，前面好像有动静！');
    expect(op.patch.emotion).toBe('shocked');
  });

  it('compiles append_line and resolves speaker by displayName', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'append_line',
        nodeId: 'n_dialogue_1',
        speaker: '艾丽丝',
        text: '小心点！',
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: dummySnapshot.characters,
    });

    expect(transaction.operations).toHaveLength(1);
    const op = transaction.operations[0] as any;
    expect(op.kind).toBe('add-dialogue-line');
    expect(op.nodeId).toBe('n_dialogue_1');
    expect(op.line.text).toBe('小心点！');
    expect(op.line.speakerId).toBe('c_alice');
    expect(op.line.id).toMatch(/^ln_/);
  });

  it('auto-creates new character if speaker is unknown', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'append_line',
        nodeId: 'n_dialogue_1',
        speaker: '神秘人',
        text: '你们逃不掉了。',
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: dummySnapshot.characters,
    });

    // Should have add-character and add-dialogue-line
    expect(transaction.operations).toHaveLength(2);
    const charOp = transaction.operations[0] as any;
    expect(charOp.kind).toBe('add-character');
    expect(charOp.character.displayName).toBe('神秘人');
    expect(charOp.character.id).toMatch(/^c_/);

    const lineOp = transaction.operations[1] as any;
    expect(lineOp.kind).toBe('add-dialogue-line');
    expect(lineOp.line.speakerId).toBe(charOp.character.id);
  });

  it('compiles update_choice_option and add_choice_option', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'update_choice_option',
        nodeId: 'n_choice_1',
        optionIndex: 1,
        text: '深入森林内部',
      },
      {
        type: 'add_choice_option',
        nodeId: 'n_choice_1',
        text: '原地待命',
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
      selectedNodeIds: ['n_choice_1'],
    });

    expect(transaction.operations).toHaveLength(2);
    const updateOp = transaction.operations[0] as any;
    expect(updateOp.kind).toBe('update-choice-option');
    expect(updateOp.nodeId).toBe('n_choice_1');
    expect(updateOp.optionId).toBe('o_1');
    expect(updateOp.patch.text).toBe('深入森林内部');

    const addOp = transaction.operations[1] as any;
    expect(addOp.kind).toBe('add-choice-option');
    expect(addOp.nodeId).toBe('n_choice_1');
    expect(addOp.option.text).toBe('原地待命');
    expect(addOp.option.id).toMatch(/^o_/);
  });

  it('compiles append_dialogue with automatic connect to predecessor', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'append_dialogue',
        afterNodeId: 'n_dialogue_1',
        speaker: '艾丽丝',
        text: '我们要勇敢前进！',
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
      characters: dummySnapshot.characters,
    });

    expect(transaction.operations).toHaveLength(2);
    const nodeOp = transaction.operations[0] as any;
    expect(nodeOp.kind).toBe('add-node');
    expect(nodeOp.node.type).toBe('dialogue');
    expect(nodeOp.node.data.lines[0].text.source).toBe('我们要勇敢前进！');
    expect(nodeOp.node.data.lines[0].speakerId).toBe('c_alice');

    const connectOp = transaction.operations[1] as any;
    expect(connectOp.kind).toBe('connect');
    expect(connectOp.from.nodeId).toBe('n_dialogue_1');
    expect(connectOp.to.nodeId).toBe(nodeOp.node.id);
  });

  it('compiles adjust_variable action', () => {
    const actions: CompactBlueprintAction[] = [
      {
        type: 'adjust_variable',
        variable: '好感度',
        delta: 2,
      },
    ];

    const transaction = compileCompactActionsToTransaction(actions, {
      snapshot: dummySnapshot,
    });

    expect(transaction.operations).toHaveLength(1);
    const op = transaction.operations[0] as any;
    expect(op.kind).toBe('add-variable-adjustment');
    expect(op.variableId).toBe('v_affinity');
    expect(op.delta).toBe(2);
  });

  it('extracts compact actions from natural markdown bullet list', () => {
    const markdown = `我建议进行如下微调：
- 修改第2句台词: "小心身后的陷阱！"
- 选项1改为: "悄悄潜行"
- 新增选项: "投掷烟雾弹"
- 好感度增加 3`;

    const actions = extractCompactActionsFromMarkdown(markdown);
    expect(actions).toHaveLength(4);

    expect(actions[0]).toMatchObject({
      type: 'update_line',
      lineIndex: 2,
      text: '小心身后的陷阱！',
    });

    expect(actions[1]).toMatchObject({
      type: 'update_choice_option',
      optionIndex: 1,
      text: '悄悄潜行',
    });

    expect(actions[2]).toMatchObject({
      type: 'add_choice_option',
      text: '投掷烟雾弹',
    });

    expect(actions[3]).toMatchObject({
      type: 'adjust_variable',
      variable: '好感度',
      delta: 3,
    });
  });

  it('parses AI response containing actions field', () => {
    const responseJson = JSON.stringify({
      reply: '已为您修改了第二句台词。',
      actions: [
        {
          type: 'update_line',
          lineIndex: 2,
          text: '我们快撤！',
        },
      ],
    });

    const parsed = parseAIAssistantResponse(responseJson);
    expect(parsed.reply).toBe('已为您修改了第二句台词。');
    expect(parsed.actions).toBeDefined();
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions![0]).toMatchObject({
      type: 'update_line',
      lineIndex: 2,
      text: '我们快撤！',
    });
  });

  it('parses AI response with markdown bullet actions when no json envelope', () => {
    const rawMarkdown = `我已经构思好了调整方案：
- 修改第1句台词: "听着，这是最后的决战了。"
- 选项2改为: "寻找援助"`;

    const parsed = parseAIAssistantResponse(rawMarkdown);
    expect(parsed.actions).toBeDefined();
    expect(parsed.actions).toHaveLength(2);
    expect(parsed.actions![0].text).toBe('听着，这是最后的决战了。');
    expect(parsed.actions![1].text).toBe('寻找援助');
  });

  it('buildSmallModelPrompt constructs ultra-compact prompt without giant schema', () => {
    const prompt = buildSmallModelPrompt({
      revision: 'rev_123',
      selectedNodes: [
        {
          id: 'n_dialogue_1',
          type: StoryNodeType.Dialogue,
          data: dummySnapshot.graphs[0].nodes[0].data,
          title: '开场对话',
        },
      ],
      characters: dummySnapshot.characters,
    });

    expect(prompt).toContain('Story Blueprint AI 创作与修改助手 (轻量增强模式)');
    expect(prompt).toContain('模式 1：剧本创作、剧情续写、分支与改编 (输出 Ink 剧本)');
    expect(prompt).toContain('模式 2：精准修改已有蓝图 (输出 actions 动作)');
    expect(prompt).toContain('艾丽丝 (ID: c_alice)');
    expect(prompt).toContain('今天天气真好。');
    // Ensure huge schema is completely absent
    expect(prompt).not.toContain('BLUEPRINT COMMAND JSON SCHEMA');
    expect(prompt).not.toContain('https://json-schema.org');
  });
});
