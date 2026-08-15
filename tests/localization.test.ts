import { describe, expect, it } from 'vitest';
import {
  STORY_LOCALIZATION_FORMAT,
  STORY_LOCALIZATION_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  choiceOptionTextId,
  choicePromptTextId,
  extractLocalizationSources,
  mergeLocalizationSources,
  parseStoryLocalization,
  serializeStoryLocalization,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileStory } from '../packages/compiler/src';
import { StoryRuntime } from '../packages/runtime/src';

function story(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_localized',
    name: 'localized',
    displayName: 'Localized Story',
    root: {
      nodes: [
        {
          id: 'n_locstart',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: { title: 'Start' },
        },
        {
          id: 'n_loctalkx',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 300, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_greeting',
                textId: 't_greeting',
                text: { source: 'Hello {name}', bindings: { name: 'v_namexxx' } },
              },
            ],
          },
        },
        {
          id: 'n_locendxx',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 600, y: 0 },
          data: { title: 'End' },
        },
        {
          id: 'n_choiceid',
          type: StoryNodeType.Choice,
          definitionVersion: 1,
          position: { x: 0, y: 300 },
          data: {
            prompt: { source: 'Choose' },
            options: [{ id: 'o_acceptxx', text: { source: 'Accept' } }],
          },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_locstart', portId: 'out' },
          to: { nodeId: 'n_loctalkx', portId: 'in' },
        },
        {
          from: { nodeId: 'n_loctalkx', portId: 'out' },
          to: { nodeId: 'n_locendxx', portId: 'in' },
        },
        {
          from: { nodeId: 'n_choiceid', portId: 'o_acceptxx' },
          to: { nodeId: 'n_locendxx', portId: 'in' },
        },
      ],
    },
    chapters: [],
    variables: [
      {
        id: 'v_namexxx',
        name: 'name',
        displayName: 'Name',
        scope: 'story',
        valueType: { kind: 'string' },
        defaultValue: 'Mina',
      },
    ],
    characters: [],
    assets: [],
    events: [],
  };
}

describe('project localization', () => {
  it('extracts stable Dialogue and Choice text contexts', () => {
    const sources = extractLocalizationSources([story()]);
    expect(sources.map((entry) => entry.textId)).toEqual([
      choiceOptionTextId('o_acceptxx'),
      choicePromptTextId('n_choiceid'),
      't_greeting',
    ]);
    expect(sources.find((entry) => entry.textId === 't_greeting')).toMatchObject({
      storyName: 'Localized Story',
      graphName: 'Main Story',
      source: 'Hello {name}',
    });
  });

  it('keeps generated Choice text identities separate from Dialogue text identities', () => {
    const source = story();
    const choice = source.root.nodes.find((node) => node.type === StoryNodeType.Choice);
    if (!choice || choice.type !== StoryNodeType.Choice) throw new Error('Expected Choice');
    choice.data.options[0]!.id = 'o_greeting';

    const sources = extractLocalizationSources([source]);
    expect(sources.map((entry) => entry.textId)).toContain('t_greeting');
    expect(sources.map((entry) => entry.textId)).toContain('t_choice_option_greeting');
  });

  it('collapses repeated uses of the same text identity into one translation row', () => {
    const source = story();
    expect(extractLocalizationSources([source, source])).toHaveLength(3);

    const duplicateLine = structuredClone(source.root.nodes[1]);
    if (duplicateLine.type !== StoryNodeType.Dialogue) throw new Error('Expected Dialogue');
    duplicateLine.id = 'n_loccopyx';
    source.root.nodes.push(duplicateLine);
    expect(
      extractLocalizationSources([source]).filter((entry) => entry.textId === 't_greeting'),
    ).toHaveLength(1);
  });

  it('reports reused text identities whose source text disagrees', () => {
    const source = story();
    const duplicateLine = structuredClone(source.root.nodes[1]);
    if (duplicateLine.type !== StoryNodeType.Dialogue) throw new Error('Expected Dialogue');
    duplicateLine.id = 'n_loccopyx';
    duplicateLine.data.lines[0]!.text.source = 'Different source';
    source.root.nodes.push(duplicateLine);
    expect(() => extractLocalizationSources([source])).toThrow(
      /s_localized \/ t_greeting has conflicting source text/,
    );
  });

  it('round-trips a Git-friendly table and preserves translations while refreshing sources', () => {
    const initial = mergeLocalizationSources(undefined, [story()], 'en');
    const translated = {
      ...initial,
      locales: [
        {
          locale: 'zh',
          fallback: 'en',
          translations: [
            { storyId: 's_localized' as const, textId: 't_greeting' as const, text: '你好 {name}' },
          ],
        },
      ],
    };
    const serialized = serializeStoryLocalization(translated);
    const parsed = parseStoryLocalization(serialized);
    expect(parsed).toEqual(translated);
    expect(serializeStoryLocalization(parsed)).toBe(serialized);
    expect(mergeLocalizationSources(parsed, [story()]).locales[0]?.translations[0]?.text).toBe(
      '你好 {name}',
    );
  });

  it('renders translated templates through a locale fallback chain', () => {
    const compiled = compileStory(story(), {
      translations: { zh: { t_greeting: '你好 {name}' } },
      sourceLocale: 'en',
      localeFallbacks: { 'zh-CN': 'zh', zh: 'en' },
    });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) return;
    const interaction = new StoryRuntime(compiled.program, undefined, 'zh-CN').runUntilPause();
    expect(interaction.kind).toBe('waiting');
    if (interaction.kind !== 'waiting' || interaction.interaction.kind !== 'dialogue') return;
    expect(interaction.interaction.request.defaultText).toBe('你好 Mina');
  });

  it('rejects a localization locale that has no valid fallback target', () => {
    expect(() =>
      serializeStoryLocalization({
        format: STORY_LOCALIZATION_FORMAT,
        version: STORY_LOCALIZATION_VERSION,
        sourceLocale: 'en',
        sources: [],
        locales: [{ locale: 'zh-CN', fallback: 'missing', translations: [] }],
      }),
    ).toThrow(/missing fallback/);
  });
});
