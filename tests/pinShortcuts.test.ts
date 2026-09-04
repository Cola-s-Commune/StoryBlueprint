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
        data: {
          lines: [{ id: 'ln_first', textId: 't_first', text: { source: 'First' } }],
        },
      },
      {
        id: 'n_second',
        type: StoryNodeType.Dialogue,
        definitionVersion: 1,
        position: { x: 300, y: 200 },
        data: {
          lines: [{ id: 'ln_second', textId: 't_second', text: { source: 'Second' } }],
        },
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

  it('replaces a data source when moving a connection onto an occupied input pin', () => {
    const dataGraph: EditorGraphState = {
      nodes: [
        {
          id: 'n_first',
          type: StoryNodeType.GetVariable,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: { variableId: 'v_first', outputValueType: { kind: 'number' } },
        },
        {
          id: 'n_second',
          type: StoryNodeType.GetVariable,
          definitionVersion: 1,
          position: { x: 0, y: 180 },
          data: { variableId: 'v_second', outputValueType: { kind: 'number' } },
        },
        {
          id: 'n_first_target',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 360, y: 0 },
          data: { variableId: 'v_first_target', value: { source: '0', bindings: {} } },
        },
        {
          id: 'n_second_target',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 360, y: 180 },
          data: { variableId: 'v_second_target', value: { source: '0', bindings: {} } },
        },
      ],
      edges: [
        {
          id: 'e_moving',
          source: 'n_first',
          sourceHandle: 'value',
          target: 'n_first_target',
          targetHandle: 'value',
        },
        {
          id: 'e_existing',
          source: 'n_second',
          sourceHandle: 'value',
          target: 'n_second_target',
          targetHandle: 'value',
        },
      ],
    };
    const result = moveGraphPinConnections(
      dataGraph,
      { nodeId: 'n_first_target', handleId: 'value', direction: 'target' },
      { nodeId: 'n_second_target', handleId: 'value', direction: 'target' },
    );

    expect(result.ok, result.ok ? undefined : result.message).toBe(true);
    if (result.ok) {
      expect(result.graph.edges).toEqual([
        expect.objectContaining({
          id: 'e_moving',
          source: 'n_first',
          target: 'n_second_target',
          targetHandle: 'value',
        }),
      ]);
    }
  });
});
