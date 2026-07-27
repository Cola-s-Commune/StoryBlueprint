import { beforeAll, describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  nodeRegistry,
  validateGraphConnection,
  type GraphNodeLike,
} from '../packages/common/src';

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
});
