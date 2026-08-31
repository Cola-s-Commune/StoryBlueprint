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
import {
  buildInkBlockConversionTransaction,
  buildInkImportTransaction,
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
      dialogueNodes: 3,
      dialogueLines: 3,
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

  it('accepts External declarations, bare Ink narration, and DONE as a valid terminal', () => {
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
      lines: [
        { text: { source: 'The train doors open.' } },
        { speakerId: alice.id, text: { source: 'We made it.' } },
      ],
    });
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
});
