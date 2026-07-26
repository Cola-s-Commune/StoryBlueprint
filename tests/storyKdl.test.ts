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
          data: { speakerId: 'c_arys', text: { source: 'Hello {gold}' }, emotion: 'happy' },
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
        emotions: { happy: { displayName: 'Happy' } },
      },
    ],
    assets: [],
    events: [],
  };
}

describe('story KDL v2', () => {
  it('has a stable serialize-parse-serialize round trip', () => {
    const serialized = serializeStorySource(sourceDocument());
    expect(serializeStorySource(parseStorySource(serialized))).toBe(serialized);
  });

  it('uses compact links, optional names and integer coordinates', () => {
    const serialized = serializeStorySource(sourceDocument());
    expect(serialized).toContain('story-entry n_start x=80 y=120');
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
                speakerId: 'c_projectcharacter',
                voiceId: 'a_projectvoice',
              },
            }
          : node,
      ),
    };

    const parsed = parseStorySource(serializeStorySource(source));
    const dialogue = parsed.root.nodes.find((node) => node.id === 'n_talk');
    expect(dialogue?.data).toEqual(
      expect.objectContaining({
        speakerId: 'c_projectcharacter',
        voiceId: 'a_projectvoice',
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

  it('preserves variables and characters', () => {
    const parsed = parseStorySource(serializeStorySource(sourceDocument()));
    expect(parsed.variables[0]).toMatchObject({ id: 'v_gold', defaultValue: 5 });
    expect(parsed.characters[0]).toMatchObject({ id: 'c_arys', displayName: 'Arys' });
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

  it('rejects the discarded v1 format without migration', () => {
    const serialized = serializeStorySource(sourceDocument()).replace('version=2', 'version=1');
    expect(() => parseStorySource(serialized)).toThrow(StoryFormatError);
  });
});
