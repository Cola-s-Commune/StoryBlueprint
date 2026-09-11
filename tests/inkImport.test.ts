import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStableId,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  nodeRegistry,
  type CharacterSource,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';
import { StoryRuntime } from '../packages/runtime/src';
import {
  buildInkBlockFallbackTransaction,
  buildInkBlockConversionTransaction,
  buildInkImportTransaction,
  buildNodesToInkBlockConversionTransaction,
} from '../packages/editor/src/renderer/dialogue/inkImport';

nodeRegistry.registerBuiltins();

const alice: CharacterSource = {
  id: 'c_alice',
  name: 'alice',
  displayName: 'Alice',
  emotions: { happy: { displayName: 'Happy' } },
};

function story(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_inkimport',
    name: 'inkImport',
    displayName: 'Ink Import',
    root: {
      nodes: [
        {
          id: 'n_entry',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: { title: 'Entry' },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 300, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
      ],
    },
    chapters: [],
    variables: [],
    characters: [alice],
    assets: [],
    events: [],
    signals: [],
  };
}

function importInk(source: string) {
  const document = story();
  return {
    document,
    result: buildInkImportTransaction(source, {
      revision: createStorySemanticSnapshot(document).revision,
      characters: document.characters,
      assets: document.assets,
      variables: document.variables,
    }),
  };
}

