import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  nodeRegistry,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';
import { StoryRuntime } from '../packages/runtime/src';
import {
  extractSelectionToSubstory,
  toSourceGraph,
  type EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';

nodeRegistry.registerBuiltins();

function graph(): EditorGraphState {
  return {
    nodes: [
      {
        id: 'n_start',
        type: StoryNodeType.Start,
        definitionVersion: 1,
        position: { x: 0, y: 0 },
        data: { title: 'Start' },
        selected: false,
      },
      {
        id: 'n_talkx',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 300, y: 0 },
        data: {
          lines: [
            {
              id: 'ln_inside',
              textId: 't_inside',
              text: { source: 'Inside substory' },
            },
          ],
        },
        selected: true,
      },
      {
        id: 'n_endxx',
        type: StoryNodeType.End,
        definitionVersion: 1,
        position: { x: 600, y: 0 },
        data: { title: 'End' },
        selected: false,
      },
    ],
    edges: [
      {
        id: 'e_first',
        source: 'n_start',
        sourceHandle: 'out',
        target: 'n_talkx',
        targetHandle: 'in',
      },
      {
        id: 'e_lastx',
        source: 'n_talkx',
        sourceHandle: 'out',
        target: 'n_endxx',
        targetHandle: 'in',
      },
    ],
  };
}

