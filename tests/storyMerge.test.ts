import { beforeAll, describe, expect, it } from 'vitest';
import { nodeRegistry, StoryNodeType, type StorySourceDocument } from '@story-blueprint/common';
import {
  autoLayoutStoryAddedNodeOverlaps,
  autoLayoutStoryConflictNeighborhoods,
  diffThreeWayStoryDocuments,
  diffThreeWayValues,
  diffThreeWayOptionalValues,
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
  mergeThreeWayStoryDocuments,
  mergeThreeWayValues,
  mergeThreeWayOptionalValues,
  storyMergeCoveredConflictIds,
  storyMergeConflictHasDecision,
  unresolvedStoryMergeConflicts,
} from '../packages/editor/src/renderer/graph/storyMerge';
import { fromSourceGraph, toSourceGraph } from '../packages/editor/src/renderer/graph/editorGraph';

const testDataTargetType = 'test-data-target' as StoryNodeType;

beforeAll(() => {
  nodeRegistry.registerBuiltins();
  nodeRegistry.register({
    type: testDataTargetType,
    version: 1,
    label: 'Test Data Target',
    category: 'logic',
    color: '#000',
    inputs: [
      {
        id: 'value',
        label: 'Value',
        kind: 'data',
        direction: 'input',
        valueType: { kind: 'any' },
      },
    ],
    outputs: [],
    defaultData: () => ({}),
  } as never);
});

