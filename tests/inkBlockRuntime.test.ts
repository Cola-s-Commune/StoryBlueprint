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

function inkBlockStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_inkblock',
    name: 'ink-block',
    displayName: 'Ink Block',
    variables: [],
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
          id: 'n_inkblock',
          type: StoryNodeType.InkBlock,
          definitionVersion: 1,
          position: { x: 240, y: 0 },
          data: {
            sourceMode: 'embedded',
            source: ['Before the choice.', '* [Continue]', '  After the choice.'].join('\n'),
          },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 480, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_inkblock', portId: 'in' } },
        { from: { nodeId: 'n_inkblock', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
      ],
    },
  };
}

describe('Ink Block runtime', () => {
  it('round-trips explicit Ink External Function bindings in Story KDL', () => {
    const source = inkBlockStory();
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: 'EXTERNAL has_item(item_id)\n=== start ===\nHello.',
      externalFunctionBindings: [{ inkName: 'has_item', functionId: 'ev_hasitem' }],
    };
    const serialized = serializeStorySource(source);
    expect(serialized).toContain('external-function-binding has_item ev_hasitem');
    expect(parseStorySource(serialized).root.nodes[1]?.data).toEqual(source.root.nodes[1]?.data);
  });

  it('maps Ink EXTERNAL declarations to stable External Function IDs and invokes the sync adapter', async () => {
    const source = inkBlockStory();
    source.events = [
      {
        id: 'ev_affinity',
        name: 'addAffinity',
        displayName: 'Add Affinity',
        parameters: [{ name: 'amount', valueType: { kind: 'number' } }],
        resumable: true,
        sideEffect: 'write',
      },
    ];
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source:
        'EXTERNAL add_affinity(amount)\n=== start ===\n~ temp result = add_affinity(2)\nAffinity is {result}.',
      externalFunctionBindings: [{ inkName: 'add_affinity', functionId: 'ev_affinity' }],
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async () => ({}),
      callExternalFunctionSync: ({ functionId, arguments: args }) => {
        expect(functionId).toBe('ev_affinity');
        return (args.amount as number) + 5;
      },
      waitForSignal: async () => ({}),
      resolveText: async () => undefined,
      readExternalVariable: async (variable) => variable.defaultValue,
      writeExternalVariable: async () => undefined,
    };
    const result = await runStoryWithAdapter(runtime, adapter, new AbortController().signal);
    expect(result.kind).toBe('completed');
  });

  it('diagnoses missing or mismatched Ink EXTERNAL mappings', () => {
    const source = inkBlockStory();
    source.events = [
      {
        id: 'ev_affinity',
        name: 'addAffinity',
        displayName: 'Add Affinity',
        parameters: [{ name: 'amount', valueType: { kind: 'number' } }],
        resumable: true,
        sideEffect: 'write',
      },
    ];
    const ink = source.root.nodes[1]!;
    ink.data = {
      sourceMode: 'embedded',
      source: 'EXTERNAL add_affinity(amount, bonus)\n=== start ===\nHello.',
      externalFunctionBindings: [{ inkName: 'add_affinity', functionId: 'ev_affinity' }],
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnostics.some((item) => item.message.includes('expects 2 parameter'))).toBe(
      true,
    );
    ink.data = {
      sourceMode: 'embedded',
      source: 'EXTERNAL missing_function()\n=== start ===\nHello.',
      externalFunctionBindings: [],
    };
    const missing = compileStory(source);
    expect(missing.ok).toBe(false);
    expect(
      missing.diagnostics.some((item) => item.message.includes('missing_function is not mapped')),
    ).toBe(true);
  });

  it('stores linked Ink by project-relative path and resolves it at compile time', () => {
    const source = inkBlockStory();
    source.root.nodes[1]!.data = {
      sourceMode: 'linked',
      path: 'Ink/chapter-one.ink',
      entryKnot: 'opening',
    };

    const serialized = serializeStorySource(source);
    expect(serialized).toContain('source-mode=linked');
    expect(serialized).toContain('path="Ink/chapter-one.ink"');
    expect(serialized).not.toContain('Before the choice.');
    expect(parseStorySource(serialized).root.nodes[1]?.data).toEqual(source.root.nodes[1]?.data);

    const unavailable = compileStory(source);
    expect(unavailable.ok).toBe(false);
    expect(
      unavailable.diagnostics.some((item) =>
        item.message.includes('Linked Ink source is unavailable'),
      ),
    ).toBe(true);

    const compiled = compileStory(source, {
      inkSources: { 'Ink/chapter-one.ink': '=== opening ===\nLinked line.' },
    });
    expect(compiled.ok).toBe(true);
  });

  it('serializes, compiles, resumes choices, and returns to Blueprint flow', () => {
    const source = inkBlockStory();
    const roundTrip = parseStorySource(serializeStorySource(source));
    expect(roundTrip.root.nodes[1]?.data).toEqual(source.root.nodes[1]?.data);

    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const runtime = new StoryRuntime(compiled.program);
    const opening = runtime.runUntilPause();
    expect(opening.kind).toBe('waiting');
    if (opening.kind !== 'waiting') return;
    expect(opening.interaction).toMatchObject({
      kind: 'dialogue',
      request: { defaultText: 'Before the choice.' },
    });

    const choice = runtime.continueDialogue();
    expect(choice.kind).toBe('waiting');
    if (choice.kind !== 'waiting' || choice.interaction.kind !== 'choice') return;
    expect(choice.interaction.request.options[0]?.defaultText).toBe('Continue');
    expect(choice.interaction.request.requestId).not.toBe(opening.interaction.request.requestId);

    const afterChoice = runtime.choose(choice.interaction.request.options[0]!.id);
    expect(afterChoice.kind).toBe('waiting');
    if (afterChoice.kind !== 'waiting') return;
    expect(afterChoice.interaction).toMatchObject({
      kind: 'dialogue',
      request: { defaultText: 'After the choice.' },
    });

    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('bridges scalar Story variables into Ink and writes them back on completion', () => {
    const source = inkBlockStory();
    source.variables = [
      {
        id: 'v_score',
        name: 'score',
        displayName: 'Score',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 5,
      },
    ];
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: ['VAR ink_score = 0', '~ ink_score = ink_score + 2', 'Score: {ink_score}'].join('\n'),
      variableBindings: [{ inkName: 'ink_score', variableId: 'v_score', direction: 'two-way' }],
    };

    const roundTrip = parseStorySource(serializeStorySource(source));
    expect(roundTrip.root.nodes[1]?.data).toEqual(source.root.nodes[1]?.data);
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const runtime = new StoryRuntime(compiled.program);
    expect(runtime.runUntilPause()).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { defaultText: 'Score: 7' } },
    });
    const completed = runtime.continueDialogue();
    expect(completed.kind).toBe('completed');
    expect(completed.state.storyVariables.v_score).toBe(7);
  });

  it('rejects missing Ink globals and non-scalar Story variable mappings', () => {
    const source = inkBlockStory();
    source.variables = [
      {
        id: 'v_payload',
        name: 'payload',
        displayName: 'Payload',
        scope: 'story',
        valueType: { kind: 'json', name: 'Payload' },
        defaultValue: {},
      },
    ];
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: 'VAR existing = 0\nDone.',
      variableBindings: [{ inkName: 'missing', variableId: 'v_payload', direction: 'two-way' }],
    };

    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no global variable named missing'),
        expect.stringContaining('cannot map to json variable Payload'),
      ]),
    );
  });

  it('restores pending Ink dialogue and choice from serializable runtime state', () => {
    const compiled = compileStory(inkBlockStory());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const firstRuntime = new StoryRuntime(compiled.program);
    const opening = firstRuntime.runUntilPause();
    expect(opening.kind).toBe('waiting');
    if (opening.kind !== 'waiting') return;
    const restoredDialogue = new StoryRuntime(
      compiled.program,
      JSON.parse(JSON.stringify(opening.state)),
    );
    const choice = restoredDialogue.continueDialogue();
    expect(choice.kind).toBe('waiting');
    if (choice.kind !== 'waiting' || choice.interaction.kind !== 'choice') return;

    const restoredChoice = new StoryRuntime(
      compiled.program,
      JSON.parse(JSON.stringify(choice.state)),
    );
    const afterChoice = restoredChoice.choose(choice.interaction.request.options[0]!.id);
    expect(afterChoice).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { defaultText: 'After the choice.' } },
    });
  });

  it('rejects stale Ink choice IDs and supports explicit abort', () => {
    const compiled = compileStory(inkBlockStory());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    runtime.runUntilPause();
    const choice = runtime.continueDialogue();
    expect(choice.kind).toBe('waiting');
    if (choice.kind !== 'waiting') return;
    expect(runtime.choose('ink:0' as never)).toMatchObject({
      kind: 'failed',
      diagnostic: { code: 'INVALID_OPTION' },
    });

    const aborted = new StoryRuntime(compiled.program).abort();
    expect(aborted).toMatchObject({ kind: 'failed', diagnostic: { code: 'ABORTED' } });
  });

  it('treats Ink END as normal block termination', () => {
    const source = inkBlockStory();
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: ['Last Ink line.', '-> END'].join('\n'),
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    expect(runtime.runUntilPause()).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { defaultText: 'Last Ink line.' } },
    });
    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('bridges Ink dialogue metadata into the native dialogue request', () => {
    const source = inkBlockStory();
    source.characters = [
      {
        id: 'c_alice',
        name: 'alice',
        displayName: 'Alice',
        emotions: { happy: { displayName: 'Happy' } },
      },
    ];
    source.assets = [
      {
        id: 'a_voice',
        name: 'voice',
        displayName: 'Voice',
        kind: 'audio',
        locales: { default: 'voice.wav' },
      },
    ];
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source:
        'Hello. # speaker:c_alice # voice:a_voice # emotion:happy # text-id:t_ink_hello # cinematic',
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = new StoryRuntime(compiled.program).runUntilPause();
    expect(result).toMatchObject({
      kind: 'waiting',
      interaction: {
        kind: 'dialogue',
        request: {
          speakerId: 'c_alice',
          textId: 't_ink_hello',
          voice: { default: 'a_voice' },
          emotion: 'happy',
          tags: ['cinematic'],
        },
      },
    });
  });

  it('reports invalid Ink metadata during compilation', () => {
    const source = inkBlockStory();
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: 'Hello. # speaker:c_missing # emotion:happy # voice:a_missing',
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing character c_missing'),
        expect.stringContaining('missing voice asset a_missing'),
      ]),
    );
  });

  it('reports Ink syntax failures at compile time', () => {
    const source = inkBlockStory();
    const ink = source.root.nodes[1]!;
    ink.data = { sourceMode: 'embedded', source: '* [Broken' };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.some((item) => item.message.startsWith('Ink Block:'))).toBe(true);
  });

  it('keeps Ink compiler warnings non-blocking and clearly classified', () => {
    const source = inkBlockStory();
    source.root.nodes[1]!.data = {
      sourceMode: 'embedded',
      source: '=== start ===\nA loose end.',
    };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INK_WARNING',
          severity: 'warning',
          message: expect.stringContaining('Apparent loose end exists'),
        }),
      ]),
    );
  });

  it('treats an unconnected Dialogue output as the natural end of a Story', () => {
    const source = inkBlockStory();
    source.root.nodes = [
      source.root.nodes[0]!,
      {
        id: 'n_finaldialogue',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 240, y: 0 },
        data: {
          lines: [
            { id: 'ln_finaldialogue', textId: 't_finaldialogue', text: { source: 'Final line.' } },
          ],
        },
      },
    ];
    source.root.edges = [
      {
        from: { nodeId: 'n_start', portId: 'out' },
        to: { nodeId: 'n_finaldialogue', portId: 'in' },
      },
    ];

    const compiled = compileStory(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    expect(runtime.runUntilPause()).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { defaultText: 'Final line.' } },
    });
    expect(runtime.continueDialogue().kind).toBe('completed');
  });
});