describe('substories', () => {
  it('extracts a selection, round-trips it, compiles it, and returns to the caller', () => {
    const extracted = extractSelectionToSubstory(graph(), 'ch_intro');
    expect(extracted.ok, extracted.ok ? undefined : extracted.message).toBe(true);
    if (!extracted.ok) return;
    expect(
      extracted.remainingGraph.nodes.some((node) => node.type === StoryNodeType.CallSubstory),
    ).toBe(true);
    expect(extracted.chapterGraph.nodes.some((node) => node.type === StoryNodeType.Return)).toBe(
      true,
    );

    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_substory',
      name: 'substory',
      displayName: 'Substory Test',
      root: toSourceGraph(extracted.remainingGraph),
      chapters: [
        {
          id: 'ch_intro',
          name: 'intro',
          displayName: 'Intro',
          parameters: [],
          outputs: [],
          localVariables: [],
          graph: toSourceGraph(extracted.chapterGraph),
        },
      ],
      variables: [],
      characters: [],
      assets: [],
      events: [],
    };
    const serialized = serializeStorySource(source);
    const parsed = parseStorySource(serialized);
    expect(parsed.chapters[0]?.displayName).toBe('Intro');
    expect(serializeStorySource(parsed)).toBe(serialized);

    const compiled = compileStory(parsed, { contentVersion: 'substory-test' });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const dialogue = runtime.runUntilPause();
    expect(dialogue.kind).toBe('waiting');
    if (dialogue.kind !== 'waiting' || dialogue.interaction.kind !== 'dialogue') return;
    expect(dialogue.interaction.request.defaultText).toBe('Inside substory');
    expect(dialogue.state.callStack).toHaveLength(1);
    const completed = runtime.continueDialogue();
    expect(completed.kind).toBe('completed');
    expect(completed.state.callStack).toHaveLength(0);
  });

  it('rejects selections with multiple control-flow exits', () => {
    const candidate = graph();
    candidate.edges.push({
      id: 'e_extra',
      source: 'n_talkx',
      sourceHandle: 'out-extra',
      target: 'n_endxx',
      targetHandle: 'in',
    });
    const extracted = extractSelectionToSubstory(candidate, 'ch_multi');
    expect(extracted).toMatchObject({ ok: false });
  });

  it('round-trips parameters, locals, and a return value through the runtime', () => {
    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_interface',
      name: 'interface',
      displayName: 'Substory Interface',
      root: {
        nodes: [
          {
            id: 'n_root_start',
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
          {
            id: 'n_root_call',
            type: StoryNodeType.CallSubstory,
            definitionVersion: 1,
            position: { x: 300, y: 0 },
            data: {
              chapterId: 'ch_math',
              arguments: { v_input: { source: '7', bindings: {} } },
              resultVariableIds: { v_math_result: 'v_result', v_math_label: 'v_label' },
            },
          },
          {
            id: 'n_root_endx',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 600, y: 0 },
            data: { title: 'End' },
          },
        ],
        edges: [
          {
            from: { nodeId: 'n_root_start', portId: 'out' },
            to: { nodeId: 'n_root_call', portId: 'in' },
          },
          {
            from: { nodeId: 'n_root_call', portId: 'out' },
            to: { nodeId: 'n_root_endx', portId: 'in' },
          },
        ],
      },
      chapters: [
        {
          id: 'ch_math',
          name: 'math',
          displayName: 'Math',
          parameters: [
            {
              direction: 'input',
              variable: {
                id: 'v_input',
                name: 'input',
                displayName: 'Input',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 1,
              },
            },
          ],
          outputs: [
            {
              direction: 'output',
              variable: {
                id: 'v_math_result',
                name: 'result',
                displayName: 'Result',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 0,
              },
            },
            {
              direction: 'output',
              variable: {
                id: 'v_math_label',
                name: 'label',
                displayName: 'Label',
                scope: 'local',
                valueType: { kind: 'string' },
                defaultValue: '',
              },
            },
          ],
          localVariables: [
            {
              id: 'v_local',
              name: 'local',
              displayName: 'Local',
              scope: 'local',
              valueType: { kind: 'number' },
              defaultValue: 0,
            },
          ],
          graph: {
            nodes: [
              {
                id: 'n_math_start',
                type: StoryNodeType.Start,
                definitionVersion: 1,
                position: { x: 0, y: 0 },
                data: { title: 'Start' },
              },
              {
                id: 'n_math_setx',
                type: StoryNodeType.SetVariable,
                definitionVersion: 1,
                position: { x: 300, y: 0 },
                data: {
                  variableId: 'v_local',
                  value: { source: 'input + 2', bindings: { input: 'v_input' } },
                },
              },
              {
                id: 'n_math_return',
                type: StoryNodeType.Return,
                definitionVersion: 1,
                position: { x: 600, y: 0 },
                data: {
                  values: {
                    v_math_result: { source: 'local', bindings: { local: 'v_local' } },
                    v_math_label: { source: '"done"', bindings: {} },
                  },
                },
              },
            ],
            edges: [
              {
                from: { nodeId: 'n_math_start', portId: 'out' },
                to: { nodeId: 'n_math_setx', portId: 'in' },
              },
              {
                from: { nodeId: 'n_math_setx', portId: 'out' },
                to: { nodeId: 'n_math_return', portId: 'in' },
              },
            ],
          },
        },
      ],
      variables: [
        {
          id: 'v_result',
          name: 'result',
          displayName: 'Result',
          scope: 'story',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
        {
          id: 'v_label',
          name: 'label',
          displayName: 'Label',
          scope: 'story',
          valueType: { kind: 'string' },
          defaultValue: '',
        },
      ],
      characters: [],
      assets: [],
      events: [],
    };

    const serialized = serializeStorySource(source);
    expect(serialized).toContain('parameter v_input');
    expect(serialized).toContain('output v_math_result');
    expect(serialized).toContain('output v_math_label');
    const parsed = parseStorySource(serialized);
    expect(parsed.chapters[0]?.parameters[0]?.variable.defaultValue).toBe(1);
    expect(parsed.chapters[0]?.localVariables[0]?.name).toBe('local');
    expect(serializeStorySource(parsed)).toBe(serialized);

    const compiled = compileStory(parsed, { contentVersion: 'interface-test' });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const completed = new StoryRuntime(compiled.program).runUntilPause();
    expect(completed.kind).toBe('completed');
    expect(completed.state.storyVariables.v_result).toBe(9);
    expect(completed.state.storyVariables.v_label).toBe('done');
    expect(completed.state.callStack).toHaveLength(0);
  });

  it('uses connected values for substory inputs, returns, and caller outputs', () => {
    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_data_pins',
      name: 'data_pins',
      displayName: 'Substory Data Pins',
      root: {
        nodes: [
          {
            id: 'n_pins_start',
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
          {
            id: 'n_pins_read',
            type: StoryNodeType.GetVariable,
            definitionVersion: 1,
            position: { x: 100, y: 160 },
            data: { variableId: 'v_pins_input' },
          },
          {
            id: 'n_pins_call',
            type: StoryNodeType.CallSubstory,
            definitionVersion: 1,
            position: { x: 300, y: 0 },
            data: {
              chapterId: 'ch_pins',
              arguments: { v_pins_parameter: { source: '2', bindings: {} } },
              argumentInputTypes: { v_pins_parameter: { kind: 'number' } },
              outputPorts: [
                { id: 'v_pins_output', label: 'Output', valueType: { kind: 'number' } },
              ],
              resultVariableIds: {},
            },
          },
          {
            id: 'n_pins_set',
            type: StoryNodeType.SetVariable,
            definitionVersion: 1,
            position: { x: 600, y: 0 },
            data: {
              variableId: 'v_pins_result',
              value: { source: '0', bindings: {} },
              valueInputType: { kind: 'number' },
            },
          },
          {
            id: 'n_pins_end',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 900, y: 0 },
            data: { title: 'End' },
          },
        ],
        edges: [
          {
            from: { nodeId: 'n_pins_start', portId: 'out' },
            to: { nodeId: 'n_pins_call', portId: 'in' },
          },
          {
            from: { nodeId: 'n_pins_read', portId: 'value' },
            to: { nodeId: 'n_pins_call', portId: 'argument:v_pins_parameter' },
          },
          {
            from: { nodeId: 'n_pins_call', portId: 'out' },
            to: { nodeId: 'n_pins_set', portId: 'in' },
          },
          {
            from: { nodeId: 'n_pins_call', portId: 'output:v_pins_output' },
            to: { nodeId: 'n_pins_set', portId: 'value' },
          },
          {
            from: { nodeId: 'n_pins_set', portId: 'out' },
            to: { nodeId: 'n_pins_end', portId: 'in' },
          },
        ],
      },
      chapters: [
        {
          id: 'ch_pins',
          name: 'pins',
          displayName: 'Pins',
          parameters: [
            {
              direction: 'input',
              variable: {
                id: 'v_pins_parameter',
                name: 'parameter',
                displayName: 'Parameter',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 1,
              },
            },
          ],
          outputs: [
            {
              direction: 'output',
              variable: {
                id: 'v_pins_output',
                name: 'output',
                displayName: 'Output',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 0,
              },
            },
          ],
          localVariables: [],
          graph: {
            nodes: [
              {
                id: 'n_pins_chapter_start',
                type: StoryNodeType.Start,
                definitionVersion: 1,
                position: { x: 0, y: 0 },
                data: { title: 'Start' },
              },
              {
                id: 'n_pins_chapter_read',
                type: StoryNodeType.GetVariable,
                definitionVersion: 1,
                position: { x: 100, y: 160 },
                data: { variableId: 'v_pins_parameter' },
              },
              {
                id: 'n_pins_return',
                type: StoryNodeType.Return,
                definitionVersion: 1,
                position: { x: 300, y: 0 },
                data: {
                  values: { v_pins_output: { source: '0', bindings: {} } },
                  valueInputTypes: { v_pins_output: { kind: 'number' } },
                },
              },
            ],
            edges: [
              {
                from: { nodeId: 'n_pins_chapter_start', portId: 'out' },
                to: { nodeId: 'n_pins_return', portId: 'in' },
              },
              {
                from: { nodeId: 'n_pins_chapter_read', portId: 'value' },
                to: { nodeId: 'n_pins_return', portId: 'value:v_pins_output' },
              },
            ],
          },
        },
      ],
      variables: [
        {
          id: 'v_pins_input',
          name: 'input',
          displayName: 'Input',
          scope: 'story',
          valueType: { kind: 'number' },
          defaultValue: 7,
        },
        {
          id: 'v_pins_result',
          name: 'result',
          displayName: 'Result',
          scope: 'story',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      characters: [],
      assets: [],
      events: [],
    };

    const serialized = serializeStorySource(source);
    expect(serialized).toContain('argument-input-types');
    expect(serialized).toContain('value-input-types');
    expect(serialized).toContain('output-port v_pins_output');
    const parsed = parseStorySource(serialized);
    const call = parsed.root.nodes.find((node) => node.id === 'n_pins_call');
    const returned = parsed.chapters[0]?.graph.nodes.find((node) => node.id === 'n_pins_return');
    expect((call?.data as { outputPorts?: unknown }).outputPorts).toHaveLength(1);
    expect((returned?.data as { valueInputTypes?: unknown }).valueInputTypes).toEqual({
      v_pins_output: { kind: 'number' },
    });

    const compiled = compileStory(parsed, { contentVersion: 'substory-data-pins' });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const completed = new StoryRuntime(compiled.program).runUntilPause();
    expect(completed.kind).toBe('completed');
    expect(completed.state.storyVariables.v_pins_result).toBe(7);
    expect(completed.state.substoryOutputs).toEqual({
      i_pins_call_main: { v_pins_output: 7 },
    });
    expect(() => new StoryRuntime(compiled.program, completed.state)).not.toThrow();

    const mismatched = structuredClone(source);
    const input = mismatched.variables.find((variable) => variable.id === 'v_pins_input')!;
    input.valueType = { kind: 'string' };
    input.defaultValue = 'seven';
    const invalid = compileStory(mismatched, { contentVersion: 'substory-data-pins-invalid' });
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EXPRESSION_ERROR',
          sourceNodeId: 'n_pins_call',
          message: expect.stringContaining('Substory argument parameter must be number'),
        }),
      ]),
    );
  });
});
