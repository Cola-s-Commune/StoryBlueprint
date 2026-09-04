import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  runtimeValueMatchesType,
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
      {
        id: 'v_rewardpayload',
        name: 'rewardPayload',
        displayName: 'Reward Payload',
        scope: 'story',
        valueType: { kind: 'json', name: 'RewardPayload' },
        defaultValue: { itemId: 'gold', amount: 3, tags: ['quest'] },
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
          { name: 'payload', valueType: { kind: 'json', name: 'RewardPayload' } },
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
            resultVariableIds: {},
            arguments: {
              amount: { source: 'score + 1', bindings: {} },
              message: { source: '"Treasure"', bindings: {} },
              payload: { source: 'rewardPayload', bindings: {} },
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
  it('supports CharacterRef and AssetRef event contracts as stable IDs', () => {
    const source = eventStory();
    source.characters = [{ id: 'c_hero', name: 'hero', displayName: 'Hero', emotions: {} }];
    source.assets = [{ id: 'a_sword', kind: 'other', name: 'sword', displayName: 'Sword' }];
    source.variables.push({
      id: 'v_hero',
      name: 'heroRef',
      displayName: 'Hero Ref',
      scope: 'story',
      valueType: { kind: 'character-ref' },
      defaultValue: 'c_hero',
    });
    source.events[0] = {
      ...source.events[0]!,
      parameters: [
        { name: 'actor', valueType: { kind: 'character-ref' } },
        { name: 'item', valueType: { kind: 'asset-ref' } },
      ],
      outputs: [
        {
          id: 'evo_actor',
          name: 'actor',
          displayName: 'Actor',
          valueType: { kind: 'character-ref' },
        },
      ],
    };
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      arguments: {
        actor: { source: 'heroRef', bindings: {} },
        item: { source: '"a_sword"', bindings: {} },
      },
      resultVariableIds: { evo_actor: 'v_hero' },
    };
    expect(runtimeValueMatchesType('c_hero', { kind: 'character-ref' })).toBe(true);
    expect(runtimeValueMatchesType('a_sword', { kind: 'asset-ref' })).toBe(true);
    expect(runtimeValueMatchesType('hero', { kind: 'character-ref' })).toBe(false);
    const compiled = compileStory(source);
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const waiting = runtime.runUntilPause();
    expect(waiting.kind).toBe('waiting');
    if (waiting.kind !== 'waiting' || waiting.interaction.kind !== 'event') return;
    expect(waiting.interaction.request.arguments).toEqual({ actor: 'c_hero', item: 'a_sword' });
    expect(runtime.continueEvent({ evo_actor: 'c_hero' }).kind).toBe('completed');
  });

  it('rejects arithmetic and ordered comparisons on resource references', () => {
    const source = eventStory();
    source.variables.push({
      id: 'v_hero',
      name: 'heroRef',
      displayName: 'Hero Ref',
      scope: 'story',
      valueType: { kind: 'character-ref' },
      defaultValue: 'c_hero',
    });
    source.events[0] = {
      ...source.events[0]!,
      parameters: [{ name: 'actor', valueType: { kind: 'character-ref' } }],
    };
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      arguments: { actor: { source: 'heroRef + "x"', bindings: {} } },
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.some((item) => item.message.includes('only support equality')),
    ).toBe(true);
  });

  it('rejects passing a differently named Engine JSON contract', () => {
    const source = eventStory();
    source.variables.push({
      id: 'v_otherpayload',
      name: 'otherPayload',
      displayName: 'Other Payload',
      scope: 'story',
      valueType: { kind: 'json', name: 'UnrelatedPayload' },
      defaultValue: {},
    });
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    (
      eventNode.data as { arguments: Record<string, { source: string; bindings: object }> }
    ).arguments.payload = {
      source: 'otherPayload',
      bindings: {},
    };

    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EXPRESSION_ERROR',
          message: expect.stringContaining('must be RewardPayload'),
        }),
      ]),
    );
  });

  it('passes recursive Struct event arguments and supports Struct member expressions', () => {
    const source = eventStory();
    const payloadType = {
      kind: 'struct' as const,
      name: 'RewardPayload',
      fields: {
        itemId: { kind: 'string' as const },
        amount: { kind: 'number' as const },
        nested: {
          kind: 'struct' as const,
          name: 'NestedReward',
          fields: { bonus: { kind: 'number' as const } },
        },
      },
    };
    source.variables = source.variables.map((variable) =>
      variable.id === 'v_rewardpayload'
        ? {
            ...variable,
            valueType: payloadType,
            defaultValue: { itemId: 'gold', amount: 3, nested: { bonus: 2 } },
          }
        : variable,
    );
    source.events[0] = {
      ...source.events[0]!,
      parameters: [
        { name: 'payload', valueType: payloadType },
        { name: 'bonus', valueType: { kind: 'number' } },
      ],
    };
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      arguments: {
        payload: { source: 'rewardPayload', bindings: {} },
        bonus: { source: 'rewardPayload.nested.bonus', bindings: {} },
      },
    };
    const compiled = compileStory(source);
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const waiting = runtime.runUntilPause();
    expect(waiting.kind).toBe('waiting');
    if (waiting.kind !== 'waiting' || waiting.interaction.kind !== 'event') return;
    expect(waiting.interaction.request.arguments).toEqual({
      payload: { itemId: 'gold', amount: 3, nested: { bonus: 2 } },
      bonus: 2,
    });
  });

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
        arguments: {
          amount: 5,
          message: 'Treasure',
          payload: { itemId: 'gold', amount: 3, tags: ['quest'] },
        },
        outputs: [],
      },
    });
    expect(runtime.continueEvent().kind).toBe('completed');
  });

  it('uses a connected Get Variable value for an event argument', () => {
    const source = eventStory();
    source.root.nodes.push({
      id: 'n_getscore',
      type: StoryNodeType.GetVariable,
      definitionVersion: 1,
      position: { x: 100, y: 100 },
      data: { variableId: 'v_score' },
    });
    source.root.edges.push({
      from: { nodeId: 'n_getscore', portId: 'value' },
      to: { nodeId: 'n_event', portId: 'argument:amount' },
    });
    const compiled = compileStory(source);
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const waiting = runtime.runUntilPause();
    expect(waiting.kind).toBe('waiting');
    if (waiting.kind !== 'waiting' || waiting.interaction.kind !== 'event') return;
    expect(waiting.interaction.request.arguments.amount).toBe(4);
  });

  it('validates multiple adapter return values and stores selected results', () => {
    const source = eventStory();
    source.events[0] = {
      ...source.events[0]!,
      outputs: [
        {
          id: 'evo_score',
          name: 'newScore',
          displayName: 'New Score',
          valueType: { kind: 'number' },
        },
        {
          id: 'evo_items',
          name: 'items',
          displayName: 'Items',
          valueType: { kind: 'array' },
        },
      ],
    };
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      resultVariableIds: { evo_score: 'v_score' },
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    expect(runtime.runUntilPause().kind).toBe('waiting');
    const invalid = runtime.continueEvent({ evo_score: 'wrong', evo_items: [] });
    expect(invalid.kind).toBe('failed');

    const validRuntime = new StoryRuntime(compiled.program);
    validRuntime.runUntilPause();
    expect(validRuntime.continueEvent({ evo_score: 9, evo_items: ['gold'] }).kind).toBe(
      'completed',
    );
    expect(validRuntime.state.storyVariables.v_score).toBe(9);
  });

  it('exposes External Function Out values through data connections', () => {
    const source = eventStory();
    source.events[0] = {
      ...source.events[0]!,
      outputs: [
        {
          id: 'evo_score',
          name: 'score',
          displayName: 'Score',
          valueType: { kind: 'number' },
        },
      ],
    };
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      outputPorts: [{ id: 'evo_score', label: 'Score', valueType: { kind: 'number' } }],
    };
    source.root.nodes.push({
      id: 'n_set_result',
      type: StoryNodeType.SetVariable,
      definitionVersion: 1,
      position: { x: 320, y: 0 },
      data: {
        variableId: 'v_score',
        value: { source: '0', bindings: {} },
      },
    });
    source.root.edges = [
      ...source.root.edges.filter(
        (edge) => !(edge.from.nodeId === 'n_event' && edge.to.nodeId === 'n_end'),
      ),
      { from: { nodeId: 'n_event', portId: 'out' }, to: { nodeId: 'n_set_result', portId: 'in' } },
      {
        from: { nodeId: 'n_event', portId: 'output:evo_score' },
        to: { nodeId: 'n_set_result', portId: 'value' },
      },
      { from: { nodeId: 'n_set_result', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];

    const compiled = compileStory(source);
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const waiting = runtime.runUntilPause();
    expect(waiting.kind).toBe('waiting');
    if (waiting.kind !== 'waiting' || waiting.interaction.kind !== 'event') return;
    const result = runtime.continueEvent({ evo_score: 12 });
    expect(result.kind).toBe('completed');
    expect(runtime.state.storyVariables.v_score).toBe(12);
    expect(runtime.state.eventOutputs?.i_event_main?.evo_score).toBe(12);
  });

  it('round-trips typed External Function Out ports through Story KDL', () => {
    const source = eventStory();
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    eventNode.data = {
      ...eventNode.data,
      outputPorts: [{ id: 'evo_score', label: 'Score', valueType: { kind: 'number' } }],
    };
    const parsed = parseStorySource(serializeStorySource({ ...source, events: [] }));
    expect(
      (parsed.root.nodes.find((node) => node.id === 'n_event')?.data as { outputPorts?: unknown })
        .outputPorts,
    ).toEqual([{ id: 'evo_score', label: 'Score', valueType: { kind: 'number' } }]);
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
      waitForSignal: async () => ({}),
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
      {
        eventId: 'ev_reward',
        arguments: {
          amount: 5,
          message: 'Treasure',
          payload: { itemId: 'gold', amount: 3, tags: ['quest'] },
        },
      },
    ]);
  });

  it('diagnoses malformed opaque engine JSON without exposing it to expressions', () => {
    const source = eventStory();
    const eventNode = source.root.nodes.find((node) => node.id === 'n_event')!;
    const broken: StorySourceDocument = {
      ...source,
      root: {
        ...source.root,
        nodes: source.root.nodes.map((node) =>
          node.id === eventNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  arguments: {
                    ...(
                      node.data as {
                        arguments: Record<
                          string,
                          { source: string; bindings: Record<string, never> }
                        >;
                      }
                    ).arguments,
                    payload: { source: '{broken', bindings: {} },
                  },
                },
              }
            : node,
        ),
      },
    };
    const compiled = compileStory(broken);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.some((item) => item.message.includes('Invalid JSON'))).toBe(true);
  });

  it('waits for signals and consumes signals that arrived early', () => {
    const source = eventStory();
    const signalId = 'sig_continue' as const;
    const withSignal: StorySourceDocument = {
      ...source,
      signals: [
        {
          id: signalId,
          name: 'continue',
          displayName: 'Continue',
          parameters: [
            { name: 'character', valueType: { kind: 'string' } },
            { name: 'animation', valueType: { kind: 'string' } },
          ],
        },
      ],
      root: {
        nodes: [
          ...source.root.nodes.filter((node) => node.id !== 'n_end'),
          {
            id: 'n_wait',
            type: StoryNodeType.WaitSignal,
            definitionVersion: 1,
            position: { x: 400, y: 0 },
            data: {
              signalId,
              matches: { animation: { source: '"Smile"', bindings: {} } },
            },
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
    const parsed = parseStorySource(
      serializeStorySource({ ...withSignal, events: [], signals: [] }),
    );
    expect(parsed.root.nodes.find((node) => node.id === 'n_wait')?.data).toEqual(
      withSignal.root.nodes.find((node) => node.id === 'n_wait')?.data,
    );
    const compiled = compileStory(withSignal);
    if (!compiled.ok) throw new Error('Expected signal story to compile');

    const runtime = new StoryRuntime(compiled.program);
    const event = runtime.runUntilPause();
    expect(event.kind === 'waiting' && event.interaction.kind).toBe('event');
    const waiting = runtime.continueEvent();
    expect(waiting.kind === 'waiting' && waiting.interaction.kind).toBe('signal');
    if (waiting.kind !== 'waiting' || waiting.interaction.kind !== 'signal') return;
    expect(waiting.interaction.request.matches).toEqual({ animation: 'Smile' });
    expect(runtime.sendSignal(signalId, { character: 'alice', animation: 'Idle' })).toBeUndefined();
    expect(runtime.state.status).toBe('waiting');
    expect(runtime.sendSignal(signalId, { character: 'alice', animation: 'Smile' })?.kind).toBe(
      'completed',
    );

    const earlyRuntime = new StoryRuntime(compiled.program);
    expect(earlyRuntime.sendSignal(signalId, { animation: 'Idle' })).toBeUndefined();
    expect(earlyRuntime.sendSignal(signalId, { animation: 'Smile' })).toBeUndefined();
    const restoredRuntime = new StoryRuntime(compiled.program, earlyRuntime.state);
    restoredRuntime.runUntilPause();
    expect(restoredRuntime.continueEvent().kind).toBe('completed');
    expect(restoredRuntime.state.signalInbox[signalId]).toEqual([{ animation: 'Idle' }]);
  });
});
