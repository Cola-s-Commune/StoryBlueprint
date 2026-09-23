import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  nodeRegistry,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
  type VariableDefinition,
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

  it('extracts selection with incoming and outgoing data wires, connects parameters and return values, and executes correctly', () => {
    const visibleVariables: VariableDefinition[] = [
      {
        id: 'v_input',
        name: 'input_value',
        displayName: 'Input Value',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 42,
      },
      {
        id: 'v_inner',
        name: 'inner_temp',
        displayName: 'Inner Temp',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
      {
        id: 'v_output',
        name: 'output_value',
        displayName: 'Output Value',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];

    const candidateGraph: EditorGraphState = {
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
          id: 'n_get_x',
          type: StoryNodeType.GetVariable,
          definitionVersion: 1,
          position: { x: 0, y: 150 },
          data: { variableId: 'v_input' },
          selected: false,
        },
        {
          id: 'n_inner_set',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 300, y: 0 },
          data: { variableId: 'v_inner', value: { source: '0' } },
          selected: true,
        },
        {
          id: 'n_inner_get',
          type: StoryNodeType.GetVariable,
          definitionVersion: 1,
          position: { x: 300, y: 150 },
          data: { variableId: 'v_inner' },
          selected: true,
        },
        {
          id: 'n_inner_talk',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 550, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_extract',
                textId: 't_extract',
                text: { source: 'Inside extracted substory' },
              },
            ],
          },
          selected: true,
        },
        {
          id: 'n_set_y',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 800, y: 0 },
          data: { variableId: 'v_output', value: { source: '0' } },
          selected: false,
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 1050, y: 0 },
          data: { title: 'End' },
          selected: false,
        },
      ],
      edges: [
        {
          id: 'e_s1',
          source: 'n_start',
          sourceHandle: 'out',
          target: 'n_inner_set',
          targetHandle: 'in',
        },
        {
          id: 'e_s2',
          source: 'n_inner_set',
          sourceHandle: 'out',
          target: 'n_inner_talk',
          targetHandle: 'in',
        },
        {
          id: 'e_s3',
          source: 'n_inner_talk',
          sourceHandle: 'out',
          target: 'n_set_y',
          targetHandle: 'in',
        },
        {
          id: 'e_s4',
          source: 'n_set_y',
          sourceHandle: 'out',
          target: 'n_end',
          targetHandle: 'in',
        },
        {
          id: 'e_data_in',
          source: 'n_get_x',
          sourceHandle: 'value',
          target: 'n_inner_set',
          targetHandle: 'value',
        },
        {
          id: 'e_data_out',
          source: 'n_inner_get',
          sourceHandle: 'value',
          target: 'n_set_y',
          targetHandle: 'value',
        },
      ],
    };

    const extracted = extractSelectionToSubstory(candidateGraph, 'ch_data_extract', {
      visibleVariables,
    });
    expect(extracted.ok, extracted.ok ? undefined : extracted.message).toBe(true);
    if (!extracted.ok) return;

    expect(extracted.parameters).toHaveLength(1);
    expect(extracted.parameters[0].direction).toBe('input');
    expect(extracted.parameters[0].variable.valueType).toEqual({ kind: 'number' });

    expect(extracted.outputs).toHaveLength(1);
    expect(extracted.outputs[0].direction).toBe('output');
    expect(extracted.outputs[0].variable.valueType).toEqual({ kind: 'number' });

    const paramId = extracted.parameters[0].variable.id;
    const outputId = extracted.outputs[0].variable.id;
    const substoryGetVar = extracted.chapterGraph.nodes.find(
      (node) =>
        node.type === StoryNodeType.GetVariable &&
        (node.data as { variableId?: string }).variableId === paramId,
    );
    expect(substoryGetVar).toBeDefined();

    const returnNode = extracted.chapterGraph.nodes.find(
      (node) => node.type === StoryNodeType.Return,
    );
    expect(returnNode).toBeDefined();
    expect((returnNode?.data as { valueInputTypes?: unknown }).valueInputTypes).toEqual({
      [outputId]: { kind: 'number' },
    });

    expect(
      extracted.chapterGraph.edges.some(
        (edge) =>
          edge.source === substoryGetVar?.id &&
          edge.sourceHandle === 'value' &&
          edge.target === 'n_inner_set' &&
          edge.targetHandle === 'value',
      ),
    ).toBe(true);

    expect(
      extracted.chapterGraph.edges.some(
        (edge) =>
          edge.source === 'n_inner_get' &&
          edge.sourceHandle === 'value' &&
          edge.target === returnNode?.id &&
          edge.targetHandle === `value:${outputId}`,
      ),
    ).toBe(true);

    const callNode = extracted.remainingGraph.nodes.find(
      (node) => node.type === StoryNodeType.CallSubstory,
    );
    expect(callNode).toBeDefined();
    expect((callNode?.data as { outputPorts?: unknown[] }).outputPorts).toEqual([
      { id: outputId, label: extracted.outputs[0].variable.displayName, valueType: { kind: 'number' } },
    ]);
    expect((callNode?.data as { argumentInputTypes?: unknown }).argumentInputTypes).toEqual({
      [paramId]: { kind: 'number' },
    });

    expect(
      extracted.remainingGraph.edges.some(
        (edge) =>
          edge.source === 'n_get_x' &&
          edge.sourceHandle === 'value' &&
          edge.target === callNode?.id &&
          edge.targetHandle === `argument:${paramId}`,
      ),
    ).toBe(true);

    expect(
      extracted.remainingGraph.edges.some(
        (edge) =>
          edge.source === callNode?.id &&
          edge.sourceHandle === `output:${outputId}` &&
          edge.target === 'n_set_y' &&
          edge.targetHandle === 'value',
      ),
    ).toBe(true);

    const source: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_data_extract',
      name: 'data_extract',
      displayName: 'Data Extract Test',
      root: toSourceGraph(extracted.remainingGraph),
      chapters: [
        {
          id: 'ch_data_extract',
          name: 'data_extract_ch',
          displayName: 'Data Extract Chapter',
          parameters: extracted.parameters,
          outputs: extracted.outputs,
          localVariables: [],
          graph: toSourceGraph(extracted.chapterGraph),
        },
      ],
      variables: visibleVariables,
      characters: [],
      assets: [],
      events: [],
    };

    const serialized = serializeStorySource(source);
    const parsed = parseStorySource(serialized);
    const compiled = compileStory(parsed, { contentVersion: 'data-extract-test' });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;

    const runtime = new StoryRuntime(compiled.program);
    const dialogue = runtime.runUntilPause();
    expect(dialogue.kind).toBe('waiting');
    if (dialogue.kind === 'waiting' && dialogue.interaction.kind === 'dialogue') {
      expect(dialogue.interaction.request.defaultText).toBe('Inside extracted substory');
    }

    const completed = runtime.continueDialogue();
    expect(completed.kind).toBe('completed');
    expect(completed.state.storyVariables.v_inner).toBe(42);
    expect(completed.state.storyVariables.v_output).toBe(42);
  });

  it('groups incoming data wires from the same external source into a single substory parameter', () => {
    const visibleVariables: VariableDefinition[] = [
      {
        id: 'v_input',
        name: 'shared_input',
        displayName: 'Shared Input',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 99,
      },
      {
        id: 'v_a',
        name: 'a',
        displayName: 'A',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
      {
        id: 'v_b',
        name: 'b',
        displayName: 'B',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];

    const candidateGraph: EditorGraphState = {
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
          id: 'n_get_x',
          type: StoryNodeType.GetVariable,
          definitionVersion: 1,
          position: { x: 0, y: 150 },
          data: { variableId: 'v_input' },
          selected: false,
        },
        {
          id: 'n_set_a',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 300, y: 0 },
          data: { variableId: 'v_a', value: { source: '0' } },
          selected: true,
        },
        {
          id: 'n_set_b',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 550, y: 0 },
          data: { variableId: 'v_b', value: { source: '0' } },
          selected: true,
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 800, y: 0 },
          data: { title: 'End' },
          selected: false,
        },
      ],
      edges: [
        {
          id: 'e_s1',
          source: 'n_start',
          sourceHandle: 'out',
          target: 'n_set_a',
          targetHandle: 'in',
        },
        {
          id: 'e_s2',
          source: 'n_set_a',
          sourceHandle: 'out',
          target: 'n_set_b',
          targetHandle: 'in',
        },
        {
          id: 'e_s3',
          source: 'n_set_b',
          sourceHandle: 'out',
          target: 'n_end',
          targetHandle: 'in',
        },
        // Two incoming data edges from the SAME external source n_get_x
        {
          id: 'e_data_1',
          source: 'n_get_x',
          sourceHandle: 'value',
          target: 'n_set_a',
          targetHandle: 'value',
        },
        {
          id: 'e_data_2',
          source: 'n_get_x',
          sourceHandle: 'value',
          target: 'n_set_b',
          targetHandle: 'value',
        },
      ],
    };

    const extracted = extractSelectionToSubstory(candidateGraph, 'ch_shared_extract', {
      visibleVariables,
    });
    expect(extracted.ok, extracted.ok ? undefined : extracted.message).toBe(true);
    if (!extracted.ok) return;

    // Must have exactly 1 parameter shared by both internal targets
    expect(extracted.parameters).toHaveLength(1);
    expect(extracted.parameters[0].variable.name).toBe('shared_input_1');

    // Inside substory: exactly 1 GetVariable node, connected to BOTH n_set_a and n_set_b
    const getVarNodes = extracted.chapterGraph.nodes.filter(
      (node) => node.type === StoryNodeType.GetVariable,
    );
    expect(getVarNodes).toHaveLength(1);
    const getVarId = getVarNodes[0].id;
    expect(
      extracted.chapterGraph.edges.some(
        (e) => e.source === getVarId && e.target === 'n_set_a' && e.targetHandle === 'value',
      ),
    ).toBe(true);
    expect(
      extracted.chapterGraph.edges.some(
        (e) => e.source === getVarId && e.target === 'n_set_b' && e.targetHandle === 'value',
      ),
    ).toBe(true);

    // Outside: exactly 1 edge from n_get_x to CallSubstory
    const callInputEdges = extracted.remainingGraph.edges.filter(
      (e) => e.source === 'n_get_x' && e.targetHandle.startsWith('argument:'),
    );
    expect(callInputEdges).toHaveLength(1);
  });
});
