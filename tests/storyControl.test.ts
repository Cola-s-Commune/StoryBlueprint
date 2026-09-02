import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';
import { runStoryWithAdapter, StoryRuntime, type StoryAdapter } from '../packages/runtime/src';

function sourceWithControl(
  type: StoryNodeType.StartStory | StoryNodeType.EndStoryInstance,
): StorySourceDocument {
  const control =
    type === StoryNodeType.StartStory
      ? {
          id: 'n_control',
          type,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            storyId: 's_target',
            instanceId: { source: '"instance-1"', bindings: {} },
            arguments: {},
            resultVariableIds: {},
            instanceVariableId: 'v_instance',
          },
        }
      : {
          id: 'n_control',
          type,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            instanceId: { source: '"instance-1"', bindings: {} },
            resultVariableIds: {},
          },
        };
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_source',
    name: 'source',
    displayName: 'Source',
    variables: [
      {
        id: 'v_instance',
        name: 'instance',
        displayName: 'Instance',
        scope: 'story',
        valueType: { kind: 'string' },
        defaultValue: '',
      },
    ],
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
        control,
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 400, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_control', portId: 'in' } },
        { from: { nodeId: 'n_control', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
      ],
    },
  };
}

function adapter(controlStory: StoryAdapter['controlStory']): StoryAdapter {
  return {
    showDialogue: async () => undefined,
    showChoice: async () => 'o_unused',
    callEvent: async () => ({}),
    waitForSignal: async () => ({}),
    controlStory,
    resolveText: async () => undefined,
    readExternalVariable: async () => null,
    writeExternalVariable: async () => undefined,
  };
}

describe('Story Control', () => {
  it('serializes and parses independent Story control nodes', () => {
    const source = sourceWithControl(StoryNodeType.StartStory);
    expect(serializeStorySource(parseStorySource(serializeStorySource(source)))).toBe(
      serializeStorySource(source),
    );
  });

  it('dispatches Start Story through the Adapter and continues', async () => {
    const compiled = compileStory(sourceWithControl(StoryNodeType.StartStory), {
      availableStoryIds: ['s_target'],
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const requests: unknown[] = [];
    const result = await runStoryWithAdapter(
      new StoryRuntime(compiled.program),
      adapter(async (request) => {
        requests.push(request);
        return { instanceId: 'generated-1' };
      }),
      new AbortController().signal,
    );
    expect(result.kind).toBe('completed');
    expect(requests).toMatchObject([
      { action: 'start', storyId: 's_target', instanceId: 'instance-1', arguments: {} },
    ]);
    if (result.kind === 'completed')
      expect(result.state.storyVariables.v_instance).toBe('generated-1');
  });

  it('dispatches End Story Instance and continues the current Story', async () => {
    const compiled = compileStory(sourceWithControl(StoryNodeType.EndStoryInstance));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const requests: unknown[] = [];
    const result = await runStoryWithAdapter(
      new StoryRuntime(compiled.program),
      adapter(async (request) => {
        requests.push(request);
        return {};
      }),
      new AbortController().signal,
    );
    expect(result.kind).toBe('completed');
    expect(requests).toMatchObject([{ action: 'end', instanceId: 'instance-1', arguments: {} }]);
  });
});
