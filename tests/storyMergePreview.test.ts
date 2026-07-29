import { describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  nodeRegistry,
  type SourceGraph,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { buildStoryMergePreview } from '../packages/editor/src/renderer/graph/storyMergePreview';

nodeRegistry.registerBuiltins();

function graph(text: string): SourceGraph {
  return {
    nodes: [
      {
        id: 'n_dialogue',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 100, y: 100 },
        data: {
          lines: [{ id: 'ln_preview', textId: 't_preview', text: { source: text } }],
        },
      },
      {
        id: 'n_endnode',
        type: StoryNodeType.End,
        definitionVersion: 1,
        position: { x: 500, y: 100 },
        data: { title: 'End' },
      },
    ],
    edges: [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_endnode', portId: 'in' },
      },
    ],
  };
}

function story(root: SourceGraph): StorySourceDocument {
  return {
    format: 'story-blueprint',
    version: 3,
    id: 's_preview',
    name: 'preview',
    displayName: 'Preview',
    variables: [],
    characters: [],
    assets: [],
    events: [],
    signals: [],
    chapters: [],
    root,
  };
}

describe('Story merge graph preview', () => {
  it('classifies added, modified, removed, and conflicted graph elements', () => {
    const local = story(graph('Local'));
    const mergedGraph = graph('Remote');
    mergedGraph.nodes.splice(1, 1, {
      id: 'n_addedxx',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 500, y: 100 },
      data: {
        lines: [{ id: 'ln_addedxx', textId: 't_addedxx', text: { source: 'Added' } }],
      },
    });
    mergedGraph.edges.splice(0, 1, {
      from: { nodeId: 'n_dialogue', portId: 'out' },
      to: { nodeId: 'n_addedxx', portId: 'in' },
    });
    const merged = story(mergedGraph);
    const preview = buildStoryMergePreview(local, merged, [
      {
        id: 'story/root/nodes/%40id%3An_dialogue/data/lines/%40id%3Aln_preview/text/source',
        path: 'Dialogue text',
        kind: 'changed',
        localValue: 'Local',
        remoteValue: 'Remote',
      },
    ]);

    const root = preview.graphs[0];
    expect(root.addedNodeIds).toEqual(['n_addedxx']);
    expect(root.changedNodeIds).toEqual(['n_dialogue']);
    expect(root.removedNodeIds).toEqual(['n_endnode']);
    expect(root.conflictNodeIds).toEqual(['n_dialogue']);
    expect(root.graph.nodes.map((node) => node.id)).toEqual([
      'n_dialogue',
      'n_addedxx',
      'n_endnode',
    ]);
    expect(root.addedEdgeIds).toHaveLength(1);
    expect(root.removedEdgeIds).toHaveLength(1);
  });

  it('keeps existing Substories available as separate preview graphs', () => {
    const local = story(graph('Root'));
    local.chapters = [
      {
        id: 'ch_preview',
        name: 'branch',
        displayName: 'Branch',
        parameters: [],
        localVariables: [],
        graph: graph('Local branch'),
      },
    ];
    const merged = structuredClone(local);
    merged.chapters[0].graph.nodes[0].data = {
      lines: [{ id: 'ln_preview', textId: 't_preview', text: { source: 'Merged branch' } }],
    };

    const preview = buildStoryMergePreview(local, merged, []);
    expect(preview.graphs.map((item) => [item.id, item.displayName])).toEqual([
      ['root', 'Main Story'],
      ['ch_preview', 'Branch'],
    ]);
    expect(preview.graphs[1].changedNodeIds).toEqual(['n_dialogue']);
  });

  it('keeps resolved conflict metadata while removing its conflict highlight', () => {
    const local = story(graph('Local'));
    const merged = story(graph('Remote'));
    const conflict = {
      id: 'story/root/nodes/%40id%3An_dialogue/data/lines/%40id%3Aln_preview/text/source',
      path: 'Dialogue text',
      kind: 'changed' as const,
      localValue: 'Local',
      remoteValue: 'Remote',
    };
    const preview = buildStoryMergePreview(local, merged, [conflict], {
      [conflict.id]: 'remote',
    });

    expect(preview.graphs[0].conflictNodeIds).toEqual([]);
    expect(preview.graphs[0].nodeConflictIds.n_dialogue).toEqual([conflict.id]);
    expect(preview.decisions[conflict.id]).toBe('remote');
  });

  it('creates a virtual preview graph for a remotely added Substory', () => {
    const local = story(graph('Root'));
    const merged = structuredClone(local);
    merged.chapters = [
      {
        id: 'ch_remote',
        name: 'remote',
        displayName: 'Remote Chapter',
        parameters: [],
        localVariables: [],
        graph: graph('Remote only'),
      },
    ];

    const preview = buildStoryMergePreview(local, merged, []);
    const remote = preview.graphs.find((item) => item.id === 'ch_remote');
    expect(remote?.displayName).toBe('Remote Chapter');
    expect(remote?.addedNodeIds).toEqual(['n_dialogue', 'n_endnode']);
    expect(remote?.addedEdgeIds).toHaveLength(1);
  });
});
