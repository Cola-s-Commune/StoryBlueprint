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
    id: 'story_test',
    name: 'test',
    displayName: 'Test Story',
    root: {
      nodes: [
        {
          id: 'node_start',
          name: 'start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 80, y: 120 },
          data: { title: 'Start' },
        },
        {
          id: 'node_end',
          name: 'end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 360, y: 120 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          id: 'edge_start_end',
          from: { nodeId: 'node_start', portId: 'out' },
          to: { nodeId: 'node_end', portId: 'in' },
        },
      ],
    },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
  };
}

describe('story KDL', () => {
  it('has a stable serialize-parse-serialize round trip', () => {
    const serialized = serializeStorySource(sourceDocument());
    expect(serializeStorySource(parseStorySource(serialized))).toBe(serialized);
  });

  it('rejects unknown fields instead of silently dropping them', () => {
    const serialized = serializeStorySource(sourceDocument()).replace(
      'display-name="Test Story"',
      'display-name="Test Story" future-field="keep-me"',
    );
    expect(() => parseStorySource(serialized)).toThrow(/unsupported property future-field/);
  });

  it('rejects duplicate stable IDs', () => {
    const serialized = serializeStorySource(sourceDocument()).replace('node_end', 'node_start');
    expect(() => parseStorySource(serialized)).toThrow(/Duplicate node ID/);
  });

  it('refuses to serialize source sections the writer cannot preserve yet', () => {
    const source = sourceDocument();
    const unsupported = {
      ...source,
      characters: [
        {
          id: 'character_alice' as const,
          name: 'alice',
          displayName: 'Alice',
          emotions: {},
        },
      ],
    } satisfies StorySourceDocument;
    expect(() => serializeStorySource(unsupported)).toThrow(StoryFormatError);
  });
});
