import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryFormatError,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  type StorySourceDocument,
} from '../packages/common/src';

function sourceDocument(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_test',
    name: 'test',
    displayName: 'Test Story',
    root: {
      nodes: [
        {
          id: 'n_start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 80.4, y: 120.2 },
          data: { title: 'Start' },
        },
        {
          id: 'n_talk',
          name: 'greeting',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 360.1, y: 120.8 },
          data: {
            lines: [
              {
                id: 'ln_greeting',
                textId: 't_greeting',
                text: { source: 'Hello {gold}' },
                speakerId: 'c_arys',
                emotion: 'happy',
              },
            ],
          },
        },
        {
          id: 'n_endx',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 640, y: 121 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_talk', portId: 'in' },
        },
        {
          from: { nodeId: 'n_talk', portId: 'out' },
          to: { nodeId: 'n_endx', portId: 'in' },
        },
      ],
    },
    chapters: [],
    variables: [
      {
        id: 'v_gold',
        name: 'gold',
        displayName: 'Gold',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 5,
      },
    ],
    characters: [
      {
        id: 'c_arys',
        name: 'arys',
        displayName: 'Arys',
        description: 'A wandering scholar.',
        dialogueStyle: 'Warm, curious, and concise.',
        tags: ['scholar', 'traveler'],
        metadata: { faction: 'Academy', level: 2, recruitable: true },
        relationships: { c_bryn: { label: 'Old friend' } },
        emotions: { happy: { displayName: 'Happy' } },
      },
      {
        id: 'c_bryn',
        name: 'bryn',
        displayName: 'Bryn',
        emotions: {},
      },
    ],
    assets: [],
    events: [],
  };
}

describe('story KDL v5', () => {
  it('has a stable serialize-parse-serialize round trip', () => {
    const serialized = serializeStorySource(sourceDocument());
    expect(serializeStorySource(parseStorySource(serialized))).toBe(serialized);
  });

  it('uses compact links, optional names and integer coordinates', () => {
    const serialized = serializeStorySource(sourceDocument());
    expect(serialized).toContain('story-entry n_start');
    expect(serialized).toContain('position n_start x=80 y=120');
    expect(serialized).toContain('link n_start n_talk');
    expect(serialized).not.toContain('definition-version');
    expect(serialized).not.toContain('edge_');
  });

  it('preserves project-level character and asset references without embedding definitions', () => {
    const source = sourceDocument();
    source.characters = [];
    source.assets = [];
    source.root = {
      ...source.root,
      nodes: source.root.nodes.map((node) =>
        node.id === 'n_talk'
          ? {
              ...node,
              data: {
                ...(node.data as Record<string, unknown>),
                lines: [
                  {
                    id: 'ln_greeting',
                    textId: 't_greeting',
                    text: { source: 'Hello {gold}' },
                    speakerId: 'c_projectcharacter',
                    voiceId: 'a_projectvoice',
                    emotion: 'happy',
                  },
                ],
              },
            }
          : node,
      ),
    };

    const parsed = parseStorySource(serializeStorySource(source));
    const dialogue = parsed.root.nodes.find((node) => node.id === 'n_talk');
    expect(dialogue?.data).toEqual(
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            speakerId: 'c_projectcharacter',
            voiceId: 'a_projectvoice',
          }),
        ],
      }),
    );
  });

  it('rejects unknown fields instead of silently dropping them', () => {
    const serialized = serializeStorySource(sourceDocument()).replace(
      'display-name="Test Story"',
      'display-name="Test Story" future-field="keep-me"',
    );
    expect(() => parseStorySource(serialized)).toThrow(/unsupported property future-field/);
  });

  it('rejects duplicate stable IDs', () => {
    const serialized = serializeStorySource(sourceDocument()).replace('n_endx', 'n_start');
    expect(() => parseStorySource(serialized)).toThrow(/Duplicate node ID/);
  });

  it('rejects a Character relationship whose target is missing', () => {
    const source = sourceDocument();
    source.characters = source.characters.filter((character) => character.id !== 'c_bryn');
    expect(() => serializeStorySource(source)).toThrow(/relationship references missing character/);
  });

  it('preserves variables and characters', () => {
    const parsed = parseStorySource(serializeStorySource(sourceDocument()));
    expect(parsed.variables[0]).toMatchObject({ id: 'v_gold', defaultValue: 5 });
    expect(parsed.characters[0]).toMatchObject({ id: 'c_arys', displayName: 'Arys' });
    expect(parsed.characters[0]).toMatchObject({
      tags: ['scholar', 'traveler'],
      metadata: { faction: 'Academy', level: 2, recruitable: true },
    });
  });

  it('preserves quotes inside string literal expressions', () => {
    const source = sourceDocument();
    source.variables = [
      ...source.variables,
      {
        id: 'v_plan',
        name: 'plan',
        displayName: 'Plan',
        scope: 'story',
        valueType: { kind: 'string' },
        defaultValue: '',
      },
    ];
    source.root.nodes = [
      ...source.root.nodes,
      {
        id: 'n_setvalue',
        type: StoryNodeType.SetVariable,
        definitionVersion: 1,
        position: { x: 520, y: 260 },
        data: { variableId: 'v_plan', value: { source: '"A"', bindings: {} } },
      },
    ];

    const serialized = serializeStorySource(source);
    expect(serialized).toContain('value="\\"A\\""');
    const parsed = parseStorySource(serialized);
    expect(parsed.root.nodes.at(-1)?.data).toMatchObject({ value: { source: '"A"' } });
  });

  it('persists stable character field bindings for expressions and text templates', () => {
    const source = sourceDocument();
    source.characters[0]!.fields = [
      {
        id: 'v_affinity',
        name: 'affinity',
        displayName: 'Affinity',
        scope: 'character',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    source.root.nodes = [
      ...source.root.nodes,
      {
        id: 'n_fieldbranch',
        type: StoryNodeType.Branch,
        definitionVersion: 1,
        position: { x: 520, y: 260 },
        data: {
          condition: {
            source: 'arys.affinity > 0',
            bindings: { 'arys.affinity': 'v_affinity' },
          },
        },
      },
    ];
    const dialogue = source.root.nodes.find((node) => node.id === 'n_talk')!;
    const line = (
      dialogue.data as {
        lines: Array<{ text: { source: string; bindings?: Record<string, string> } }>;
      }
    ).lines[0]!;
    line.text = {
      source: 'Affinity {arys.affinity}',
      bindings: { 'arys.affinity': 'v_affinity' },
    };

    const serialized = serializeStorySource(source);
    expect(serialized).toContain('binding condition arys.affinity v_affinity');
    expect(serialized).toContain('binding text arys.affinity v_affinity');
    const parsed = parseStorySource(serialized);
    expect(
      (parsed.root.nodes.at(-1)?.data as { condition: { bindings: object } }).condition.bindings,
    ).toEqual({ 'arys.affinity': 'v_affinity' });
  });

  it('rejects the discarded v1 format without migration', () => {
    const serialized = serializeStorySource(sourceDocument()).replace('version=5', 'version=3');
    expect(() => parseStorySource(serialized)).toThrow(StoryFormatError);
  });
});