describe('Ink Profile node import', () => {
  it('converts dialogue, metadata, choices, and diverts into a compilable proposal', () => {
    const { document, result } = importInk(`Alice: We need a plan. # emotion:happy
* Take the road -> road
* Take the river
  -> river

=== road ===
Alice: The road is clear.

=== river ===
Narrator: The river is fast.`);

    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      dialogueNodes: 2,
      dialogueLines: 2,
      narrationNodes: 1,
      choiceNodes: 1,
      portalNodes: 4,
    });
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    const dialogue = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.Dialogue && node.id !== 'n_entry',
    );
    expect(dialogue?.data).toMatchObject({
      lines: [{ speakerId: alice.id, emotion: 'happy', text: { source: 'We need a plan.' } }],
    });
    const compiled = compileStory(executed.document);
    expect(compiled.ok, compiled.ok ? undefined : compiled.diagnostics).toBe(true);
  });

  it('converts typed variables, assignments, interpolation, and a simple conditional', () => {
    const { document, result } = importInk(`VAR trust = 2
~ trust = trust + 1
Alice: Trust is {trust}.
{
  trust >= 3:
    -> trusted
  - else:
    -> rejected
}

=== trusted ===
Alice: Welcome.

=== rejected ===
Alice: Leave.`);

    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ variablesAdded: 1, variableNodes: 1, branchNodes: 1 });
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    expect(executed.document.variables).toEqual([
      expect.objectContaining({ name: 'trust', valueType: { kind: 'number' }, defaultValue: 2 }),
    ]);
    const setVariable = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.SetVariable,
    );
    expect(setVariable?.data).toMatchObject({ value: { source: 'trust + 1' } });
    const compiled = compileStory(executed.document);
    expect(compiled.ok, compiled.ok ? undefined : compiled.diagnostics).toBe(true);
  });

  it('imports bare Ink narration as Narration nodes and accepts DONE as a valid terminal', () => {
    const { document, result } = importInk(`EXTERNAL add_affinity(amount)

The train doors open.
Alice: We made it.
-> DONE`);

    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    const dialogue = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.Dialogue,
    );
    expect(dialogue?.data).toMatchObject({
      lines: [{ speakerId: alice.id, text: { source: 'We made it.' } }],
    });
    const narration = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.Narration,
    );
    expect(narration?.data).toMatchObject({ text: { source: 'The train doors open.' } });
    expect(
      executed.document.root.nodes.filter((node) => node.type === StoryNodeType.End),
    ).toHaveLength(2);
    expect(compileStory(executed.document).ok).toBe(true);
  });

  it('converts a mapped Ink External Function call into a typed Call External Function node', () => {
    const document = story();
    document.variables = [
      {
        id: 'v_affinity',
        name: 'affinity',
        displayName: 'Affinity',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    document.events = [
      {
        id: 'ev_affinity',
        name: 'addAffinity',
        displayName: 'Add Affinity',
        parameters: [{ name: 'amount', valueType: { kind: 'number' } }],
        outputs: [
          { id: 'out_value', name: 'value', displayName: 'Value', valueType: { kind: 'number' } },
        ],
        resumable: true,
        sideEffect: 'write',
      },
    ];
    const result = buildInkImportTransaction(
      `EXTERNAL add_affinity(amount)
=== start ===
~ affinity = add_affinity(1)
-> DONE`,
      {
        revision: createStorySemanticSnapshot(document).revision,
        characters: document.characters,
        assets: document.assets,
        variables: document.variables,
        events: document.events,
        externalFunctionBindings: [{ inkName: 'add_affinity', functionId: 'ev_affinity' }],
      },
    );
    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    const call = executed.document.root.nodes.find((node) => node.type === StoryNodeType.CallEvent);
    expect(call?.data).toMatchObject({
      eventId: 'ev_affinity',
      arguments: { amount: { source: '1' } },
      resultVariableIds: { out_value: 'v_affinity' },
    });
    expect(compileStory(executed.document).ok).toBe(true);
  });

  it('rejects unsupported or incomplete control flow with source locations', () => {
    const unsupported = importInk(`=== start ===
* Option without a target
~ temp = function()`).result;

    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 2, message: expect.stringContaining('must end with') }),
        expect.objectContaining({
          line: 3,
          message: expect.stringContaining('has no EXTERNAL declaration'),
        }),
      ]),
    );

    const malformedCall = importInk(`EXTERNAL add_affinity(amount)
=== start ===
~ affinity = add_affinity(1,)
-> DONE`).result;
    expect(malformedCall.ok).toBe(false);
    if (malformedCall.ok) return;
    expect(malformedCall.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 3,
          message: expect.stringContaining('arguments are malformed'),
        }),
      ]),
    );

    const complex = importInk(`{
  true:
    Alice: Nested content is not converted.
    -> done
  - else:
    -> done
}
=== done ===
Alice: Done.`).result;
    expect(complex.ok).toBe(false);
    if (complex.ok) return;
    expect(complex.diagnostics[0]).toMatchObject({
      line: 1,
      message: expect.stringContaining('each contain one divert'),
    });
  });

  it('preserves valid Ink outside the native profile as one complete Ink Block', () => {
    const document = story();
    const source = [
      '=== start ===',
      '+ Ask again -> end',
      '=== end ===',
      'Alice: We can revisit this later.',
      '-> DONE',
    ].join('\n');
    const imported = buildInkImportTransaction(source, {
      revision: createStorySemanticSnapshot(document).revision,
      characters: document.characters,
      assets: document.assets,
      variables: document.variables,
    });

    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          line: 2,
          message: expect.stringContaining('Sticky (`+`) Choices'),
        }),
      ]),
    );
    expect(imported.diagnostics.some((item) => item.severity === 'error')).toBe(false);

    const fallback = buildInkBlockFallbackTransaction(source, {
      revision: createStorySemanticSnapshot(document).revision,
      conversionDiagnostics: imported.diagnostics,
    });
    expect(fallback.ok, fallback.ok ? undefined : fallback.diagnostics).toBe(true);
    if (!fallback.ok) return;
    expect(fallback.summary).toMatchObject({
      mode: 'ink-block-fallback',
      inkBlockNodes: 1,
    });
    const added = fallback.transaction.operations.find(
      (
        operation,
      ): operation is Extract<
        (typeof fallback.transaction.operations)[number],
        { kind: 'add-node' }
      > => operation.kind === 'add-node',
    );
    expect(added?.node).toMatchObject({
      type: StoryNodeType.InkBlock,
      data: { sourceMode: 'embedded', source },
    });
    const executed = executeBlueprintCommandTransaction(document, fallback.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
  });

  it('does not preserve syntactically invalid Ink as a runnable Ink Block', () => {
    const document = story();
    const fallback = buildInkBlockFallbackTransaction('=== start ===\n-> missing_knot', {
      revision: createStorySemanticSnapshot(document).revision,
    });

    expect(fallback.ok).toBe(false);
    if (fallback.ok) return;
    expect(fallback.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    );
  });

  it('replaces an Ink Block only through a valid replacement transaction and preserves flow', () => {
    const document = story();
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_ink',
        type: StoryNodeType.InkBlock,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: { sourceMode: 'embedded', source: 'Alice: Converted line.' },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_ink', portId: 'in' } },
      { from: { nodeId: 'n_ink', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];
    const result = buildInkBlockConversionTransaction('Alice: Converted line.', {
      revision: createStorySemanticSnapshot(document).revision,
      characters: document.characters,
      assets: document.assets,
      variables: document.variables,
      graph: document.root,
      inkNodeId: 'n_ink',
    });

    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    // The source remains unmodified until the preview transaction is applied.
    expect(document.root.nodes.some((node) => node.id === 'n_ink')).toBe(true);
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    expect(executed.document.root.nodes.some((node) => node.id === 'n_ink')).toBe(false);
    const dialogue = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.Dialogue,
    );
    expect(dialogue).toBeDefined();
    expect(executed.document.root.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: { nodeId: 'n_entry', portId: 'out' },
          to: { nodeId: dialogue!.id, portId: 'in' },
        }),
        expect.objectContaining({
          from: { nodeId: dialogue!.id, portId: 'out' },
          to: { nodeId: 'n_end', portId: 'in' },
        }),
      ]),
    );
    expect(compileStory(executed.document).ok).toBe(true);
  });

  it('rejoins multiple converted Ink endings through a Flow Anchor before the original successor', () => {
    const document = story();
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_ink',
        type: StoryNodeType.InkBlock,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: { sourceMode: 'embedded', source: '' },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_ink', portId: 'in' } },
      { from: { nodeId: 'n_ink', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];
    const source = `* Road -> road
* River -> river

=== road ===
Alice: Road.

=== river ===
Alice: River.`;
    const result = buildInkBlockConversionTransaction(source, {
      revision: createStorySemanticSnapshot(document).revision,
      characters: document.characters,
      assets: document.assets,
      variables: document.variables,
      graph: document.root,
      inkNodeId: 'n_ink',
    });

    expect(result.ok, result.ok ? undefined : result.diagnostics).toBe(true);
    if (!result.ok) return;
    const executed = executeBlueprintCommandTransaction(document, result.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    const anchor = executed.document.root.nodes.find(
      (node) => node.type === StoryNodeType.FlowAnchor && node.name === 'Continue after Ink Block',
    );
    expect(anchor).toBeDefined();
    expect(executed.document.root.edges).toContainEqual({
      from: { nodeId: anchor!.id, portId: 'out' },
      to: { nodeId: 'n_end', portId: 'in' },
    });
    expect(
      executed.document.root.nodes.filter(
        (node) => node.type === StoryNodeType.FlowJump && node.name === 'Continue after Ink Block',
      ),
    ).toHaveLength(2);
    expect(compileStory(executed.document).ok).toBe(true);
  });

  it('replaces a direct native narrative chain with runnable Embedded Ink while preserving metadata', () => {
    const document = story();
    document.assets = [
      { id: 'a_voiceone', name: 'voiceOne', displayName: 'Voice One', kind: 'audio' },
    ];
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_dialogueone',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: {
          lines: [
            {
              id: 'ln_hello',
              textId: 't_hello',
              text: { source: 'Hello.' },
              speakerId: 'c_alice',
              voiceId: 'a_voiceone',
              emotion: 'happy',
              tags: ['opening'],
            },
          ],
        },
      },
      {
        id: 'n_narration',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 420, y: 0 },
        data: { textId: 't_rain', text: { source: 'Rain starts.' } },
      },
      {
        id: 'n_dialoguetwo',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 690, y: 0 },
        data: {
          lines: [
            {
              id: 'ln_goodbye',
              textId: 't_goodbye',
              text: { source: 'Goodbye.' },
              speakerId: 'c_alice',
            },
          ],
        },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_dialogueone', portId: 'in' } },
      {
        from: { nodeId: 'n_dialogueone', portId: 'out' },
        to: { nodeId: 'n_narration', portId: 'in' },
      },
      {
        from: { nodeId: 'n_narration', portId: 'out' },
        to: { nodeId: 'n_dialoguetwo', portId: 'in' },
      },
      { from: { nodeId: 'n_dialoguetwo', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];

    const converted = buildNodesToInkBlockConversionTransaction({
      revision: createStorySemanticSnapshot(document).revision,
      graph: document.root,
      nodeIds: ['n_dialogueone', 'n_narration', 'n_dialoguetwo'],
      characters: document.characters,
      assets: document.assets,
    });
    expect(converted.ok, converted.ok ? undefined : converted.diagnostics).toBe(true);
    if (!converted.ok) return;
    expect(converted.source).toContain(
      'Alice: Hello. # speaker:c_alice # voice:a_voiceone # emotion:happy # text-id:t_hello # opening',
    );
    expect(converted.source).toContain('# text-id:t_rain');

    const executed = executeBlueprintCommandTransaction(document, converted.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    expect(executed.document.root.nodes.some((node) => node.id === 'n_dialogueone')).toBe(false);
    const ink = executed.document.root.nodes.find((node) => node.type === StoryNodeType.InkBlock);
    expect(ink?.data).toMatchObject({ sourceMode: 'embedded', source: converted.source });
    const compiled = compileStory(executed.document);
    expect(compiled.ok, compiled.ok ? undefined : compiled.diagnostics).toBe(true);
    if (!compiled.ok) return;

    const runtime = new StoryRuntime(compiled.program);
    expect(runtime.runUntilPause()).toMatchObject({
      kind: 'waiting',
      interaction: {
        kind: 'dialogue',
        request: {
          speakerId: 'c_alice',
          textId: 't_hello',
          defaultText: 'Hello.',
          voice: { default: 'a_voiceone' },
          emotion: 'happy',
          tags: ['opening'],
        },
      },
    });
    expect(runtime.continueDialogue()).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { textId: 't_rain', defaultText: 'Rain starts.' } },
    });
    expect(runtime.continueDialogue()).toMatchObject({
      kind: 'waiting',
      interaction: {
        kind: 'dialogue',
        request: { speakerId: 'c_alice', textId: 't_goodbye', defaultText: 'Goodbye.' },
      },
    });
    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('round-trips native narrative metadata through Ink import', () => {
    const document = story();
    document.assets = [
      { id: 'a_voiceone', name: 'voiceOne', displayName: 'Voice One', kind: 'audio' },
    ];
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_dialogue',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: {
          lines: [
            {
              id: 'ln_hello',
              textId: 't_hello',
              text: { source: 'Hello.' },
              speakerId: 'c_alice',
              voiceId: 'a_voiceone',
              emotion: 'happy',
              tags: ['opening'],
            },
          ],
        },
      },
      {
        id: 'n_narration',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 420, y: 0 },
        data: { textId: 't_rain', text: { source: 'Rain starts.' } },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_dialogue', portId: 'in' } },
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_narration', portId: 'in' },
      },
      { from: { nodeId: 'n_narration', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];

    const converted = buildNodesToInkBlockConversionTransaction({
      revision: createStorySemanticSnapshot(document).revision,
      graph: document.root,
      nodeIds: ['n_dialogue', 'n_narration'],
      characters: document.characters,
      assets: document.assets,
    });
    expect(converted.ok, converted.ok ? undefined : converted.diagnostics).toBe(true);
    if (!converted.ok) return;

    const imported = buildInkImportTransaction(converted.source, {
      revision: createStorySemanticSnapshot(document).revision,
      characters: document.characters,
      assets: document.assets,
      variables: document.variables,
    });
    expect(imported.ok, imported.ok ? undefined : imported.diagnostics).toBe(true);
    if (!imported.ok) return;
    const importedNodes = imported.transaction.operations
      .filter(
        (operation): operation is Extract<typeof operation, { kind: 'add-node' }> =>
          operation.kind === 'add-node',
      )
      .map((operation) => operation.node);
    const importedDialogue = importedNodes.find((node) => node.type === StoryNodeType.Dialogue);
    expect(importedDialogue).toEqual(
      expect.objectContaining({
        type: StoryNodeType.Dialogue,
        data: {
          lines: [
            expect.objectContaining({
              textId: 't_hello',
              text: { source: 'Hello.' },
              speakerId: 'c_alice',
              voiceId: 'a_voiceone',
              emotion: 'happy',
              tags: ['opening'],
            }),
          ],
        },
      }),
    );
    const importedNarration = importedNodes.find((node) => node.type === StoryNodeType.Narration);
    expect(importedNarration).toEqual(
      expect.objectContaining({
        type: StoryNodeType.Narration,
        data: { textId: 't_rain', text: { source: 'Rain starts.' } },
      }),
    );
  });

  it('converts a Choice with linear narrative branches that share one continuation', () => {
    const document = story();
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_choice',
        type: StoryNodeType.Choice,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: {
          prompt: { source: '' },
          options: [
            { id: 'o_left', text: { source: 'Take the left path.' } },
            { id: 'o_right', text: { source: 'Take the right path.' } },
          ],
        },
      },
      {
        id: 'n_left',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 420, y: -110 },
        data: { textId: 't_left', text: { source: 'You take the left path.' } },
      },
      {
        id: 'n_right',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 420, y: 110 },
        data: { textId: 't_right', text: { source: 'You take the right path.' } },
      },
      {
        id: 'n_after',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 690, y: 0 },
        data: { textId: 't_after', text: { source: 'Both paths reach the gate.' } },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_choice', portId: 'in' } },
      { from: { nodeId: 'n_choice', portId: 'o_left' }, to: { nodeId: 'n_left', portId: 'in' } },
      {
        from: { nodeId: 'n_choice', portId: 'o_right' },
        to: { nodeId: 'n_right', portId: 'in' },
      },
      { from: { nodeId: 'n_left', portId: 'out' }, to: { nodeId: 'n_after', portId: 'in' } },
      { from: { nodeId: 'n_right', portId: 'out' }, to: { nodeId: 'n_after', portId: 'in' } },
      { from: { nodeId: 'n_after', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];

    const converted = buildNodesToInkBlockConversionTransaction({
      revision: createStorySemanticSnapshot(document).revision,
      graph: document.root,
      nodeIds: ['n_choice', 'n_left', 'n_right'],
      characters: document.characters,
      assets: document.assets,
    });
    expect(converted.ok, converted.ok ? undefined : converted.diagnostics).toBe(true);
    if (!converted.ok) return;
    expect(converted.source).toContain('* [Take the left path.] -> choice_left');
    expect(converted.source).toContain('* [Take the right path.] -> choice_right');
    expect(converted.source).toContain('=== choice_left ===');
    expect(converted.source).toContain('=== choice_right ===');

    const executed = executeBlueprintCommandTransaction(document, converted.transaction);
    expect(executed.ok, executed.ok ? undefined : executed.diagnostics).toBe(true);
    if (!executed.ok) return;
    expect(executed.document.root.edges).toContainEqual({
      from: { nodeId: 'n_entry', portId: 'out' },
      to: expect.objectContaining({ portId: 'in' }),
    });
    const ink = executed.document.root.nodes.find((node) => node.type === StoryNodeType.InkBlock);
    expect(ink).toBeDefined();
    expect(executed.document.root.edges).toContainEqual({
      from: { nodeId: ink!.id, portId: 'out' },
      to: { nodeId: 'n_after', portId: 'in' },
    });

    const compiled = compileStory(executed.document);
    expect(compiled.ok, compiled.ok ? undefined : compiled.diagnostics).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);
    const choice = runtime.runUntilPause();
    expect(choice).toMatchObject({
      kind: 'waiting',
      interaction: {
        kind: 'choice',
        request: {
          options: [
            { defaultText: 'Take the left path.' },
            { defaultText: 'Take the right path.' },
          ],
        },
      },
    });
    if (choice.kind !== 'waiting' || choice.interaction.kind !== 'choice') return;
    const left = runtime.choose(choice.interaction.request.options[0]!.id);
    expect(left).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'dialogue', request: { defaultText: 'You take the left path.' } },
    });
    expect(runtime.continueDialogue()).toMatchObject({
      kind: 'waiting',
      interaction: { kind: 'narration', request: { defaultText: 'Both paths reach the gate.' } },
    });
  });

  it('keeps a Choice native when its prompt would change Ink interaction timing', () => {
    const document = story();
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_choice',
        type: StoryNodeType.Choice,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: {
          prompt: { source: 'Which way?' },
          options: [{ id: 'o_left', text: { source: 'Left' } }],
        },
      },
      {
        id: 'n_left',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 420, y: 0 },
        data: { textId: 't_left', text: { source: 'Left it is.' } },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_choice', portId: 'in' } },
      { from: { nodeId: 'n_choice', portId: 'o_left' }, to: { nodeId: 'n_left', portId: 'in' } },
      { from: { nodeId: 'n_left', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];
    const converted = buildNodesToInkBlockConversionTransaction({
      revision: createStorySemanticSnapshot(document).revision,
      graph: document.root,
      nodeIds: ['n_choice', 'n_left'],
    });
    expect(converted.ok).toBe(false);
    if (converted.ok) return;
    expect(converted.diagnostics[0]?.message).toContain('Choice prompts cannot be converted');
  });

  it('keeps native nodes untouched when their templates cannot be losslessly converted to Ink', () => {
    const document = story();
    document.root.nodes = [
      document.root.nodes[0]!,
      {
        id: 'n_template',
        type: StoryNodeType.Narration,
        definitionVersion: 1,
        position: { x: 150, y: 0 },
        data: { textId: 't_template', text: { source: 'Welcome, {name}.' } },
      },
      document.root.nodes[1]!,
    ];
    document.root.edges = [
      { from: { nodeId: 'n_entry', portId: 'out' }, to: { nodeId: 'n_template', portId: 'in' } },
      { from: { nodeId: 'n_template', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
    ];

    const converted = buildNodesToInkBlockConversionTransaction({
      revision: createStorySemanticSnapshot(document).revision,
      graph: document.root,
      nodeIds: ['n_template'],
    });
    expect(converted.ok).toBe(false);
    if (converted.ok) return;
    expect(converted.diagnostics[0]?.message).toContain('cannot be losslessly represented');
    expect(document.root.nodes.some((node) => node.id === 'n_template')).toBe(true);
  });
});
