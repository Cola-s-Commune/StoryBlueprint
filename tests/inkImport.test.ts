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
import { buildInkImportTransaction } from '../packages/editor/src/renderer/dialogue/inkImport';

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

  it('rejects unsupported or incomplete control flow with source locations', () => {
    const unsupported = importInk(`=== start ===
* Option without a target
~ temp = function()`).result;

    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 2, message: expect.stringContaining('must end with') }),
        expect.objectContaining({ line: 3, message: expect.stringContaining('unknown variable') }),
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
});
