import { describe, expect, it } from 'vitest';
import {
  findConditionReferenceCycle,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryFormatError,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';

function conditionStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_conditions',
    name: 'conditions',
    displayName: 'Conditions',
    variables: [
      {
        id: 'v_gold',
        name: 'gold',
        displayName: 'Gold',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 5,
      },
    ],
    characters: [],
    assets: [],
    events: [],
    conditions: [
      {
        id: 'cond_has_gold',
        name: 'hasGold',
        displayName: 'Has Gold',
        description: 'The player can afford the item.',
        root: {
          kind: 'expression',
          expression: { source: 'gold >= 1', bindings: { gold: 'v_gold' } },
        },
      },
      {
        id: 'cond_can_buy',
        name: 'canBuy',
        displayName: 'Can Buy',
        root: {
          kind: 'all',
          children: [
            { kind: 'reference', conditionId: 'cond_has_gold' },
            {
              kind: 'not',
              child: {
                kind: 'expression',
                expression: { source: 'gold == 0', bindings: { gold: 'v_gold' } },
              },
            },
          ],
        },
      },
    ],
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
          id: 'n_branch',
          type: StoryNodeType.Branch,
          definitionVersion: 1,
          position: { x: 240, y: 0 },
          data: { condition: { source: 'true', bindings: {} }, conditionId: 'cond_can_buy' },
        },
        {
          id: 'n_true',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 480, y: -80 },
          data: { title: 'Bought' },
        },
        {
          id: 'n_false',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 480, y: 80 },
          data: { title: 'Not enough' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_branch', portId: 'in' } },
        { from: { nodeId: 'n_branch', portId: 'true' }, to: { nodeId: 'n_true', portId: 'in' } },
        { from: { nodeId: 'n_branch', portId: 'false' }, to: { nodeId: 'n_false', portId: 'in' } },
      ],
    },
  };
}

describe('Condition resources', () => {
  it('reports the complete path for reusable condition reference cycles', () => {
    const conditions = [
      {
        id: 'cond_a',
        name: 'a',
        displayName: 'A',
        root: { kind: 'reference' as const, conditionId: 'cond_b' },
      },
      {
        id: 'cond_b',
        name: 'b',
        displayName: 'B',
        root: { kind: 'reference' as const, conditionId: 'cond_a' },
      },
    ];
    expect(findConditionReferenceCycle(conditions)).toEqual(['cond_a', 'cond_b', 'cond_a']);
  });

  it('round-trips condition trees and Branch references in KDL', () => {
    const source = conditionStory();
    const serialized = serializeStorySource(source);
    expect(serialized).toContain('conditions');
    expect(serialized).toContain('condition-ref=cond_can_buy');
    expect(parseStorySource(serialized).conditions).toEqual(source.conditions);
  });

  it('round-trips reusable condition references on Choice options', () => {
    const source = conditionStory();
    source.root = {
      ...source.root,
      nodes: [
        ...source.root.nodes,
        {
          id: 'n_choice',
          type: StoryNodeType.Choice,
          definitionVersion: 1,
          position: { x: 720, y: 0 },
          data: {
            prompt: { source: 'Choose', bindings: {} },
            options: [
              {
                id: 'o_buy',
                text: { source: 'Buy', bindings: {} },
                visibleConditionId: 'cond_can_buy',
                enabledConditionId: 'cond_has_gold',
              },
            ],
          },
        },
      ],
    };
    const parsed = parseStorySource(serializeStorySource(source));
    const option = (
      parsed.root.nodes.find((node) => node.id === 'n_choice')?.data as {
        options: readonly {
          visibleConditionId?: string;
          enabledConditionId?: string;
        }[];
      }
    ).options[0];
    expect(option).toMatchObject({
      visibleConditionId: 'cond_can_buy',
      enabledConditionId: 'cond_has_gold',
    });

    const choiceGraph = {
      ...source.root,
      nodes: [
        source.root.nodes[0]!,
        {
          id: 'n_choice_runtime',
          type: StoryNodeType.Choice,
          definitionVersion: 1,
          position: { x: 240, y: 0 },
          data: {
            prompt: { source: 'Choose', bindings: {} },
            options: [
              {
                id: 'o_runtime',
                text: { source: 'Buy', bindings: {} },
                visibleConditionId: 'cond_can_buy',
              },
            ],
          },
        },
        {
          id: 'n_choice_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 480, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_choice_runtime', portId: 'in' },
        },
        {
          from: { nodeId: 'n_choice_runtime', portId: 'o_runtime' },
          to: { nodeId: 'n_choice_end', portId: 'in' },
        },
      ],
    };
    const compiled = compileStory({ ...source, root: choiceGraph });
    expect(compiled.ok, compiled.ok ? undefined : compiled.diagnostics).toBe(true);
  });

  it('compiles a referenced condition tree to a boolean expression', () => {
    const result = compileStory(conditionStory());
    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    const branch = Object.values(result.program.blocks)
      .flatMap((block) => block.instructions)
      .find((instruction) => instruction.op === 'branch');
    expect(branch).toMatchObject({
      op: 'branch',
      condition: {
        kind: 'binary',
        operator: 'and',
        valueType: { kind: 'boolean' },
      },
    });
  });

  it('rejects missing and cyclic condition references before compile', () => {
    const missing = conditionStory();
    missing.conditions![0] = {
      ...missing.conditions![0]!,
      root: { kind: 'reference', conditionId: 'cond_missing' },
    };
    expect(() => serializeStorySource(missing)).toThrow(StoryFormatError);

    const cyclic = conditionStory();
    cyclic.conditions = [
      {
        id: 'cond_a',
        name: 'a',
        displayName: 'A',
        root: { kind: 'reference', conditionId: 'cond_b' },
      },
      {
        id: 'cond_b',
        name: 'b',
        displayName: 'B',
        root: { kind: 'reference', conditionId: 'cond_a' },
      },
    ];
    expect(() => serializeStorySource(cyclic)).toThrow(/Condition cycle detected/);
  });
});
