import { describe, expect, it } from 'vitest';
import { StoryNodeType, type StorySourceDocument } from '@story-blueprint/common';
import {
  diffThreeWayStoryDocuments,
  diffThreeWayValues,
  diffThreeWayOptionalValues,
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
  mergeThreeWayStoryDocuments,
  mergeThreeWayValues,
  mergeThreeWayOptionalValues,
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

  it('auto-merges disjoint Local and Remote changes from a common Base', () => {
    const baseSource = story('Base');
    const localSource = story('Local text');
    const remoteSource = story('Base');
    remoteSource.root.nodes[0].position = { x: 700, y: 450 };
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const result = diffThreeWayStoryDocuments(base, local, remote);
    expect(result.conflicts).toEqual([]);
    const dialogue = result.autoMerged.root.nodes[0];
    expect(dialogue.data.lines[0].text.source).toBe('Local text');
    expect(dialogue.position).toEqual({ x: 700, y: 450 });
  });

  it('only asks when Local and Remote changed the same field differently', () => {
    const base = mergeableStory(story('Base'));
    const local = mergeableStory(story('Local'));
    const remote = mergeableStory(story('Remote'));
    const result = diffThreeWayStoryDocuments(base, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.autoMerged.root.nodes[0].data.lines[0].text.source).toBe('Local');
    const merged = mergeThreeWayStoryDocuments(base, local, remote, {
      [result.conflicts[0].id]: 'remote',
    });
    expect(merged.root.nodes[0].data.lines[0].text.source).toBe('Remote');
  });

  it('auto-inserts a Line added only by Remote at the correct position', () => {
    const baseSource = story('First');
    baseSource.root.nodes[0].data.lines.push({
      id: 'ln_third',
      textId: 't_third',
      text: { source: 'Third' },
    });
    const localSource = structuredClone(baseSource);
    localSource.root.nodes[0].data.lines[0].tags = ['local-tag'];
    const remoteSource = structuredClone(baseSource);
    remoteSource.root.nodes[0].data.lines.splice(1, 0, {
      id: 'ln_second',
      textId: 't_second',
      text: { source: 'Second' },
    });
    const result = diffThreeWayStoryDocuments(
      mergeableStory(baseSource),
      mergeableStory(localSource),
      mergeableStory(remoteSource),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged.root.nodes[0].data.lines.map((line) => line.id)).toEqual([
      'ln_merge',
      'ln_second',
      'ln_third',
    ]);
    expect(result.autoMerged.root.nodes[0].data.lines[0].tags).toEqual(['local-tag']);
  });
});

describe('Project resource semantic merge', () => {
  it('merges Event parameters by name and reports only the shared field conflict', () => {
    const base = {
      id: 'e_merge',
      description: 'Base',
      parameters: [{ name: 'target', valueType: { kind: 'string' } }],
    };
    const local = {
      ...base,
      description: 'Local docs',
      parameters: [...base.parameters, { name: 'speed', valueType: { kind: 'number' } }],
    };
    const remote = {
      ...base,
      description: 'Remote docs',
      parameters: [...base.parameters, { name: 'loop', valueType: { kind: 'boolean' } }],
    };

    const diff = diffThreeWayValues(base, local, remote, 'project/event:e_merge');
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].path).toContain('description');
    const merged = mergeThreeWayValues(
      base,
      local,
      remote,
      { [diff.conflicts[0].id]: 'remote' },
      'project/event:e_merge',
    );
    expect(merged.description).toBe('Remote docs');
    expect(merged.parameters.map((parameter) => parameter.name).sort()).toEqual([
      'loop',
      'speed',
      'target',
    ]);
  });

  it('represents modify/delete as a Keep/Delete root decision', () => {
    const base = { id: 'c_merge', displayName: 'Base' };
    const local = { id: 'c_merge', displayName: 'Local edit' };
    const diff = diffThreeWayOptionalValues(base, local, undefined, 'character:hero');
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]).toMatchObject({
      id: 'character:hero',
      kind: 'local-only',
    });
    expect(mergeThreeWayOptionalValues(base, local, undefined, {})).toEqual(local);
    expect(
      mergeThreeWayOptionalValues(
        base,
        local,
        undefined,
        { 'character:hero': 'remote' },
        'character:hero',
      ),
    ).toBeUndefined();
  });

  it('merges add/add resources when they share a stable ID', () => {
    const local = { id: 'a_merge', name: 'portrait', displayName: 'Local' };
    const remote = { id: 'a_merge', name: 'portrait', displayName: 'Remote' };
    const diff = diffThreeWayOptionalValues(undefined, local, remote, 'asset:new');
    expect(diff.conflicts).toHaveLength(1);
    const merged = mergeThreeWayOptionalValues(
      undefined,
      local,
      remote,
      { [diff.conflicts[0].id]: 'remote' },
      'asset:new',
    );
    expect(merged?.displayName).toBe('Remote');
  });
});
