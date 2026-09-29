import { describe, it, expect } from 'vitest';
import {
  type StorySemanticSnapshot,
  StoryNodeType,
} from '@story-blueprint/common';
import {
  prepareHarnessPrompt,
  getHarnessResponseSchema,
  processHarnessResponse,
  SMALL_MODEL_RESPONSE_SCHEMA,
  AI_ASSISTANT_RESPONSE_SCHEMA,
} from '../packages/editor/src/renderer/ai/harness/aiCommandsHarness';

function createMockSnapshot(): StorySemanticSnapshot {
  return {
    format: 'story-blueprint-semantic-snapshot',
    version: '0.1.0',
    storyId: 'story-test',
    revision: 'rev_1',
    variables: [],
    characters: [
      { id: 'c_alice', name: 'Alice', displayName: '爱丽丝' },
      { id: 'c_bob', name: 'Bob', displayName: '鲍勃' },
    ],
    graphs: [
      {
        kind: 'root',
        nodes: [
          {
            id: 'n_dialogue_1',
            type: StoryNodeType.Dialogue,
            name: 'Dialogue',
            ports: [],
            data: {
              lines: [
                { id: 'ln_1', speakerId: 'c_alice', text: { source: '你好世界' } },
              ],
            },
          },
        ],
        connections: [],
      },
    ],
  };
}

describe('aiCommandsHarness', () => {
  it('prepares small model prompt when isSmallModel is true or mode is not auto', () => {
    const promptAutoSmall = prepareHarnessPrompt({
      mode: 'auto',
      isSmallModel: true,
      revision: 'rev_1',
      buildFullContextPrompt: () => 'FULL CONTEXT',
    });
    expect(promptAutoSmall).toContain('轻量增强模式');
    expect(promptAutoSmall).toContain('当前版本号: rev_1');

    const promptDirect = prepareHarnessPrompt({
      mode: 'direct',
      isSmallModel: false,
      revision: 'rev_1',
      buildFullContextPrompt: () => 'FULL CONTEXT',
    });
    expect(promptDirect).toContain('【当前工作模式：直接编辑蓝图】');

    const promptInk = prepareHarnessPrompt({
      mode: 'ink',
      isSmallModel: false,
      revision: 'rev_1',
      buildFullContextPrompt: () => 'FULL CONTEXT',
    });
    expect(promptInk).toContain('【当前工作模式：Ink 剧本转换与创作】');

    const promptLargeAuto = prepareHarnessPrompt({
      mode: 'auto',
      isSmallModel: false,
      revision: 'rev_1',
      buildFullContextPrompt: () => 'FULL CONTEXT LARGE',
    });
    expect(promptLargeAuto).toBe('FULL CONTEXT LARGE');
  });

  it('selects response schemas appropriately', () => {
    expect(getHarnessResponseSchema(true, 'auto')).toBe(SMALL_MODEL_RESPONSE_SCHEMA);
    expect(getHarnessResponseSchema(false, 'direct')).toBe(SMALL_MODEL_RESPONSE_SCHEMA);
    expect(getHarnessResponseSchema(false, 'ink')).toBe(SMALL_MODEL_RESPONSE_SCHEMA);
    expect(getHarnessResponseSchema(false, 'auto')).toBe(AI_ASSISTANT_RESPONSE_SCHEMA);
  });

  it('processes compact actions in direct mode', () => {
    const snapshot = createMockSnapshot();
    const mockDryRun = (tx: any) => ({ ok: true, diagnostics: [], snapshot });

    const rawResponse = JSON.stringify({
      reply: '已修改第1句台词',
      actions: [
        { type: 'update_line', lineIndex: 1, text: '你好宇宙！' },
      ],
    });

    const result = processHarnessResponse({
      mode: 'direct',
      responseContent: rawResponse,
      modelName: 'qwen2.5:14b',
      semanticSnapshot: snapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: snapshot.characters,
      dryRunTransaction: mockDryRun as any,
    });

    expect(result.sourceMode).toBe('direct_actions');
    expect(result.hasProposal).toBe(true);
    expect(result.reply).toBe('已修改第1句台词');
    expect(result.transaction?.operations.length).toBe(1);
    expect(result.status).toContain('1 项变更');
  });

  it('processes ink scripts in ink mode', () => {
    const snapshot = createMockSnapshot();
    const mockDryRun = (tx: any) => ({ ok: true, diagnostics: [], snapshot });

    const rawResponse = [
      '好的，为你编写了后续剧情：',
      '```ink',
      '爱丽丝: 准备好了吗？',
      '鲍勃: 随时可以出发。',
      '* [立即出发] -> go_now',
      '* [再等等] -> wait_a_bit',
      '```',
    ].join('\n');

    const result = processHarnessResponse({
      mode: 'ink',
      responseContent: rawResponse,
      modelName: 'qwen2.5:8b',
      semanticSnapshot: snapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: snapshot.characters,
      dryRunTransaction: mockDryRun as any,
    });

    expect(result.sourceMode).toBe('ink_script');
    expect(result.hasProposal).toBe(true);
    expect(result.transaction).toBeDefined();
    expect(result.status).toContain('Ink 剧本已自动编译为蓝图节点');
  });

  it('supports self-healing cross-mode responses (e.g. actions in ink mode or ink in direct mode)', () => {
    const snapshot = createMockSnapshot();
    const mockDryRun = (tx: any) => ({ ok: true, diagnostics: [], snapshot });

    // ink received in direct mode
    const inkInDirect = processHarnessResponse({
      mode: 'direct',
      responseContent: '```ink\n爱丽丝: 忽然说了新台词\n```',
      semanticSnapshot: snapshot,
      selectedNodeIds: [],
      characters: snapshot.characters,
      dryRunTransaction: mockDryRun as any,
    });
    expect(inkInDirect.sourceMode).toBe('ink_script');
    expect(inkInDirect.hasProposal).toBe(true);

    // actions received in ink mode
    const actionsInInk = processHarnessResponse({
      mode: 'ink',
      responseContent: JSON.stringify({
        reply: '帮您修改了台词',
        actions: [{ type: 'update_line', lineIndex: 1, text: '改动' }],
      }),
      semanticSnapshot: snapshot,
      selectedNodeIds: ['n_dialogue_1'],
      characters: snapshot.characters,
      dryRunTransaction: mockDryRun as any,
    });
    expect(actionsInInk.sourceMode).toBe('direct_actions');
    expect(actionsInInk.hasProposal).toBe(true);
  });

  it('handles standard conversational response without proposals', () => {
    const snapshot = createMockSnapshot();
    const mockDryRun = (tx: any) => ({ ok: true, diagnostics: [], snapshot });

    const result = processHarnessResponse({
      mode: 'auto',
      responseContent: '这个故事很有趣，爱丽丝的人物动机非常鲜明。',
      semanticSnapshot: snapshot,
      selectedNodeIds: [],
      dryRunTransaction: mockDryRun as any,
    });

    expect(result.sourceMode).toBe('conversation');
    expect(result.hasProposal).toBe(false);
    expect(result.reply).toContain('这个故事很有趣');
  });
});
