import { describe, expect, it } from 'vitest';
import { StoryNodeType } from '../packages/common/src';
import {
  prepareAIGraphChanges,
  type EditorGraphNode,
  type EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';

function node(
  id: `n_${string}`,
  type: StoryNodeType,
  x: number,
  y: number,
  data: EditorGraphNode['data'],
): EditorGraphNode {
  return { id, type, position: { x, y }, data, definitionVersion: 1, selected: false };
}

function edge(id: `e_${string}`, source: `n_${string}`, target: `n_${string}`) {
  return {
    id,
    source,
    sourceHandle: 'out',
    target,
    targetHandle: 'in',
  };
}

describe('AI graph feedback', () => {
  it('places a new flow node between its authored neighbors without moving them', () => {
    const start = node('n_start', StoryNodeType.Start, 0, 40, { title: 'Start' });
    const end = node('n_endxx', StoryNodeType.End, 840, 40, { title: 'End' });
    const dialogue = node('n_added', StoryNodeType.Dialogue, 9999, 9999, {
      lines: [{ id: 'ln_added', textId: 't_added', text: { source: 'Hello' } }],
    });
    const before: EditorGraphState = {
      nodes: [start, end],
      edges: [edge('e_oldxx', 'n_start', 'n_endxx')],
    };
    const after: EditorGraphState = {
      nodes: [start, end, dialogue],
      edges: [edge('e_first', 'n_start', 'n_added'), edge('e_second', 'n_added', 'n_endxx')],
    };
    const result = prepareAIGraphChanges(before, after);
    expect(result.addedNodeIds).toEqual(['n_added']);
    expect(result.changedNodeIds).toEqual([]);
    expect(result.graph.nodes.find((candidate) => candidate.id === 'n_start')?.position).toEqual({
      x: 0,
      y: 40,
    });
    expect(result.graph.nodes.find((candidate) => candidate.id === 'n_endxx')?.position).toEqual({
      x: 840,
      y: 40,
    });
    expect(result.graph.nodes.find((candidate) => candidate.id === 'n_added')).toMatchObject({
      position: { x: 420, y: 40 },
      selected: true,
    });
  });

  it('lays out a chain from left to right and reports semantic changes and removals', () => {
    const start = node('n_start', StoryNodeType.Start, 0, 0, { title: 'Start' });
    const changedEnd = node('n_endxx', StoryNodeType.End, 1120, 0, { title: 'New ending' });
    const oldEnd = { ...changedEnd, data: { title: 'Old ending' } };
    const removed = node('n_remove', StoryNodeType.Dialogue, 560, 300, {
      lines: [{ id: 'ln_remove', textId: 't_remove', text: { source: 'Remove' } }],
    });
    const first = node('n_first', StoryNodeType.Dialogue, 0, 0, {
      lines: [{ id: 'ln_first', textId: 't_first', text: { source: 'First' } }],
    });
    const second = node('n_second', StoryNodeType.Dialogue, 0, 0, {
      lines: [{ id: 'ln_second', textId: 't_second', text: { source: 'Second' } }],
    });
    const before: EditorGraphState = { nodes: [start, oldEnd, removed], edges: [] };
    const after: EditorGraphState = {
      nodes: [start, changedEnd, first, second],
      edges: [
        edge('e_first', 'n_start', 'n_first'),
        edge('e_middle', 'n_first', 'n_second'),
        edge('e_lastxx', 'n_second', 'n_endxx'),
      ],
    };
    const result = prepareAIGraphChanges(before, after);
    expect(result.addedNodeIds).toEqual(['n_first', 'n_second']);
    expect(result.changedNodeIds).toEqual(['n_endxx']);
    expect(result.removedNodeIds).toEqual(['n_remove']);
    const firstX = result.graph.nodes.find((candidate) => candidate.id === 'n_first')!.position.x;
    const secondX = result.graph.nodes.find((candidate) => candidate.id === 'n_second')!.position.x;
    expect(firstX).toBeGreaterThan(0);
    expect(secondX).toBeGreaterThan(firstX);
    expect(secondX).toBeLessThan(1120);
  });
});
