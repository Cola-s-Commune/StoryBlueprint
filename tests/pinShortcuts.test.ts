import { beforeAll, describe, expect, it } from 'vitest';
import { StoryNodeType, nodeRegistry } from '@story-blueprint/common';
import {
  disconnectGraphPinConnections,
  moveGraphPinConnections,
  type EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';

beforeAll(() => nodeRegistry.registerBuiltins());

function graph(): EditorGraphState {
  return {
    nodes: [
      {
        id: 'n_start',
        type: StoryNodeType.Start,
        definitionVersion: 1,
        position: { x: 0, y: 0 },
        data: { title: 'Start' },
      },
      {
        id: 'n_first',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 300, y: 0 },
        data: { text: { source: 'First' } },
      },
      {
        id: 'n_second',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 300, y: 200 },
        data: { text: { source: 'Second' } },
      },
    ],
    edges: [
      {
        id: 'e_flow',
        source: 'n_start',
        sourceHandle: 'out',
        target: 'n_first',
        targetHandle: 'in',
      },
    ],
  };
}

describe('pin shortcuts', () => {
  it('disconnects every wire attached to a pin', () => {
    const result = disconnectGraphPinConnections(graph(), {
      nodeId: 'n_first',
      handleId: 'in',
      direction: 'target',
    });

    expect(result.removedEdgeIds).toEqual(['e_flow']);
    expect(result.graph.edges).toEqual([]);
  });

  it('moves every connection from one compatible input pin to another', () => {
    const result = moveGraphPinConnections(
      graph(),
      { nodeId: 'n_first', handleId: 'in', direction: 'target' },
      { nodeId: 'n_second', handleId: 'in', direction: 'target' },
    );

    expect(result.ok, result.ok ? undefined : result.message).toBe(true);
    if (result.ok) {
      expect(result.graph.edges).toEqual([
        expect.objectContaining({ id: 'e_flow', target: 'n_second', targetHandle: 'in' }),
      ]);
    }
  });

  it('rejects moving connections to a pin in the opposite direction', () => {
    expect(
      moveGraphPinConnections(
        graph(),
        { nodeId: 'n_first', handleId: 'in', direction: 'target' },
        { nodeId: 'n_start', handleId: 'out', direction: 'source' },
      ),
    ).toMatchObject({ ok: false });
  });
});
