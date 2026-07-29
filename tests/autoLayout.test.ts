import { beforeAll, describe, expect, it } from 'vitest';
import { nodeRegistry, StoryNodeType } from '@story-blueprint/common';
import {
  autoLayoutGraph,
  type EditorGraphNode,
  type EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';

beforeAll(() => nodeRegistry.registerBuiltins());

function node(id: `n_${string}`, type: StoryNodeType, x: number, y: number): EditorGraphNode {
  const data =
    type === StoryNodeType.Start || type === StoryNodeType.End
      ? { title: type }
      : { lines: [{ id: `ln_${id}`, textId: `t_${id}`, text: { source: id } }] };
  return { id, type, position: { x, y }, data, definitionVersion: 1, selected: false };
}

function edge(id: `e_${string}`, source: `n_${string}`, target: `n_${string}`) {
  return { id, source, sourceHandle: 'out', target, targetHandle: 'in' };
}

describe('automatic graph layout', () => {
  it('arranges an execution chain from left to right', () => {
    const graph: EditorGraphState = {
      nodes: [
        node('n_start', StoryNodeType.Start, 900, 300),
        node('n_linea', StoryNodeType.Dialogue, 0, 0),
        node('n_endxx', StoryNodeType.End, 300, 700),
      ],
      edges: [edge('e_first', 'n_start', 'n_linea'), edge('e_lastxx', 'n_linea', 'n_endxx')],
    };
    const result = autoLayoutGraph(graph);
    const positions = new Map(result.nodes.map((candidate) => [candidate.id, candidate.position]));
    expect(positions.get('n_start')!.x).toBeLessThan(positions.get('n_linea')!.x);
    expect(positions.get('n_linea')!.x).toBeLessThan(positions.get('n_endxx')!.x);
  });

  it('handles a loop without moving nodes forever', () => {
    const graph: EditorGraphState = {
      nodes: [
        node('n_start', StoryNodeType.Start, 0, 0),
        node('n_linea', StoryNodeType.Dialogue, 0, 0),
        node('n_lineb', StoryNodeType.Dialogue, 0, 0),
      ],
      edges: [
        edge('e_first', 'n_start', 'n_linea'),
        edge('e_nextx', 'n_linea', 'n_lineb'),
        edge('e_loopxx', 'n_lineb', 'n_linea'),
      ],
    };
    const result = autoLayoutGraph(graph);
    expect(result.nodes.map((candidate) => candidate.position)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 600, y: 0 },
    ]);
  });

  it('keeps nodes outside the selected layout untouched', () => {
    const fixed = node('n_fixed', StoryNodeType.End, 777, 555);
    const first = node('n_first', StoryNodeType.Dialogue, 400, 300);
    const second = node('n_second', StoryNodeType.Dialogue, 0, 0);
    const graph: EditorGraphState = {
      nodes: [fixed, first, second],
      edges: [edge('e_pairxx', 'n_first', 'n_second')],
    };
    const result = autoLayoutGraph(graph, ['n_first', 'n_second']);
    expect(result.nodes.find((candidate) => candidate.id === 'n_fixed')?.position).toEqual({
      x: 777,
      y: 555,
    });
    expect(result.nodes.find((candidate) => candidate.id === 'n_first')!.position.x).toBeLessThan(
      result.nodes.find((candidate) => candidate.id === 'n_second')!.position.x,
    );
  });
});
