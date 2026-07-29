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
      { x: 310, y: 0 },
      { x: 620, y: 0 },
    ]);
  });

  it('uses measured node sizes to prevent wide and tall nodes from overlapping', () => {
    const start = {
      ...node('n_start', StoryNodeType.Start, 0, 0, { title: 'Start' }),
      measured: { width: 340, height: 100 },
    };
    const upper = {
      ...node('n_upper', StoryNodeType.Dialogue, 0, 0, {
        lines: [{ id: 'ln_upper', textId: 't_upper', text: { source: 'Upper' } }],
      }),
      measured: { width: 280, height: 260 },
    };
    const lower = {
      ...node('n_lower', StoryNodeType.Dialogue, 0, 20, {
        lines: [{ id: 'ln_lower', textId: 't_lower', text: { source: 'Lower' } }],
      }),
      measured: { width: 280, height: 360 },
    };
    const result = autoLayoutGraph({
      nodes: [start, upper, lower],
      edges: [edge('e_upper', 'n_start', 'n_upper'), edge('e_lower', 'n_start', 'n_lower')],
    });
    const positions = new Map(result.nodes.map((candidate) => [candidate.id, candidate.position]));
    expect(positions.get('n_upper')!.x).toBeGreaterThanOrEqual(430);
    expect(positions.get('n_lower')!.y - positions.get('n_upper')!.y).toBeGreaterThanOrEqual(316);
  });

  it('collapses Reroutes for story layering and sends return wires below the graph', () => {
    const start = node('n_start', StoryNodeType.Start, 0, 0, { title: 'Start' });
    const left = node('n_leftxx', StoryNodeType.Dialogue, 0, 0, {
      lines: [{ id: 'ln_leftxx', textId: 't_leftxx', text: { source: 'Left' } }],
    });
    const right = node('n_rightx', StoryNodeType.Dialogue, 0, 0, {
      lines: [{ id: 'ln_rightx', textId: 't_rightx', text: { source: 'Right' } }],
    });
    const reroute = {
      ...node('n_routex', StoryNodeType.Reroute, 999, 20, {}),
      measured: { width: 18, height: 18 },
    };
    const result = autoLayoutGraph({
      nodes: [start, left, right, reroute],
      edges: [
        edge('e_entryx', 'n_start', 'n_leftxx'),
        edge('e_nextxx', 'n_leftxx', 'n_rightx'),
        edge('e_return', 'n_rightx', 'n_routex'),
        edge('e_backxx', 'n_routex', 'n_leftxx'),
      ],
    });
    const positions = new Map(result.nodes.map((candidate) => [candidate.id, candidate.position]));
    expect(positions.get('n_start')!.x).toBeLessThan(positions.get('n_leftxx')!.x);
    expect(positions.get('n_leftxx')!.x).toBeLessThan(positions.get('n_rightx')!.x);
    const regularBottom = Math.max(
      ...result.nodes
        .filter((candidate) => candidate.type !== StoryNodeType.Reroute)
        .map((candidate) => candidate.position.y + (candidate.measured?.height ?? 130)),
    );
    expect(positions.get('n_routex')!.y).toBeGreaterThan(regularBottom);
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
