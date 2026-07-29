import { describe, expect, it } from 'vitest';
import { StoryNodeType, type StorySemanticSnapshot } from '@story-blueprint/common';
import {
  buildStorySearchIndex,
  searchStoryIndex,
} from '../packages/editor/src/renderer/graph/storySearch';

const snapshot = {
  format: 'story-blueprint-semantic',
  version: 1,
  revision: 'rev_search',
  story: { id: 's_search', name: 'search', displayName: 'Search Story' },
  variables: [
    {
      id: 'v_plan',
      name: 'plan',
      displayName: 'Current Plan',
      scope: 'story',
      valueType: { kind: 'string' },
      defaultValue: '',
    },
  ],
  characters: [
    {
      id: 'c_alice',
      name: 'alice',
      displayName: 'Alice',
      emotions: {},
      metadata: {},
    },
  ],
  assets: [],
  events: [],
  signals: [],
  graphs: [
    {
      kind: 'root',
      name: 'root',
      displayName: 'Root Blueprint',
      connections: [],
      nodes: [
        {
          id: 'n_greeting',
          type: StoryNodeType.Dialogue,
          data: {
            lines: [
              {
                id: 'ln_hello',
                textId: 't_hello',
                speakerId: 'c_alice',
                text: { source: '秘密计划现在开始。' },
              },
            ],
          },
          ports: [],
        },
      ],
    },
    {
      kind: 'chapter',
      chapterId: 'ch_escape',
      name: 'escape',
      displayName: 'Escape Route',
      connections: [],
      nodes: [
        {
          id: 'n_choice',
          type: StoryNodeType.Choice,
          data: {
            prompt: { source: 'Choose an exit' },
            options: [{ id: 'o_roof', textId: 't_roof', text: { source: 'Take the rooftop' } }],
          },
          ports: [],
        },
      ],
    },
  ],
} as unknown as StorySemanticSnapshot;

describe('Story search', () => {
  const index = buildStorySearchIndex(snapshot);

  it('finds Dialogue text and its resolved speaker name', () => {
    expect(searchStoryIndex(index, '秘密计划')).toMatchObject([
      { kind: 'node', nodeId: 'n_greeting', graphId: 'root' },
    ]);
    expect(searchStoryIndex(index, 'Alice 秘密')).toMatchObject([
      { kind: 'node', nodeId: 'n_greeting' },
    ]);
  });

  it('finds Choice options inside a Substory', () => {
    expect(searchStoryIndex(index, 'rooftop')).toMatchObject([
      { kind: 'node', nodeId: 'n_choice', graphId: 'ch_escape' },
    ]);
  });

  it('includes editable Story Data resources', () => {
    expect(searchStoryIndex(index, 'Current Plan')).toMatchObject([
      { kind: 'resource', selection: { kind: 'variable', id: 'v_plan' } },
    ]);
  });
});
