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
});