function story(text: string, includeEnd = true): StorySourceDocument {
  return {
    format: 'story-blueprint',
    version: 4,
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
  it('treats rehydrated graphs and object key order as the same in-memory Story', () => {
    const localSource = story('Local');
    localSource.root.nodes.push({
      id: 'n_choice',
      type: StoryNodeType.Choice,
      definitionVersion: 1,
      position: { x: 300, y: 400 },
      data: {
        prompt: { source: 'Choose' },
        options: [{ id: 'opt_left', text: { source: 'Left' } }],
      },
    });
    const rehydratedGraph = toSourceGraph(fromSourceGraph(localSource.root));
    const rehydratedSource: StorySourceDocument = {
      ...localSource,
      root: {
        edges: rehydratedGraph.edges,
        nodes: rehydratedGraph.nodes,
      },
    };
    const local = mergeableStory(localSource);
    const rehydrated = mergeableStory(rehydratedSource);

    expect(JSON.stringify(rehydrated)).not.toBe(JSON.stringify(local));
    expect(diffStoryDocuments(rehydrated, local)).toEqual([]);
    expect(
      rehydrated.root.nodes.find((node) => node.id === 'n_choice')?.dynamicPorts,
    ).toBeUndefined();
  });

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

  it('groups x and y into one atomic position conflict', () => {
    const local = mergeableStory(story('Same'));
    const remoteSource = story('Same');
    remoteSource.root.nodes[0].position = { x: 900, y: -200 };
    const remote = mergeableStory(remoteSource);
    const conflicts = diffStoryDocuments(local, remote);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path.endsWith('position')).toBe(true);
    expect(conflicts[0].localValue).toEqual({ x: 100, y: 200 });
    expect(conflicts[0].remoteValue).toEqual({ x: 900, y: -200 });
    expect(
      mergeStoryDocuments(local, remote, { [conflicts[0].id]: 'remote' }).root.nodes[0].position,
    ).toEqual({ x: 900, y: -200 });
  });

  it('auto-layouts a coordinate conflict with its direct non-Rerouter neighbor', () => {
    const local = mergeableStory(story('Local'));
    const remote = structuredClone(local);
    remote.root.nodes[0].position = { x: 900, y: -200 };

    const arranged = autoLayoutStoryConflictNeighborhoods(
      local,
      local,
      remote,
      new Set(['n_dialogue']),
      'local-first',
    );

    expect(arranged.root.nodes.find((node) => node.id === 'n_dialogue')?.position).toEqual({
      x: 100,
      y: 200,
    });
    expect(arranged.root.nodes.find((node) => node.id === 'n_endxx')?.position.x).toBeGreaterThan(
      100,
    );
  });

  it('does not traverse a Rerouter when expanding a coordinate conflict neighborhood', () => {
    const localSource = story('Local');
    localSource.root.nodes.splice(1, 0, {
      id: 'n_routex',
      type: StoryNodeType.Reroute,
      definitionVersion: 1,
      position: { x: 300, y: 200 },
      data: {},
    });
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_routex', portId: 'in' },
      },
      {
        from: { nodeId: 'n_routex', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    const local = mergeableStory(localSource);
    const remote = structuredClone(local);
    remote.root.nodes[0].position = { x: 900, y: -200 };

    const arranged = autoLayoutStoryConflictNeighborhoods(
      local,
      local,
      remote,
      new Set(['n_dialogue']),
      'remote-first',
    );

    expect(arranged.root.nodes.find((node) => node.id === 'n_routex')?.position).toEqual({
      x: 300,
      y: 200,
    });
    expect(arranged.root.nodes.find((node) => node.id === 'n_endxx')?.position).toEqual({
      x: 500,
      y: 200,
    });
  });

  it('relocates only incoming nodes that overlap existing nodes', () => {
    const local = mergeableStory(story('Local'));
    const merged = structuredClone(local);
    merged.root.nodes.push({
      id: 'n_addedxx',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 100, y: 200 },
      data: {
        lines: [{ id: 'ln_addedxx', textId: 't_addedxx', text: { source: 'Added' } }],
      },
    });

    const arranged = autoLayoutStoryAddedNodeOverlaps(local, merged);

    expect(arranged.root.nodes.find((node) => node.id === 'n_dialogue')?.position).toEqual({
      x: 100,
      y: 200,
    });
    expect(arranged.root.nodes.find((node) => node.id === 'n_addedxx')?.position).not.toEqual({
      x: 100,
      y: 200,
    });
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

  it('asks which execution successor to keep when both branches reconnect the same output', () => {
    const baseSource = story('Base');
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    localSource.root.nodes.push({
      id: 'n_localend',
      type: StoryNodeType.End,
      definitionVersion: 1,
      position: { x: 700, y: 100 },
      data: { title: 'Local End' },
    });
    remoteSource.root.nodes.push({
      id: 'n_remoteend',
      type: StoryNodeType.End,
      definitionVersion: 1,
      position: { x: 700, y: 300 },
      data: { title: 'Remote End' },
    });
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_localend', portId: 'in' },
      },
    ];
    remoteSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_remoteend', portId: 'in' },
      },
    ];
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const result = diffThreeWayStoryDocuments(base, local, remote);
    const successor = result.conflicts.find((item) => item.resolution?.kind === 'execution-region');

    expect(successor).toBeDefined();
    expect(successor?.resolution).toMatchObject({
      kind: 'execution-region',
      localNodeIds: expect.arrayContaining(['n_dialogue', 'n_localend']),
      remoteNodeIds: expect.arrayContaining(['n_dialogue', 'n_remoteend']),
    });
    expect(result.autoMerged.root.edges).toEqual(
      expect.arrayContaining([...local.root.edges, ...remote.root.edges]),
    );
    expect(
      mergeThreeWayStoryDocuments(base, local, remote, { [successor!.id]: 'local' }).root.edges,
    ).toEqual(local.root.edges);
    expect(
      mergeThreeWayStoryDocuments(base, local, remote, { [successor!.id]: 'remote' }).root.edges,
    ).toEqual(remote.root.edges);
  });

  it('groups multiple competing Choice outputs into one execution-region decision', () => {
    const baseSource = story('Before', false);
    const makeEnd = (id: string, title: string, y: number) => ({
      id,
      type: StoryNodeType.End,
      definitionVersion: 1,
      position: { x: 700, y },
      data: { title },
    });
    baseSource.root.nodes.push(
      {
        id: 'n_choice',
        type: StoryNodeType.Choice,
        definitionVersion: 1,
        position: { x: 350, y: 200 },
        data: {
          prompt: { source: 'Base prompt' },
          options: [
            { id: 'opt_left', text: { source: 'Left' } },
            { id: 'opt_right', text: { source: 'Right' } },
          ],
        },
      },
      makeEnd('n_baseleft', 'Base Left', 100),
      makeEnd('n_baseright', 'Base Right', 300),
    );
    baseSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_choice', portId: 'in' },
      },
      {
        from: { nodeId: 'n_choice', portId: 'opt_left' },
        to: { nodeId: 'n_baseleft', portId: 'in' },
      },
      {
        from: { nodeId: 'n_choice', portId: 'opt_right' },
        to: { nodeId: 'n_baseright', portId: 'in' },
      },
    ];
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    localSource.root.nodes.push(
      makeEnd('n_localleft', 'Local Left', 50),
      makeEnd('n_localright', 'Local Right', 250),
    );
    remoteSource.root.nodes.push(
      makeEnd('n_remoteleft', 'Remote Left', 150),
      makeEnd('n_remoteright', 'Remote Right', 350),
    );
    localSource.root.nodes.find((node) => node.id === 'n_choice')!.data.prompt.source =
      'Local prompt';
    remoteSource.root.nodes.find((node) => node.id === 'n_choice')!.data.prompt.source =
      'Remote prompt';
    localSource.root.edges = [
      baseSource.root.edges[0],
      {
        from: { nodeId: 'n_choice', portId: 'opt_left' },
        to: { nodeId: 'n_localleft', portId: 'in' },
      },
      {
        from: { nodeId: 'n_choice', portId: 'opt_right' },
        to: { nodeId: 'n_localright', portId: 'in' },
      },
    ];
    remoteSource.root.edges = [
      baseSource.root.edges[0],
      {
        from: { nodeId: 'n_choice', portId: 'opt_left' },
        to: { nodeId: 'n_remoteleft', portId: 'in' },
      },
      {
        from: { nodeId: 'n_choice', portId: 'opt_right' },
        to: { nodeId: 'n_remoteright', portId: 'in' },
      },
    ];
    remoteSource.root.nodes = remoteSource.root.nodes.map((node) =>
      node.id === 'n_remoteleft'
        ? {
            id: 'n_remoteleft',
            type: StoryNodeType.Dialogue,
            definitionVersion: 1,
            position: node.position,
            data: {
              lines: [
                {
                  id: 'ln_remoteleft',
                  textId: 't_remoteleft',
                  text: { source: 'Remote cycle A' },
                },
              ],
            },
          }
        : node,
    );
    remoteSource.root.nodes.push({
      id: 'n_remotecycle',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 900, y: 150 },
      data: {
        lines: [
          {
            id: 'ln_remotecycle',
            textId: 't_remotecycle',
            text: { source: 'Remote cycle B' },
          },
        ],
      },
    });
    remoteSource.root.edges.push(
      {
        from: { nodeId: 'n_remoteleft', portId: 'out' },
        to: { nodeId: 'n_remotecycle', portId: 'in' },
      },
      {
        from: { nodeId: 'n_remotecycle', portId: 'out' },
        to: { nodeId: 'n_remoteleft', portId: 'in' },
      },
    );
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const regions = diff.conflicts.filter(
      (conflict) => conflict.resolution?.kind === 'execution-region',
    );

    expect(regions).toHaveLength(1);
    expect(regions[0].resolution).toMatchObject({
      localNodeIds: expect.arrayContaining(['n_choice', 'n_localleft', 'n_localright']),
      remoteNodeIds: expect.arrayContaining(['n_choice', 'n_remoteleft', 'n_remoteright']),
      coreNodeIds: expect.arrayContaining([
        'n_choice',
        'n_localleft',
        'n_localright',
        'n_remoteleft',
        'n_remoteright',
        'n_remotecycle',
      ]),
      boundaryNodeIds: expect.arrayContaining(['n_baseleft', 'n_baseright']),
      changedOutputCount: 2,
      localImpact: { nodesAdded: 2, nodesRemoved: 0, linksAdded: 2, linksRemoved: 2 },
      remoteImpact: { nodesAdded: 3, nodesRemoved: 0, linksAdded: 4, linksRemoved: 2 },
      requiresConfirmation: false,
    });
    const promptConflict = diff.conflicts.find((conflict) => conflict.id.endsWith('/source'))!;
    expect(
      storyMergeCoveredConflictIds(diff.conflicts, { [regions[0].id]: 'remote' }).has(
        promptConflict.id,
      ),
    ).toBe(false);
    expect(
      unresolvedStoryMergeConflicts(diff.conflicts, { [regions[0].id]: 'remote' }).map(
        (conflict) => conflict.id,
      ),
    ).toContain(promptConflict.id);
    const remoteRegion = mergeThreeWayStoryDocuments(base, local, remote, {
      [regions[0].id]: 'remote',
    });
    expect(remoteRegion.root.nodes.map((node) => node.id)).not.toEqual(
      expect.arrayContaining(['n_localleft', 'n_localright']),
    );
    expect(remoteRegion.root.edges).toEqual(remote.root.edges);
    expect(remoteRegion.root.nodes.find((node) => node.id === 'n_choice')!.data.prompt.source).toBe(
      'Local prompt',
    );

    const regionResolution = regions[0].resolution;
    if (regionResolution?.kind !== 'execution-region') throw new Error('Expected region');
    expect(regionResolution.supportsPerOutput).toBe(true);
    const leftOutput = regionResolution.outputs.find(
      (output) => output.sourcePortId === 'opt_left',
    )!;
    const rightOutput = regionResolution.outputs.find(
      (output) => output.sourcePortId === 'opt_right',
    )!;
    const mixedDecisions = {
      [leftOutput.decisionId]: 'local' as const,
      [rightOutput.decisionId]: 'remote' as const,
    };
    expect(
      storyMergeConflictHasDecision(regions[0], {
        [leftOutput.decisionId]: 'local',
      }),
    ).toBe(false);
    expect(storyMergeConflictHasDecision(regions[0], mixedDecisions)).toBe(true);
    const mixed = mergeThreeWayStoryDocuments(base, local, remote, mixedDecisions);
    expect(mixed.root.edges).toEqual([
      baseSource.root.edges[0],
      localSource.root.edges[1],
      remoteSource.root.edges[2],
    ]);
    expect(mixed.root.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['n_localleft', 'n_remoteright']),
    );
    expect(mixed.root.nodes.map((node) => node.id)).not.toEqual(
      expect.arrayContaining(['n_localright', 'n_remoteleft', 'n_remotecycle']),
    );
    expect(
      unresolvedStoryMergeConflicts(diff.conflicts, mixedDecisions).map((conflict) => conflict.id),
    ).toEqual([promptConflict.id]);
  });

  it('keeps a loop, deletion, and Rerouter inside one structural region', () => {
    const baseSource = story('Before');
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    const rerouter = (id: string, y: number) => ({
      id,
      type: StoryNodeType.Reroute,
      definitionVersion: 1,
      position: { x: 350, y },
      data: {},
    });
    localSource.root.nodes = localSource.root.nodes.filter((node) => node.id !== 'n_endxx');
    localSource.root.nodes.push(rerouter('n_localroute', 100));
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_localroute', portId: 'in' },
      },
      {
        from: { nodeId: 'n_localroute', portId: 'out' },
        to: { nodeId: 'n_dialogue', portId: 'in' },
      },
    ];
    remoteSource.root.nodes.push(rerouter('n_remoteroute', 300));
    remoteSource.root.nodes.find((node) => node.id === 'n_endxx')!.data.title = 'Remote End';
    remoteSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_remoteroute', portId: 'in' },
      },
      {
        from: { nodeId: 'n_remoteroute', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const region = diff.conflicts.find(
      (conflict) => conflict.resolution?.kind === 'execution-region',
    );

    expect(region).toBeDefined();
    expect(region?.resolution).toMatchObject({ supportsPerOutput: false });
    const nodePresenceConflict = diff.conflicts.find(
      (conflict) => conflict.id.includes('%40id%3An_endxx') && conflict.resolution === undefined,
    );
    expect(nodePresenceConflict).toBeDefined();
    expect(
      unresolvedStoryMergeConflicts(diff.conflicts, {}).map((conflict) => conflict.id),
    ).toContain(nodePresenceConflict!.id);
    expect(unresolvedStoryMergeConflicts(diff.conflicts, { [region!.id]: 'local' })).toEqual([]);
    expect(unresolvedStoryMergeConflicts(diff.conflicts, { [region!.id]: 'remote' })).toEqual([]);
    expect(
      storyMergeCoveredConflictIds(diff.conflicts, { [region!.id]: 'local' }).has(
        nodePresenceConflict!.id,
      ),
    ).toBe(true);
    const keepLocal = mergeThreeWayStoryDocuments(base, local, remote, {
      [region!.id]: 'local',
    });
    expect(keepLocal.root.edges).toEqual(local.root.edges);
    expect(keepLocal.root.nodes.map((node) => node.id)).not.toContain('n_endxx');
    expect(keepLocal.root.nodes.map((node) => node.id)).not.toContain('n_remoteroute');
    const keepRemote = mergeThreeWayStoryDocuments(base, local, remote, {
      [region!.id]: 'remote',
    });
    expect(keepRemote.root.edges).toEqual(remote.root.edges);
    expect(keepRemote.root.nodes.map((node) => node.id)).toContain('n_endxx');
    expect(keepRemote.root.nodes.map((node) => node.id)).not.toContain('n_localroute');
  });

  it('splits independent conflicts that only meet at a stable boundary node', () => {
    const baseSource = story('First');
    baseSource.root.nodes.push({
      id: 'n_second',
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 100, y: 400 },
      data: {
        lines: [{ id: 'ln_second', textId: 't_second', text: { source: 'Second' } }],
      },
    });
    baseSource.root.edges.push({
      from: { nodeId: 'n_second', portId: 'out' },
      to: { nodeId: 'n_endxx', portId: 'in' },
    });
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    const makeEnd = (id: string, y: number) => ({
      id,
      type: StoryNodeType.End,
      definitionVersion: 1,
      position: { x: 700, y },
      data: { title: id },
    });
    localSource.root.nodes.push(makeEnd('n_localone', 100), makeEnd('n_localtwo', 400));
    remoteSource.root.nodes.push(makeEnd('n_remoteone', 200), makeEnd('n_remotetwo', 500));
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_localone', portId: 'in' },
      },
      {
        from: { nodeId: 'n_second', portId: 'out' },
        to: { nodeId: 'n_localtwo', portId: 'in' },
      },
    ];
    remoteSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_remoteone', portId: 'in' },
      },
      {
        from: { nodeId: 'n_second', portId: 'out' },
        to: { nodeId: 'n_remotetwo', portId: 'in' },
      },
    ];
    const diff = diffThreeWayStoryDocuments(
      mergeableStory(baseSource),
      mergeableStory(localSource),
      mergeableStory(remoteSource),
    );
    const regions = diff.conflicts.filter(
      (conflict) => conflict.resolution?.kind === 'execution-region',
    );

    expect(regions).toHaveLength(2);
    expect(
      regions.map((conflict) =>
        conflict.resolution?.kind === 'execution-region'
          ? conflict.resolution.changedOutputCount
          : 0,
      ),
    ).toEqual([1, 1]);
    for (const conflict of regions) {
      expect(conflict.resolution).toMatchObject({ boundaryNodeIds: ['n_endxx'] });
    }
  });

  it('marks a region with many competing outputs as requiring confirmation', () => {
    const baseSource = story('Before', false);
    const options = Array.from({ length: 5 }, (_, index) => ({
      id: `opt_${index}`,
      text: { source: `Option ${index}` },
    }));
    baseSource.root.nodes.push({
      id: 'n_largechoice',
      type: StoryNodeType.Choice,
      definitionVersion: 1,
      position: { x: 300, y: 200 },
      data: { prompt: { source: 'Choose' }, options },
    });
    baseSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_largechoice', portId: 'in' },
      },
    ];
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    options.forEach((option, index) => {
      const makeEnd = (prefix: string, y: number) => ({
        id: `n_${prefix}${index}`,
        type: StoryNodeType.End,
        definitionVersion: 1,
        position: { x: 700, y },
        data: { title: `${prefix} ${index}` },
      });
      const baseEnd = makeEnd('base', index * 120);
      const localEnd = makeEnd('local', index * 120);
      const remoteEnd = makeEnd('remote', index * 120);
      baseSource.root.nodes.push(baseEnd);
      localSource.root.nodes.push(baseEnd, localEnd);
      remoteSource.root.nodes.push(baseEnd, remoteEnd);
      baseSource.root.edges.push({
        from: { nodeId: 'n_largechoice', portId: option.id },
        to: { nodeId: baseEnd.id, portId: 'in' },
      });
      localSource.root.edges.push({
        from: { nodeId: 'n_largechoice', portId: option.id },
        to: { nodeId: localEnd.id, portId: 'in' },
      });
      remoteSource.root.edges.push({
        from: { nodeId: 'n_largechoice', portId: option.id },
        to: { nodeId: remoteEnd.id, portId: 'in' },
      });
    });
    const diff = diffThreeWayStoryDocuments(
      mergeableStory(baseSource),
      mergeableStory(localSource),
      mergeableStory(remoteSource),
    );
    const region = diff.conflicts.find(
      (conflict) => conflict.resolution?.kind === 'execution-region',
    );

    expect(region?.resolution).toMatchObject({
      changedOutputCount: 5,
      requiresConfirmation: true,
    });
  });

  it('asks which data source to keep when both branches reconnect the same input', () => {
    const baseSource = story('Base');
    for (const id of ['n_sourcebase', 'n_sourcelocal', 'n_sourceremote']) {
      baseSource.root.nodes.push({
        id,
        type: StoryNodeType.GetVariable,
        definitionVersion: 1,
        position: { x: 100, y: 400 },
        data: {},
      });
    }
    baseSource.root.nodes.push({
      id: 'n_datatarget',
      type: testDataTargetType,
      definitionVersion: 1,
      position: { x: 500, y: 400 },
      data: {},
    });
    const dataEdge = (sourceId: string) => ({
      from: { nodeId: sourceId, portId: 'value' },
      to: { nodeId: 'n_datatarget', portId: 'value' },
    });
    baseSource.root.edges.push(dataEdge('n_sourcebase'));
    const localSource = structuredClone(baseSource);
    localSource.root.edges = [
      ...localSource.root.edges.filter((edge) => edge.to.nodeId !== 'n_datatarget'),
      dataEdge('n_sourcelocal'),
    ];
    const remoteSource = structuredClone(baseSource);
    remoteSource.root.edges = [
      ...remoteSource.root.edges.filter((edge) => edge.to.nodeId !== 'n_datatarget'),
      dataEdge('n_sourceremote'),
    ];
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const input = diff.conflicts.find(
      (conflict) => conflict.resolution?.kind === 'connection-competition',
    );

    expect(input?.id).toContain('data-input%3Avalue');
    expect(input?.resolution).toMatchObject({
      localNodeIds: ['n_sourcelocal'],
      remoteNodeIds: ['n_sourceremote'],
    });
    const selectedSource = (choice: 'local' | 'remote') =>
      mergeThreeWayStoryDocuments(base, local, remote, { [input!.id]: choice }).root.edges.find(
        (edge) => edge.to.nodeId === 'n_datatarget',
      )?.from.nodeId;
    expect(selectedSource('local')).toBe('n_sourcelocal');
    expect(selectedSource('remote')).toBe('n_sourceremote');
  });

  it('asks which entry to keep when both branches replace the Start node', () => {
    const baseSource = story('Base');
    const start = (id: string, title: string) => ({
      id,
      type: StoryNodeType.Start,
      definitionVersion: 1,
      position: { x: -200, y: 200 },
      data: { title },
    });
    baseSource.root.nodes.push(start('n_startbase', 'Base Start'));
    baseSource.root.edges.push({
      from: { nodeId: 'n_startbase', portId: 'out' },
      to: { nodeId: 'n_dialogue', portId: 'in' },
    });
    const replaceStart = (source: StorySourceDocument, id: string, title: string) => {
      source.root.nodes = [
        ...source.root.nodes.filter((node) => node.type !== StoryNodeType.Start),
        start(id, title),
      ];
      source.root.edges = [
        ...source.root.edges.filter((edge) => edge.from.nodeId !== 'n_startbase'),
        {
          from: { nodeId: id, portId: 'out' },
          to: { nodeId: 'n_dialogue', portId: 'in' },
        },
      ];
    };
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    replaceStart(localSource, 'n_startlocal', 'Local Start');
    replaceStart(remoteSource, 'n_startremote', 'Remote Start');
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const entry = diff.conflicts.find((conflict) => conflict.resolution?.kind === 'entry-nodes');

    expect(entry).toBeDefined();
    const selectedEntries = (choice: 'local' | 'remote') =>
      mergeThreeWayStoryDocuments(base, local, remote, { [entry!.id]: choice })
        .root.nodes.filter((node) => node.type === StoryNodeType.Start)
        .map((node) => node.id);
    expect(selectedEntries('local')).toEqual(['n_startlocal']);
    expect(selectedEntries('remote')).toEqual(['n_startremote']);
  });

  it('offers ordering and keep-one choices when both branches insert a node on the same edge', () => {
    const baseSource = story('Before');
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    const insertedDialogue = (id: string, text: string, y: number) => ({
      id,
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: 300, y },
      data: {
        lines: [{ id: `ln_${id}`, textId: `t_${id}`, text: { source: text } }],
      },
    });
    localSource.root.nodes.push(insertedDialogue('n_nodea', 'Node A', 100));
    remoteSource.root.nodes.push(insertedDialogue('n_nodeb', 'Node B', 300));
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_nodea', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodea', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    remoteSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_nodeb', portId: 'in' },
      },
      {
        from: { nodeId: 'n_nodeb', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const insertion = diff.conflicts.find(
      (conflict) => conflict.resolution?.kind === 'concurrent-insertion',
    );
    expect(insertion?.resolution).toMatchObject({
      localNodeId: 'n_nodea',
      remoteNodeId: 'n_nodeb',
      localNodeIds: ['n_nodea'],
      remoteNodeIds: ['n_nodeb'],
      localLabel: 'Node A',
      remoteLabel: 'Node B',
    });
    expect(
      diff.autoMerged.root.edges.map((edge) => `${edge.from.nodeId}>${edge.to.nodeId}`),
    ).toEqual(['n_nodea>n_endxx', 'n_nodeb>n_endxx', 'n_dialogue>n_nodea', 'n_dialogue>n_nodeb']);
    const pairs = (choice: 'local' | 'remote' | 'local-first' | 'remote-first') => {
      const merged = mergeThreeWayStoryDocuments(base, local, remote, {
        [insertion!.id]: choice,
      });
      return {
        nodes: merged.root.nodes.map((node) => node.id).sort(),
        edges: merged.root.edges.map((edge) => `${edge.from.nodeId}>${edge.to.nodeId}`),
      };
    };

    expect(pairs('local-first').edges).toEqual([
      'n_dialogue>n_nodea',
      'n_nodea>n_nodeb',
      'n_nodeb>n_endxx',
    ]);
    expect(pairs('remote-first').edges).toEqual([
      'n_dialogue>n_nodeb',
      'n_nodeb>n_nodea',
      'n_nodea>n_endxx',
    ]);
    expect(pairs('local')).toEqual({
      nodes: ['n_dialogue', 'n_endxx', 'n_nodea'],
      edges: ['n_dialogue>n_nodea', 'n_nodea>n_endxx'],
    });
    expect(pairs('remote')).toEqual({
      nodes: ['n_dialogue', 'n_endxx', 'n_nodeb'],
      edges: ['n_dialogue>n_nodeb', 'n_nodeb>n_endxx'],
    });

    const ordered = mergeThreeWayStoryDocuments(base, local, remote, {
      [insertion!.id]: 'local-first',
    });
    const arranged = autoLayoutStoryConflictNeighborhoods(
      ordered,
      local,
      remote,
      new Set(['n_nodea', 'n_nodeb']),
      'local-first',
    );
    const positions = new Map(arranged.root.nodes.map((node) => [node.id, node.position] as const));
    expect(positions.get('n_nodea')!.x).toBeLessThan(positions.get('n_nodeb')!.x);
    expect(positions.get('n_nodeb')!.x).toBeLessThan(positions.get('n_endxx')!.x);
  });

  it('offers the same four choices when both branches insert a simple node chain', () => {
    const baseSource = story('Before');
    const localSource = structuredClone(baseSource);
    const remoteSource = structuredClone(baseSource);
    const insertedDialogue = (id: string, text: string, x: number) => ({
      id,
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x, y: 100 },
      data: {
        lines: [{ id: `ln_${id}`, textId: `t_${id}`, text: { source: text } }],
      },
    });
    localSource.root.nodes.push(
      insertedDialogue('n_locala', 'Local A', 300),
      insertedDialogue('n_localb', 'Local B', 500),
    );
    remoteSource.root.nodes.push(
      insertedDialogue('n_remotea', 'Remote A', 300),
      insertedDialogue('n_remoteb', 'Remote B', 500),
    );
    localSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_locala', portId: 'in' },
      },
      {
        from: { nodeId: 'n_locala', portId: 'out' },
        to: { nodeId: 'n_localb', portId: 'in' },
      },
      {
        from: { nodeId: 'n_localb', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    remoteSource.root.edges = [
      {
        from: { nodeId: 'n_dialogue', portId: 'out' },
        to: { nodeId: 'n_remotea', portId: 'in' },
      },
      {
        from: { nodeId: 'n_remotea', portId: 'out' },
        to: { nodeId: 'n_remoteb', portId: 'in' },
      },
      {
        from: { nodeId: 'n_remoteb', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const insertion = diff.conflicts.find(
      (conflict) => conflict.resolution?.kind === 'concurrent-insertion',
    );

    expect(insertion?.resolution).toMatchObject({
      localNodeIds: ['n_locala', 'n_localb'],
      remoteNodeIds: ['n_remotea', 'n_remoteb'],
      localLabel: 'Local A → Local B (2 nodes)',
      remoteLabel: 'Remote A → Remote B (2 nodes)',
    });
    const result = (choice: 'local' | 'remote' | 'local-first' | 'remote-first') => {
      const merged = mergeThreeWayStoryDocuments(base, local, remote, {
        [insertion!.id]: choice,
      });
      return {
        nodes: merged.root.nodes.map((node) => node.id).sort(),
        edges: merged.root.edges.map((edge) => `${edge.from.nodeId}>${edge.to.nodeId}`),
      };
    };

    expect(result('local-first').edges).toEqual([
      'n_dialogue>n_locala',
      'n_locala>n_localb',
      'n_localb>n_remotea',
      'n_remotea>n_remoteb',
      'n_remoteb>n_endxx',
    ]);
    expect(result('remote-first').edges).toEqual([
      'n_dialogue>n_remotea',
      'n_remotea>n_remoteb',
      'n_remoteb>n_locala',
      'n_locala>n_localb',
      'n_localb>n_endxx',
    ]);
    expect(result('local')).toEqual({
      nodes: ['n_dialogue', 'n_endxx', 'n_locala', 'n_localb'],
      edges: ['n_dialogue>n_locala', 'n_locala>n_localb', 'n_localb>n_endxx'],
    });
    expect(result('remote')).toEqual({
      nodes: ['n_dialogue', 'n_endxx', 'n_remotea', 'n_remoteb'],
      edges: ['n_dialogue>n_remotea', 'n_remotea>n_remoteb', 'n_remoteb>n_endxx'],
    });

    const loopingLocalSource = structuredClone(localSource);
    loopingLocalSource.root.edges[2].to = { nodeId: 'n_locala', portId: 'in' };
    const loopingDiff = diffThreeWayStoryDocuments(
      base,
      mergeableStory(loopingLocalSource),
      remote,
    );
    expect(
      loopingDiff.conflicts.some(
        (conflict) => conflict.resolution?.kind === 'concurrent-insertion',
      ),
    ).toBe(false);

    const branchingLocalSource = structuredClone(localSource);
    branchingLocalSource.root.edges.push({
      from: { nodeId: 'n_locala', portId: 'out' },
      to: { nodeId: 'n_endxx', portId: 'in' },
    });
    const branchingDiff = diffThreeWayStoryDocuments(
      base,
      mergeableStory(branchingLocalSource),
      remote,
    );
    expect(
      branchingDiff.conflicts.some(
        (conflict) => conflict.resolution?.kind === 'concurrent-insertion',
      ),
    ).toBe(false);
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

  it('asks which side comes first when both branches insert Lines into the same gap', () => {
    const baseSource = story('First');
    baseSource.root.nodes[0].data.lines.push({
      id: 'ln_lastxx',
      textId: 't_lastxx',
      text: { source: 'Last' },
    });
    const localSource = structuredClone(baseSource);
    localSource.root.nodes[0].data.lines.splice(1, 0, {
      id: 'ln_localxx',
      textId: 't_localxx',
      text: { source: 'Local inserted' },
    });
    const remoteSource = structuredClone(baseSource);
    remoteSource.root.nodes[0].data.lines.splice(1, 0, {
      id: 'ln_remotexx',
      textId: 't_remotexx',
      text: { source: 'Remote inserted' },
    });
    const base = mergeableStory(baseSource);
    const local = mergeableStory(localSource);
    const remote = mergeableStory(remoteSource);
    const diff = diffThreeWayStoryDocuments(base, local, remote);
    const order = diff.conflicts.find((conflict) => conflict.id.endsWith('%40order'));
    const lineIds = (choice: 'local' | 'remote') =>
      (
        mergeThreeWayStoryDocuments(base, local, remote, { [order!.id]: choice }).root.nodes[0].data
          .lines as Array<{ id: string }>
      ).map((line) => line.id);

    expect(order).toBeDefined();
    expect(lineIds('local')).toEqual(['ln_merge', 'ln_localxx', 'ln_remotexx', 'ln_lastxx']);
    expect(lineIds('remote')).toEqual(['ln_merge', 'ln_remotexx', 'ln_localxx', 'ln_lastxx']);
  });
});

describe('Project resource semantic merge', () => {
  it('merges Event parameters by name and asks how concurrent additions should be ordered', () => {
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
    expect(diff.conflicts).toHaveLength(2);
    const description = diff.conflicts.find((conflict) => conflict.path.includes('description'))!;
    const order = diff.conflicts.find((conflict) => conflict.id.endsWith('%40order'))!;
    const merged = mergeThreeWayValues(
      base,
      local,
      remote,
      { [description.id]: 'remote', [order.id]: 'local' },
      'project/event:e_merge',
    );
    expect(merged.description).toBe('Remote docs');
    expect(merged.parameters.map((parameter) => parameter.name)).toEqual([
      'target',
      'speed',
      'loop',
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

describe('Structured value semantic merge', () => {
  it('merges independent insertions in an unkeyed array instead of conflicting on the whole array', () => {
    const base = { values: [1, 2] };
    const local = { values: [1, 10, 2] };
    const remote = { values: [1, 2, 20] };

    const diff = diffThreeWayValues(base, local, remote, 'variable:inventory');

    expect(diff.conflicts).toEqual([]);
    expect(diff.autoMerged).toEqual({ values: [1, 10, 2, 20] });
  });

  it('reports a conflicting unkeyed array element at element depth', () => {
    const base = { values: [{ label: 'Base', count: 1 }] };
    const local = { values: [{ label: 'Local', count: 1 }] };
    const remote = { values: [{ label: 'Remote', count: 1 }] };

    const diff = diffThreeWayValues(base, local, remote, 'variable:inventory');

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].path).toContain('label');
    expect(diff.conflicts[0].path).not.toBe('variable:inventory/values');
  });

  it('ignores internal structured-type metadata when comparing values', () => {
    const base = {
      payload: { name: 'Alice', $storyBlueprintType: 'et_old' },
    };
    const local = {
      payload: { name: 'Alice', $storyBlueprintType: 'et_current' },
    };
    const remote = {
      payload: { name: 'Alice', $storyBlueprintType: 'et_remote' },
    };

    const diff = diffThreeWayValues(base, local, remote, 'variable:profile');

    expect(diff.conflicts).toEqual([]);
    expect(diff.autoMerged.payload.name).toBe('Alice');
  });
});
