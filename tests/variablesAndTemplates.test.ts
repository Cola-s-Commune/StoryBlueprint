import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type StorySourceDocument,
  type VariableDefinition,
} from '../packages/common/src';
import { compileExpression, compileStory, compileTextTemplate } from '../packages/compiler/src';
import {
  evaluateExpression,
  renderTextTemplate,
  resolveChoiceOptions,
} from '../packages/runtime/src';

const variables: VariableDefinition[] = [
  {
    id: 'v_gold',
    name: 'gold',
    displayName: 'Gold',
    scope: 'story',
    valueType: { kind: 'number' },
    defaultValue: 3,
  },
  {
    id: 'v_name',
    name: 'playerName',
    displayName: 'Player Name',
    scope: 'story',
    valueType: { kind: 'string' },
    defaultValue: 'Player',
  },
];

describe('variables and templates', () => {
  it('compiles and evaluates safe boolean expressions', () => {
    const expression = compileExpression('gold >= 3 && playerName != ""', variables);
    expect(evaluateExpression(expression, (id) => (id === 'v_gold' ? 5 : 'Arys'))).toBe(true);
  });

  it('renders template expressions and escaped braces', () => {
    const template = compileTextTemplate(
      'Hello {playerName}, gold: {gold + 2}. {{ok}}',
      't_test',
      variables,
    );
    expect(renderTextTemplate(template, (id) => (id === 'v_gold' ? 5 : 'Arys'))).toBe(
      'Hello Arys, gold: 7. {ok}',
    );
  });

  it('filters and disables choice options independently', () => {
    const text = compileTextTemplate('Buy for {gold}', 't_buyx', variables);
    const choice = {
      id: 'i_choice',
      op: 'choice' as const,
      options: [
        {
          id: 'o_buyx',
          text,
          visibleIf: compileExpression('gold > 0', variables),
          enabledIf: compileExpression('gold >= 10', variables),
          target: 'b_endx',
        },
      ],
    };
    expect(resolveChoiceOptions(choice, () => 5)).toEqual([
      { id: 'o_buyx', text: 'Buy for 5', enabled: false, target: 'b_endx' },
    ]);
  });

  it('lowers a variable story graph without editor coordinates or node IDs', () => {
    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_test',
      name: 'test',
      displayName: 'Test',
      variables,
      characters: [],
      assets: [],
      events: [],
      chapters: [],
      root: {
        nodes: [
          {
            id: 'n_start',
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 10, y: 20 },
            data: { title: 'Start' },
          },
          {
            id: 'n_talk',
            type: StoryNodeType.Dialogue,
            definitionVersion: 1,
            position: { x: 30, y: 40 },
            data: { text: { source: 'Hello {playerName}' } },
          },
          {
            id: 'n_endx',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 50, y: 60 },
            data: { title: 'End' },
          },
        ],
        edges: [
          {
            from: { nodeId: 'n_start', portId: 'out' },
            to: { nodeId: 'n_talk', portId: 'in' },
          },
          {
            from: { nodeId: 'n_talk', portId: 'out' },
            to: { nodeId: 'n_endx', portId: 'in' },
          },
        ],
      },
    };
    const result = compileStory(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result.program);
    expect(json).not.toContain('position');
    expect(json).not.toContain('n_start');
    expect(json).toContain('playerName');
  });
});
