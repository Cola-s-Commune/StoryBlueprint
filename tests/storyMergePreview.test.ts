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
    version: 4,
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
  it('previews competing execution successors from an unresolved Git stage', () => {
    const conflictedGraph = graph('Local');
    conflictedGraph.nodes.push({
      id: 'n_otherend',
      type: StoryNodeType.End,
      definitionVersion: 1,
      position: { x: 500, y: 300 },
      data: { title: 'Other End' },
    });
    conflictedGraph.edges.push({
      from: { nodeId: 'n_dialogue', portId: 'out' },
      to: { nodeId: 'n_otherend', portId: 'in' },
    });

    const preview = buildStoryMergePreview(
      story(conflictedGraph),
      story(structuredClone(conflictedGraph)),
      [],
    );

    expect(preview.graphs[0].graph.edges).toHaveLength(2);
  });

  it('highlights concurrent inserted nodes and their competing entry edges', () => {
    const localGraph = graph('Before');
    const nodeA = {
      id: 'n_nodea',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 300, y: 0 },
      data: { lines: [{ id: 'ln_nodea', textId: 't_nodea', text: { source: 'Node A' } }] },
    } as const;
    const nodeB = {
      id: 'n_nodeb',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 300, y: 250 },
      data: { lines: [{ id: 'ln_nodeb', textId: 't_nodeb', text: { source: 'Node B' } }] },
    } as const;
    const nodeA2 = {
      ...nodeA,
      id: 'n_nodea2',
      position: { x: 500, y: 0 },
      data: { lines: [{ id: 'ln_nodea2', textId: 't_nodea2', text: { source: 'Node A2' } }] },
    } as const;
    const nodeB2 = {
      ...nodeB,
      id: 'n_nodeb2',
      position: { x: 500, y: 250 },
      data: { lines: [{ id: 'ln_nodeb2', textId: 't_nodeb2', text: { source: 'Node B2' } }] },
    } as const;
    localGraph.nodes.push(nodeA, nodeA2);
    localGraph.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_nodea', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodea', portId: 'out' },
        to: { nodeId: 'n_nodea2', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodea2', portId: 'out' },
        to: { nodeId: 'n_endnode', portId: 'in' },
      },
    ];
    const mergedGraph = structuredClone(localGraph);
    mergedGraph.nodes.push(nodeB, nodeB2);
    mergedGraph.edges.push(
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_nodeb', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodeb', portId: 'out' },
        to: { nodeId: 'n_nodeb2', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodeb2', portId: 'out' },
        to: { nodeId: 'n_endnode', portId: 'in' },
      },
    );
    const localEntry = localGraph.edges[0];
    const remoteEntry = mergedGraph.edges[3];
    const conflict = {
      id: 'story/root/nodes/%40id%3An_dialogue/execution-successor%3Aout',
      path: 'story › root › nodes › @id:n_dialogue › execution-successor:out',
      kind: 'changed' as const,
      localValue: [localEntry],
      remoteValue: [remoteEntry],
      resolution: {
        kind: 'concurrent-insertion' as const,
        localNodeId: 'n_nodea',
        remoteNodeId: 'n_nodeb',
        localNodeIds: ['n_nodea', 'n_nodea2'],
        remoteNodeIds: ['n_nodeb', 'n_nodeb2'],
        localLabel: 'Node A → Node A2 (2 nodes)',
        remoteLabel: 'Node B → Node B2 (2 nodes)',
      },
    };

    const preview = buildStoryMergePreview(story(localGraph), story(mergedGraph), [conflict]);
    const root = preview.graphs[0];
    expect(root.conflictNodeIds.sort()).toEqual([
      'n_nodea',
      'n_nodea2',
      'n_nodeb',
      'n_nodeb2',
    ]);
    expect(root.resolvedNodeIds).toEqual([]);
    expect(root.conflictNodeIds).not.toContain('n_dialogue');
    expect(root.conflictEdgeIds).toHaveLength(2);
    expect(root.nodeConflictIds.n_nodea).toEqual([conflict.id]);
    expect(root.nodeConflictIds.n_nodeb).toEqual([conflict.id]);
    expect(root.nodeConflictIds.n_nodea2).toEqual([conflict.id]);
    expect(root.nodeConflictIds.n_nodeb2).toEqual([conflict.id]);
    expect(root.nodeConflictIds.n_dialogue).toBeUndefined();

    const remoteGraph = graph('Before');
    remoteGraph.nodes.push(nodeB, nodeB2);
    remoteGraph.edges = [remoteEntry, mergedGraph.edges[4], mergedGraph.edges[5]];
    const keepA = buildStoryMergePreview(
      story(localGraph),
      story(structuredClone(localGraph)),
      [conflict],
      { [conflict.id]: 'local' },
      story(remoteGraph),
    ).graphs[0];
    expect(keepA.graph.nodes.map((node) => node.id)).toContain('n_nodeb');
    expect(keepA.removedNodeIds).toEqual(expect.arrayContaining(['n_nodeb', 'n_nodeb2']));
    expect(keepA.resolvedNodeIds.sort()).toEqual(['n_nodea', 'n_nodea2']);
    expect(keepA.conflictNodeIds).toEqual([]);
    expect(keepA.removedEdgeIds).toHaveLength(3);

    const ordered = buildStoryMergePreview(
      story(localGraph),
      story(mergedGraph),
      [conflict],
      { [conflict.id]: 'local-first' },
      story(remoteGraph),
    ).graphs[0];
    expect(ordered.resolvedNodeIds.sort()).toEqual([
      'n_nodea',
      'n_nodea2',
      'n_nodeb',
      'n_nodeb2',
    ]);
    expect(ordered.removedNodeIds).toEqual([]);
  });

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
    expect(root.graph.nodes.find((node) => node.id === 'n_endnode')?.position).not.toEqual(
      root.graph.nodes.find((node) => node.id === 'n_addedxx')?.position,
    );
    expect(root.addedEdgeIds).toHaveLength(1);
    expect(root.removedEdgeIds).toHaveLength(1);
  });

  it('does not classify a position-only layout change as a modified node', () => {
    const local = story(graph('Same content'));
    const merged = structuredClone(local);
    merged.root.nodes[0].position = { x: 900, y: 500 };

    const preview = buildStoryMergePreview(local, merged, []);

    expect(preview.graphs[0].changedNodeIds).toEqual([]);
    expect(preview.graphs[0].graph.nodes[0].position).toEqual({ x: 900, y: 500 });
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
