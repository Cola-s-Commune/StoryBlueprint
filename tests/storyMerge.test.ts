import { describe, expect, it } from 'vitest';
import { StoryNodeType, type StorySourceDocument } from '@story-blueprint/common';
import {
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
} from '../packages/editor/src/renderer/graph/storyMerge';

function story(text: string, includeEnd = true): StorySourceDocument {
  return {
    format: 'story-blueprint',
    version: 3,
    id: 's_merge',
    name: 'merge',
    displayName: 'Merge',
    variables: [],
    characters: [],
    assets: [],
    events: [],
    signals: [],
    chapters: [],
    root: {
      nodes: [
        {
          id: 'n_dialogue',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 100, y: 200 },
          data: {
            lines: [{ id: 'ln_merge', textId: 't_merge', text: { source: text }, tags: ['intro'] }],
          },
        },
        ...(includeEnd
          ? [
              {
                id: 'n_endxx',
                type: StoryNodeType.End,
                definitionVersion: 1,
                position: { x: 500, y: 200 },
                data: { title: 'End' },
              },
            ]
          : []),
      ],
      edges: includeEnd
        ? [
            {
              from: { nodeId: 'n_dialogue', portId: 'out' },
              to: { nodeId: 'n_endxx', portId: 'in' },
            },
          ]
        : [],
    },
  } as StorySourceDocument;
}

describe('Story semantic merge', () => {
  it('diffs a Dialogue Line field by stable IDs instead of replacing the node', () => {
    const conflicts = diffStoryDocuments(
      mergeableStory(story('Local')),
      mergeableStory(story('Remote')),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'changed',
      localValue: 'Local',
      remoteValue: 'Remote',
    });
    expect(conflicts[0].path).toContain('@id:ln_merge');
    expect(conflicts[0].path).toContain('source');
  });

  it('can take one remote field while retaining unrelated local fields', () => {
    const local = mergeableStory(story('Local'));
    const remoteSource = story('Remote');
    remoteSource.root.nodes[0].position = { x: 900, y: 700 };
    const remote = mergeableStory(remoteSource);
    const conflicts = diffStoryDocuments(local, remote);
    const textConflict = conflicts.find((item) => item.path.endsWith('text › source'))!;
    const merged = mergeStoryDocuments(local, remote, { [textConflict.id]: 'remote' });
    const dialogue = merged.root.nodes.find((node) => node.id === 'n_dialogue')!;
    expect(dialogue.data.lines[0].text.source).toBe('Remote');
    expect(dialogue.position).toEqual({ x: 100, y: 200 });
  });

  it('supports choosing a remote deletion without disturbing retained nodes', () => {
    const local = mergeableStory(story('Local'));
    const remote = mergeableStory(story('Local', false));
    const conflicts = diffStoryDocuments(local, remote);
    const deletedNode = conflicts.find((item) => item.path.includes('@id:n_endxx'))!;
    const deletedEdge = conflicts.find((item) => item.path.includes('@edge:'))!;
    const merged = mergeStoryDocuments(local, remote, {
      [deletedNode.id]: 'remote',
      [deletedEdge.id]: 'remote',
    });
    expect(merged.root.nodes.map((node) => node.id)).toEqual(['n_dialogue']);
    expect(merged.root.edges).toEqual([]);
  });

  it('inserts a selected remote Line at its semantic position', () => {
    const localSource = story('First');
    localSource.root.nodes[0].data.lines.push({
      id: 'ln_third',
      textId: 't_third',
      text: { source: 'Third' },
    });
    const remoteSource = structuredClone(localSource);
    remoteSource.root.nodes[0].data.lines.splice(1, 0, {
      id: 'ln_second',
      textId: 't_second',
      text: { source: 'Second' },
    });
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const addedLine = diffStoryDocuments(local, remote).find((item) =>
      item.path.includes('@id:ln_second'),
    )!;
    const merged = mergeStoryDocuments(local, remote, { [addedLine.id]: 'remote' });
    expect(merged.root.nodes[0].data.lines.map((line) => line.id)).toEqual([
      'ln_merge',
      'ln_second',
      'ln_third',
    ]);
  });
});
