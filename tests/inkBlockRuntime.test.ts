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
import { StoryRuntime } from '../packages/runtime/src';

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

    const afterChoice = runtime.choose(choice.interaction.request.options[0]!.id);
    expect(afterChoice.kind).toBe('waiting');
    if (afterChoice.kind !== 'waiting') return;
    expect(afterChoice.interaction).toMatchObject({
      kind: 'dialogue',
      request: { defaultText: 'After the choice.' },
    });

    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('reports Ink syntax failures at compile time', () => {
    const source = inkBlockStory();
    const ink = source.root.nodes[1]!;
    ink.data = { sourceMode: 'embedded', source: '* [Broken' };
    const compiled = compileStory(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.some((item) => item.message.startsWith('Ink Block:'))).toBe(true);
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
