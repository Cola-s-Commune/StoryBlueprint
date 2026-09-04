import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  extractLocalizationSources,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';
import { compileProject } from '../packages/compiler/src';
import { runStoryWithAdapter, StoryRuntime, type StoryAdapter } from '../packages/runtime/src';

function narrationStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_narration',
    name: 'narration',
    displayName: 'Narration',
    variables: [
      {
        id: 'v_name',
        name: 'name',
        displayName: 'Name',
        scope: 'story',
        valueType: { kind: 'string' },
        defaultValue: 'Mina',
      },
    ],
    characters: [],
    assets: [
      {
        id: 'a_voice',
        name: 'narrator-voice',
        displayName: 'Narrator Voice',
        kind: 'audio',
        locales: { default: 'voices/narrator.ogg' },
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
          id: 'n_narration',
          type: StoryNodeType.Narration,
          definitionVersion: 1,
          position: { x: 240, y: 0 },
          data: {
            textId: 't_narration',
            text: { source: 'The lights dim, {name}.', bindings: { name: 'v_name' } },
            voiceId: 'a_voice',
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
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_narration', portId: 'in' } },
        { from: { nodeId: 'n_narration', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
      ],
    },
  };
}

function adapter(overrides: Partial<StoryAdapter> = {}): StoryAdapter {
  return {
    showDialogue: async () => undefined,
    showChoice: async () => 'o_unused',
    callEvent: async () => ({}),
    waitForSignal: async () => ({}),
    resolveText: async () => undefined,
    readExternalVariable: async (variable) => variable.defaultValue,
    writeExternalVariable: async () => undefined,
    ...overrides,
  };
}

describe('Narration node', () => {
  it('round-trips text templates and optional voice assets through KDL', () => {
    const source = narrationStory();
    const serialized = serializeStorySource(source);
    expect(serialized).toContain('narration n_narration');
    expect(serialized).toContain('text-id=t_narration');
    expect(parseStorySource(serialized)).toEqual(source);
  });

  it('extracts narration text for localization', () => {
    const entry = extractLocalizationSources([narrationStory()]).find(
      (candidate) => candidate.textId === 't_narration',
    );
    expect(entry).toMatchObject({
      storyName: 'Narration',
      graphName: 'Main Story',
      source: 'The lights dim, {name}.',
      context: 'Narration · Text',
    });
  });

  it('compiles to a node-free narration instruction and pauses with rendered variables', () => {
    const result = compileStory(narrationStory());
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;

    const instructions = Object.values(result.program.blocks).flatMap(
      (block) => block.instructions,
    );
    const narration = instructions.find((instruction) => instruction.op === 'narration');
    expect(narration).toMatchObject({
      op: 'narration',
      text: { id: 't_narration' },
      voice: { default: 'a_voice' },
    });
    expect(JSON.stringify(result.program)).not.toContain('n_narration');

    const runtime = new StoryRuntime(result.program);
    const paused = runtime.runUntilPause();
    expect(paused.kind).toBe('waiting');
    if (paused.kind !== 'waiting' || paused.interaction.kind !== 'narration') return;
    expect(paused.interaction.request).toMatchObject({
      textId: 't_narration',
      defaultText: 'The lights dim, Mina.',
      voice: { default: 'a_voice' },
    });
    expect(runtime.continueNarration().kind).toBe('completed');
  });

  it('uses showNarration when supplied and falls back to showDialogue otherwise', async () => {
    const compiled = compileStory(narrationStory());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const dedicated: unknown[] = [];
    const dedicatedResult = await runStoryWithAdapter(
      new StoryRuntime(compiled.program),
      adapter({ showNarration: async (request) => dedicated.push(request) }),
      new AbortController().signal,
    );
    expect(dedicatedResult.kind).toBe('completed');
    expect(dedicated).toHaveLength(1);
    expect(dedicated[0]).toMatchObject({ textId: 't_narration' });

    const fallback: unknown[] = [];
    const fallbackResult = await runStoryWithAdapter(
      new StoryRuntime(compiled.program),
      adapter({ showDialogue: async (request) => fallback.push(request) }),
      new AbortController().signal,
    );
    expect(fallbackResult.kind).toBe('completed');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({
      textId: 't_narration',
      defaultText: 'The lights dim, Mina.',
    });
  });

  it('treats a narration cycle as an interactive, non-tight loop', () => {
    const source = narrationStory();
    source.root.edges = [
      {
        from: { nodeId: 'n_start', portId: 'out' },
        to: { nodeId: 'n_narration', portId: 'in' },
      },
      {
        from: { nodeId: 'n_narration', portId: 'out' },
        to: { nodeId: 'n_narration', portId: 'in' },
      },
    ];
    const project = {
      format: 'story-blueprint-project' as const,
      version: 1 as const,
      id: 'p_narration',
      name: 'narration-project',
      displayName: 'Narration Project',
      stories: [
        {
          id: source.id,
          path: 'Stories/narration.story',
          name: source.name,
          displayName: source.displayName,
        },
      ],
      characters: [],
      assets: [],
      variables: [],
      events: [],
      signals: [],
    };
    const result = compileProject(project, [{ path: 'Stories/narration.story', source }]);
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TIGHT_LOOP' })]),
    );
  });
});
