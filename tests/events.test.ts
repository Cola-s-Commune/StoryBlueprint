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

function eventStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_events',
    name: 'events',
    displayName: 'Events',
    variables: [
      {
        id: 'v_score',
        name: 'score',
        displayName: 'Score',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 4,
      },
    ],
    characters: [],
    assets: [],
    events: [
      {
        id: 'ev_reward',
        name: 'grantReward',
        displayName: 'Grant Reward',
        parameters: [
          { name: 'amount', valueType: { kind: 'number' } },
          { name: 'message', valueType: { kind: 'string' } },
        ],
        resumable: true,
        sideEffect: 'write',
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
          id: 'n_event',
          type: StoryNodeType.CallEvent,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            eventId: 'ev_reward',
            arguments: {
              amount: { source: 'score + 1', bindings: {} },
              message: { source: '"Treasure"', bindings: {} },
            },
          },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 400, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_event', portId: 'in' },
        },
        {
          from: { nodeId: 'n_event', portId: 'out' },
          to: { nodeId: 'n_end', portId: 'in' },
        },
      ],
    },
  };
}

describe('project events', () => {
  it('round-trips Call Event nodes through Story KDL', () => {
    const source = eventStory();
    const serialized = serializeStorySource({ ...source, events: [] });
    const parsed = parseStorySource(serialized);
    expect(parsed.root.nodes.find((node) => node.id === 'n_event')?.data).toEqual(
      source.root.nodes.find((node) => node.id === 'n_event')?.data,
    );
  });

  it('compiles evaluated arguments and continues after dispatch', () => {
    const compiled = compileStory(eventStory());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const waiting = runtime.runUntilPause();
    expect(waiting.kind).toBe('waiting');
    if (waiting.kind !== 'waiting') return;
    expect(waiting.interaction).toEqual({
      kind: 'event',
      request: {
        requestId: 'i_event_main',
        eventId: 'ev_reward',
        arguments: { amount: 5, message: 'Treasure' },
      },
    });
    expect(runtime.continueEvent().kind).toBe('completed');
  });

  it('diagnoses missing event arguments', () => {
    const source = eventStory();
    const node = source.root.nodes.find((candidate) => candidate.id === 'n_event')!;
    const broken = {
      ...source,
      root: {
        ...source.root,
        nodes: source.root.nodes.map((candidate) =>
          candidate === node
            ? { ...candidate, data: { ...candidate.data, arguments: {} } }
            : candidate,
        ),
      },
    };
    const compiled = compileStory(broken);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes('amount'))).toBe(
      true,
    );
  });

  it('invokes the engine adapter and resumes automatically', async () => {
    const compiled = compileStory(eventStory());
    if (!compiled.ok) throw new Error('Expected event story to compile');
    const calls: unknown[] = [];
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async (request) => {
        calls.push(request);
      },
      waitForSignal: async () => undefined,
      resolveText: async () => undefined,
      readExternalVariable: async () => null,
      writeExternalVariable: async () => undefined,
    };
    const result = await runStoryWithAdapter(
      new StoryRuntime(compiled.program),
      adapter,
      new AbortController().signal,
    );
    expect(result.kind).toBe('completed');
    expect(calls).toMatchObject([
      { eventId: 'ev_reward', arguments: { amount: 5, message: 'Treasure' } },
    ]);
  });

  it('waits for signals and consumes signals that arrived early', () => {
    const source = eventStory();
    const signalId = 'sig_continue' as const;
    const withSignal: StorySourceDocument = {
      ...source,
      signals: [{ id: signalId, name: 'continue', displayName: 'Continue' }],
      root: {
        nodes: [
          ...source.root.nodes.filter((node) => node.id !== 'n_end'),
          {
            id: 'n_wait',
            type: StoryNodeType.WaitSignal,
            definitionVersion: 1,
            position: { x: 400, y: 0 },
            data: { signalId },
          },
          source.root.nodes.find((node) => node.id === 'n_end')!,
        ],
        edges: [
          ...source.root.edges.filter((edge) => edge.from.nodeId !== 'n_event'),
          { from: { nodeId: 'n_event', portId: 'out' }, to: { nodeId: 'n_wait', portId: 'in' } },
          { from: { nodeId: 'n_wait', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
        ],
      },
    };
    const compiled = compileStory(withSignal);
    if (!compiled.ok) throw new Error('Expected signal story to compile');

    const runtime = new StoryRuntime(compiled.program);
    const event = runtime.runUntilPause();
    expect(event.kind === 'waiting' && event.interaction.kind).toBe('event');
    const waiting = runtime.continueEvent();
    expect(waiting.kind === 'waiting' && waiting.interaction.kind).toBe('signal');
    expect(runtime.sendSignal(signalId)?.kind).toBe('completed');

    const earlyRuntime = new StoryRuntime(compiled.program);
    expect(earlyRuntime.sendSignal(signalId)).toBeUndefined();
    const restoredRuntime = new StoryRuntime(compiled.program, earlyRuntime.state);
    restoredRuntime.runUntilPause();
    expect(restoredRuntime.continueEvent().kind).toBe('completed');
  });
});
