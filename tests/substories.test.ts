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
        data: { text: { source: 'Inside substory' } },
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
});
