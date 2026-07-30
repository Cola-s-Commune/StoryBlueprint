import { beforeAll, describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  nodeRegistry,
  validateGraphConnection,
  type GraphNodeLike,
  type SourceGraph,
} from '@story-blueprint/common';
import { fromSourceGraph } from '../packages/editor/src/renderer/graph/editorGraph';

beforeAll(() => nodeRegistry.registerBuiltins());

const nodes: GraphNodeLike[] = [
  { id: 'start', type: StoryNodeType.Start, data: { title: 'Start' } },
  {
    id: 'dialogue',
    type: StoryNodeType.Dialogue,
    data: {
      lines: [{ id: 'ln_hello', textId: 't_hello', text: { source: 'Hello' } }],
    },
  },
  { id: 'end', type: StoryNodeType.End, data: { title: 'End' } },
];

describe('connection validation', () => {
  it('accepts a typed execution connection', () => {
    expect(
      validateGraphConnection(
        { source: 'start', sourcePortId: 'out', target: 'dialogue', targetPortId: 'in' },
        nodes,
        [],
      ),
    ).toEqual({ valid: true });
  });

  it('rejects a second successor on the same execution output', () => {
    const result = validateGraphConnection(
      { source: 'start', sourcePortId: 'out', target: 'end', targetPortId: 'in' },
      nodes,
      [
        {
          id: 'edge_existing',
          source: 'start',
          sourcePortId: 'out',
          target: 'dialogue',
          targetPortId: 'in',
        },
      ],
    );
    expect(result).toMatchObject({
      valid: false,
      diagnostic: { code: 'OUTPUT_ALREADY_CONNECTED' },
    });
  });

  it('preserves conflicting successors when loading a Git merge stage', () => {
    const source: SourceGraph = {
      nodes: nodes.map((node, index) => ({
        ...node,
        id: node.id as never,
        definitionVersion: 1,
        position: { x: index * 200, y: 0 },
      })),
      edges: [
        {
          from: { nodeId: 'start' as never, portId: 'out' },
          to: { nodeId: 'dialogue' as never, portId: 'in' },
        },
        {
          from: { nodeId: 'start' as never, portId: 'out' },
          to: { nodeId: 'end' as never, portId: 'in' },
        },
      ],
    };

    expect(() => fromSourceGraph(source)).toThrow(
      'Invalid link: An execution output can only connect to one successor',
    );
    expect(fromSourceGraph(source, { allowInvalidConnections: true }).edges).toHaveLength(2);
  });
});
