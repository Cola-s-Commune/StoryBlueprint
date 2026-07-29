import { describe, expect, it } from 'vitest';
import { StoryNodeType, type DialogueLine } from '@story-blueprint/common';
import {
  mergeDialogueNodes,
  splitDialogueLines,
  type EditorGraphNode,
  type EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';

function line(id: string, text: string): DialogueLine {
  return { id: `ln_${id}`, textId: `t_${id}`, text: { source: text } } as DialogueLine;
}

function dialogue(id: `n_${string}`, x: number, lines: DialogueLine[]): EditorGraphNode {
  return {
    id,
    type: StoryNodeType.Dialogue,
    definitionVersion: 1,
    position: { x, y: 0 },
    data: { lines },
    selected: true,
  };
}

function end(id: `n_${string}`, x: number): EditorGraphNode {
  return {
    id,
    type: StoryNodeType.End,
    definitionVersion: 1,
    position: { x, y: 0 },
    data: { title: 'End' },
    selected: false,
  };
}

function edge(id: `e_${string}`, source: `n_${string}`, target: `n_${string}`) {
  return { id, source, sourceHandle: 'out', target, targetHandle: 'in' };
}

describe('Dialogue graph editing', () => {
  it('merges a connected Dialogue chain while preserving Line IDs and the outgoing edge', () => {
    const graph: EditorGraphState = {
      nodes: [
        dialogue('n_first', 0, [line('one', 'One')]),
        dialogue('n_second', 300, [line('two', 'Two')]),
        end('n_endxx', 600),
      ],
      edges: [edge('e_chain', 'n_first', 'n_second'), edge('e_exitxx', 'n_second', 'n_endxx')],
    };
    const result = mergeDialogueNodes(graph, ['n_second', 'n_first']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const merged = result.graph.nodes.find((node) => node.id === 'n_first')!;
    expect(merged.data.lines).toMatchObject([
      { id: 'ln_one', text: { source: 'One' } },
      { id: 'ln_two', text: { source: 'Two' } },
    ]);
    expect(result.graph.nodes.some((node) => node.id === 'n_second')).toBe(false);
    expect(result.graph.edges).toEqual([edge('e_exitxx', 'n_first', 'n_endxx')]);
  });

  it('rejects disconnected Dialogue nodes', () => {
    const graph: EditorGraphState = {
      nodes: [
        dialogue('n_first', 0, [line('one', 'One')]),
        dialogue('n_second', 300, [line('two', 'Two')]),
      ],
      edges: [],
    };
    expect(mergeDialogueNodes(graph, ['n_first', 'n_second'])).toMatchObject({ ok: false });
  });

  it('splits selected middle Lines into an ordered three-node chain', () => {
    const source = dialogue('n_source', 100, [
      line('one', 'One'),
      line('two', 'Two'),
      line('three', 'Three'),
      line('four', 'Four'),
    ]);
    const graph: EditorGraphState = {
      nodes: [source, end('n_endxx', 1000)],
      edges: [edge('e_exitxx', 'n_source', 'n_endxx')],
    };
    const nodeIds = ['n_split1', 'n_split2'] as const;
    const edgeIds = ['e_split1', 'e_split2'] as const;
    let nodeIndex = 0;
    let edgeIndex = 0;
    const result = splitDialogueLines(
      graph,
      'n_source',
      ['ln_two', 'ln_three'],
      () => nodeIds[nodeIndex++],
      () => edgeIds[edgeIndex++],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dialogues = result.graph.nodes.filter((node) => node.type === StoryNodeType.Dialogue);
    expect(dialogues.map((node) => node.data.lines.map((item: DialogueLine) => item.id))).toEqual([
      ['ln_one'],
      ['ln_two', 'ln_three'],
      ['ln_four'],
    ]);
    expect(result.affectedNodeIds).toEqual(['n_split1']);
    expect(result.graph.edges).toEqual([
      edge('e_exitxx', 'n_split2', 'n_endxx'),
      edge('e_split1', 'n_source', 'n_split1'),
      edge('e_split2', 'n_split1', 'n_split2'),
    ]);
  });
});
