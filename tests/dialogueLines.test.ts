import { beforeAll, describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  nodeRegistry,
  parseStorySource,
  serializeStorySource,
  type DialogueNodeData,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { compileStory } from '../packages/compiler/src';
import { StoryRuntime } from '../packages/runtime/src';
import {
  createGraphClipboard,
  fromSourceGraph,
  pasteGraphClipboard,
} from '../packages/editor/src/renderer/graph/editorGraph';

beforeAll(() => nodeRegistry.registerBuiltins());

function dialogueStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_dialoguelines',
    name: 'dialogue-lines',
    displayName: 'Dialogue Lines',
    variables: [],
    characters: [
      {
        id: 'c_alice',
        name: 'alice',
        displayName: 'Alice',
        emotions: { happy: { displayName: 'Happy' } },
      },
      {
        id: 'c_bobxx',
        name: 'bob',
        displayName: 'Bob',
        emotions: { serious: { displayName: 'Serious' } },
      },
    ],
    assets: [
      {
        id: 'a_defaultvoice',
        name: 'default-voice',
        displayName: 'Default Voice',
        kind: 'audio',
        locales: { default: 'voices/default.ogg' },
      },
      {
        id: 'a_bobvoice',
        name: 'bob-voice',
        displayName: 'Bob Voice',
        kind: 'audio',
        locales: { default: 'voices/bob.ogg' },
      },
    ],
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
          id: 'n_dialogue',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 240, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_firstline',
                textId: 't_firstline',
                text: { source: 'First line' },
                speakerId: 'c_alice',
                voiceId: 'a_defaultvoice',
                emotion: 'happy',
                tags: ['intro', 'greeting'],
              },
              {
                id: 'ln_secondline',
                textId: 't_secondline',
                text: { source: 'Second line' },
                speakerId: 'c_bobxx',
                voiceId: 'a_bobvoice',
                emotion: 'serious',
              },
            ],
          },
        },
        {
          id: 'n_endxx',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 480, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_dialogue', portId: 'in' } },
        { from: { nodeId: 'n_dialogue', portId: 'out' }, to: { nodeId: 'n_endxx', portId: 'in' } },
      ],
    },
  };
}

describe('multi-line Dialogue', () => {
  it('round-trips stable line, text, override, and tag data through KDL', () => {
    const source = dialogueStory();
    const serialized = serializeStorySource(source);
    expect(serialized).toContain('line ln_firstline t_firstline "First line"');
    expect(serialized).toContain('tag intro');
    expect(serialized).toContain('line ln_secondline t_secondline "Second line"');
    expect(parseStorySource(serialized)).toEqual(source);
  });

  it('rejects the previous single-text Dialogue shape', () => {
    const source = dialogueStory();
    const serialized = serializeStorySource(source).replace(
      /\t\tline ln_firstline[\s\S]*?\t\tline ln_secondline[^\n]*(?:\n|\r\n)/,
      '\t\ttext "Legacy line"\n',
    );
    expect(() => parseStorySource(serialized)).toThrow(/unsupported child text/);
  });

  it('rejects removed Dialogue-level defaults', () => {
    const serialized = serializeStorySource(dialogueStory()).replace(
      'dialogue n_dialogue',
      'dialogue n_dialogue speaker=c_alice',
    );
    expect(() => parseStorySource(serialized)).toThrow(/unsupported property speaker/);
  });

  it('pauses and resumes once per line while applying each Line value', () => {
    const compiled = compileStory(dialogueStory());
    expect(compiled.ok, compiled.diagnostics.map((item) => item.message).join('\n')).toBe(true);
    if (!compiled.ok) return;
    const runtime = new StoryRuntime(compiled.program);

    const first = runtime.runUntilPause();
    expect(first.kind).toBe('waiting');
    if (first.kind !== 'waiting' || first.interaction.kind !== 'dialogue') return;
    expect(first.interaction.request).toMatchObject({
      textId: 't_firstline',
      defaultText: 'First line',
      speakerId: 'c_alice',
      emotion: 'happy',
      tags: ['intro', 'greeting'],
      voice: { default: 'a_defaultvoice' },
    });

    const second = runtime.continueDialogue();
    expect(second.kind).toBe('waiting');
    if (second.kind !== 'waiting' || second.interaction.kind !== 'dialogue') return;
    expect(second.interaction.request).toMatchObject({
      textId: 't_secondline',
      defaultText: 'Second line',
      speakerId: 'c_bobxx',
      emotion: 'serious',
      voice: { default: 'a_bobvoice' },
    });
    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('regenerates line and text IDs when a Dialogue node is pasted', () => {
    const graph = fromSourceGraph(dialogueStory().root);
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      selected: node.type === StoryNodeType.Dialogue,
    }));
    const clipboard = createGraphClipboard(graph);
    const pasted = pasteGraphClipboard(graph, clipboard!);
    const dialogues = pasted.nodes.filter((node) => node.type === StoryNodeType.Dialogue);
    const original = dialogues[0].data as DialogueNodeData;
    const copy = dialogues[1].data as DialogueNodeData;
    expect(copy.lines.map((line) => line.id)).not.toEqual(original.lines.map((line) => line.id));
    expect(copy.lines.map((line) => line.textId)).not.toEqual(
      original.lines.map((line) => line.textId),
    );
  });
});
