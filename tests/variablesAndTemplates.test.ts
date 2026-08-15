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
  StoryRuntime,
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
  it('resolves qualified character fields to stable variable IDs', () => {
    const field: VariableDefinition = {
      id: 'v_aliceaffinity',
      name: 'affinity',
      displayName: 'Affinity',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    };
    const expression = compileExpression(
      'Alice.affinity >= 10',
      [field],
      [
        {
          id: 'c_alice',
          name: 'Alice',
          displayName: 'Alice',
          emotions: {},
          fields: [field],
        },
      ],
    );
    expect(expression).toMatchObject({
      kind: 'binary',
      left: { kind: 'variable', variableId: 'v_aliceaffinity' },
    });
    expect(evaluateExpression(expression, () => 12)).toBe(true);
  });

  it('compiles and evaluates safe boolean expressions', () => {
    const expression = compileExpression('gold >= 3 && playerName != ""', variables);
    expect(evaluateExpression(expression, (id) => (id === 'v_gold' ? 5 : 'Arys'))).toBe(true);
  });

  it('coerces scalar values when concatenating with a string', () => {
    const expression = compileExpression('"Gold: " + gold', variables);
    expect(evaluateExpression(expression, (id) => (id === 'v_gold' ? 5 : 'Arys'))).toBe('Gold: 5');
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
            data: {
              lines: [
                {
                  id: 'ln_hello',
                  textId: 't_hello',
                  text: { source: 'Hello {playerName}' },
                },
              ],
            },
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

  it('runs dialogue, variable mutation, branch, choice, and end as a resumable state machine', () => {
    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_runtime',
      name: 'runtime',
      displayName: 'Runtime',
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
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
          {
            id: 'n_setx',
            type: StoryNodeType.SetVariable,
            definitionVersion: 1,
            position: { x: 1, y: 0 },
            data: { variableId: 'v_gold', value: { source: 'gold + 7', bindings: {} } },
          },
          {
            id: 'n_check',
            type: StoryNodeType.Branch,
            definitionVersion: 1,
            position: { x: 2, y: 0 },
            data: { condition: { source: 'gold >= 10', bindings: {} } },
          },
          {
            id: 'n_talkx',
            type: StoryNodeType.Dialogue,
            definitionVersion: 1,
            position: { x: 3, y: 0 },
            data: {
              lines: [{ id: 'ln_goldx', textId: 't_goldx', text: { source: 'Gold: {gold}' } }],
            },
          },
          {
            id: 'n_pickx',
            type: StoryNodeType.Choice,
            definitionVersion: 1,
            position: { x: 4, y: 0 },
            data: {
              prompt: { source: 'Continue?' },
              options: [{ id: 'o_yesx', text: { source: 'Yes' } }],
            },
          },
          {
            id: 'n_endxx',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 5, y: 0 },
            data: { title: 'End' },
          },
        ],
        edges: [
          { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_setx', portId: 'in' } },
          { from: { nodeId: 'n_setx', portId: 'out' }, to: { nodeId: 'n_check', portId: 'in' } },
          { from: { nodeId: 'n_check', portId: 'true' }, to: { nodeId: 'n_talkx', portId: 'in' } },
          { from: { nodeId: 'n_check', portId: 'false' }, to: { nodeId: 'n_endxx', portId: 'in' } },
          { from: { nodeId: 'n_talkx', portId: 'out' }, to: { nodeId: 'n_pickx', portId: 'in' } },
          {
            from: { nodeId: 'n_pickx', portId: 'o_yesx' },
            to: { nodeId: 'n_endxx', portId: 'in' },
          },
        ],
      },
    };
    const compiled = compileStory(source, { contentVersion: 'test-runtime' });
    expect(
      compiled.ok,
      compiled.ok ? undefined : JSON.stringify(compiled.diagnostics, null, 2),
    ).toBe(true);
    if (!compiled.ok) return;

    const runtime = new StoryRuntime(compiled.program);
    const dialogue = runtime.runUntilPause();
    expect(dialogue.kind).toBe('waiting');
    if (dialogue.kind !== 'waiting' || dialogue.interaction.kind !== 'dialogue') return;
    expect(dialogue.interaction.request.defaultText).toBe('Gold: 10');
    expect(dialogue.state.storyVariables.v_gold).toBe(10);

    const choice = runtime.continueDialogue();
    expect(choice.kind).toBe('waiting');
    if (choice.kind !== 'waiting' || choice.interaction.kind !== 'choice') return;
    expect(choice.interaction.request.defaultPrompt).toBe('Continue?');
    expect(choice.interaction.request.options[0]?.defaultText).toBe('Yes');

    const restored = new StoryRuntime(compiled.program, JSON.parse(JSON.stringify(choice.state)));
    const restoredChoice = restored.runUntilPause();
    expect(restoredChoice.kind === 'waiting' && restoredChoice.interaction.kind).toBe('choice');
    expect(restored.state.storyVariables.v_gold).toBe(10);
    const completed = restored.choose('o_yesx');
    expect(completed.kind).toBe('completed');
    expect(completed.state.status).toBe('completed');
  });
});
