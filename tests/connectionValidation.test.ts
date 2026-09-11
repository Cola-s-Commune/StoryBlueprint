import { beforeAll, describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  createGraphConnectionValidator,
  nodeRegistry,
  resolveNodePorts,
  validateGraphConnection,
  valueTypesCompatible,
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

  it('records accepted connections in a reusable validator', () => {
    const validator = createGraphConnectionValidator(nodes);
    expect(
      validator.validate({
        source: 'start',
        sourcePortId: 'out',
        target: 'dialogue',
        targetPortId: 'in',
      }),
    ).toEqual({ valid: true });
    expect(
      validator.validate({
        source: 'start',
        sourcePortId: 'out',
        target: 'end',
        targetPortId: 'in',
      }),
    ).toMatchObject({
      valid: false,
      diagnostic: { code: 'OUTPUT_ALREADY_CONNECTED' },
    });
  });

  it('rejects a typed container value connected to an incompatible Key Pin', () => {
    const typedNodes: GraphNodeLike[] = [
      {
        id: 'read-number',
        type: StoryNodeType.GetVariable,
        data: {
          variableId: 'v_numbers',
          accessor: {
            kind: 'index',
            index: { source: '0', bindings: {} },
            valueType: { kind: 'number' },
          },
          outputValueType: { kind: 'number' },
        },
      },
      {
        id: 'set-map',
        type: StoryNodeType.SetVariable,
        data: {
          variableId: 'v_map',
          value: { source: 'true', bindings: {} },
          containerOperation: 'set-entry',
          key: { source: '"door"', bindings: {} },
          valueInputType: { kind: 'boolean' },
          keyInputType: { kind: 'string' },
        },
      },
    ];
    expect(
      validateGraphConnection(
        {
          source: 'read-number',
          sourcePortId: 'value',
          target: 'set-map',
          targetPortId: 'key',
        },
        typedNodes,
        [],
      ),
    ).toMatchObject({ valid: false, diagnostic: { code: 'INCOMPATIBLE_DATA_TYPE' } });
  });

  it('reports an occupied data input so callers can replace its source', () => {
    const typedNodes: GraphNodeLike[] = [
      {
        id: 'first-read',
        type: StoryNodeType.GetVariable,
        data: { variableId: 'v_first', outputValueType: { kind: 'number' } },
      },
      {
        id: 'second-read',
        type: StoryNodeType.GetVariable,
        data: { variableId: 'v_second', outputValueType: { kind: 'number' } },
      },
      {
        id: 'set-value',
        type: StoryNodeType.SetVariable,
        data: { variableId: 'v_target', value: { source: '0', bindings: {} } },
      },
    ];
    expect(
      validateGraphConnection(
        {
          source: 'second-read',
          sourcePortId: 'value',
          target: 'set-value',
          targetPortId: 'value',
        },
        typedNodes,
        [
          {
            id: 'e_first',
            source: 'first-read',
            sourcePortId: 'value',
            target: 'set-value',
            targetPortId: 'value',
          },
        ],
      ),
    ).toMatchObject({ valid: false, diagnostic: { code: 'INPUT_ALREADY_CONNECTED' } });
  });

  it('accepts typed External Function Out data pins', () => {
    const typedNodes: GraphNodeLike[] = [
      {
        id: 'event-node',
        type: StoryNodeType.CallEvent,
        data: {
          eventId: 'ev_test',
          arguments: {},
          outputPorts: [{ id: 'evo_score', label: 'Score', valueType: { kind: 'number' } }],
          resultVariableIds: {},
        },
      },
      {
        id: 'set-node',
        type: StoryNodeType.SetVariable,
        data: { variableId: 'v_score', value: { source: '0', bindings: {} } },
      },
    ];
    expect(
      validateGraphConnection(
        {
          source: 'event-node',
          sourcePortId: 'output:evo_score',
          target: 'set-node',
          targetPortId: 'value',
        },
        typedNodes,
        [],
      ),
    ).toEqual({ valid: true });
  });

  it('resolves typed External Function argument pins for immediate validation', () => {
    const call: GraphNodeLike = {
      id: 'event-node',
      type: StoryNodeType.CallEvent,
      data: {
        eventId: 'ev_test',
        arguments: { animation: { source: '"idle"', bindings: {} } },
        argumentInputTypes: { animation: { kind: 'string' } },
        resultVariableIds: {},
      },
    };
    const getNumber: GraphNodeLike = {
      id: 'get-number',
      type: StoryNodeType.GetVariable,
      data: { variableId: 'v_number', outputValueType: { kind: 'number' } },
    };
    const ports = resolveNodePorts(call).ports;
    expect(ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'argument:animation',
          kind: 'data',
          valueType: { kind: 'string' },
        }),
      ]),
    );
    expect(
      validateGraphConnection(
        {
          source: 'get-number',
          sourcePortId: 'value',
          target: 'event-node',
          targetPortId: 'argument:animation',
        },
        [getNumber, call],
        [],
      ),
    ).toMatchObject({ valid: false, diagnostic: { code: 'INCOMPATIBLE_DATA_TYPE' } });
  });

  it('resolves typed Substory input, return, and Out pins from interface snapshots', () => {
    const call: GraphNodeLike = {
      id: 'substory-call',
      type: StoryNodeType.CallSubstory,
      data: {
        chapterId: 'ch_test',
        arguments: {},
        argumentInputTypes: { v_parameter: { kind: 'number' } },
        outputPorts: [{ id: 'v_output', label: 'Output', valueType: { kind: 'number' } }],
        resultVariableIds: {},
      },
    };
    const returned: GraphNodeLike = {
      id: 'substory-return',
      type: StoryNodeType.Return,
      data: { values: {}, valueInputTypes: { v_output: { kind: 'number' } } },
    };
    const getString: GraphNodeLike = {
      id: 'get-string',
      type: StoryNodeType.GetVariable,
      data: { variableId: 'v_string', outputValueType: { kind: 'string' } },
    };
    const setNumber: GraphNodeLike = {
      id: 'set-number',
      type: StoryNodeType.SetVariable,
      data: { variableId: 'v_number', value: { source: '0', bindings: {} } },
    };

    expect(resolveNodePorts(call).ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'argument:v_parameter', valueType: { kind: 'number' } }),
        expect.objectContaining({ id: 'output:v_output', valueType: { kind: 'number' } }),
      ]),
    );
    expect(resolveNodePorts(returned).ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'value:v_output', valueType: { kind: 'number' } }),
      ]),
    );
    expect(
      validateGraphConnection(
        {
          source: 'get-string',
          sourcePortId: 'value',
          target: 'substory-call',
          targetPortId: 'argument:v_parameter',
        },
        [getString, call],
        [],
      ),
    ).toMatchObject({ valid: false, diagnostic: { code: 'INCOMPATIBLE_DATA_TYPE' } });
    expect(
      validateGraphConnection(
        {
          source: 'substory-call',
          sourcePortId: 'output:v_output',
          target: 'set-number',
          targetPortId: 'value',
        },
        [call, setNumber],
        [],
      ),
    ).toEqual({ valid: true });
  });

  it('uses one directional type relation for pin and compiler contracts', () => {
    expect(valueTypesCompatible({ kind: 'number' }, { kind: 'number' })).toBe(true);
    expect(valueTypesCompatible({ kind: 'number', nullable: true }, { kind: 'number' })).toBe(
      false,
    );
    expect(
      valueTypesCompatible(
        { kind: 'array', elementType: { kind: 'string' } },
        { kind: 'array', elementType: { kind: 'number' } },
      ),
    ).toBe(false);
    expect(
      valueTypesCompatible(
        { kind: 'map', keyType: 'character-ref', valueType: { kind: 'boolean' } },
        { kind: 'map', keyType: 'character-ref', valueType: { kind: 'boolean' } },
      ),
    ).toBe(true);
    expect(valueTypesCompatible({ kind: 'any' }, { kind: 'boolean' })).toBe(true);
  });

  it('keeps data reroute pins typed like the routed value', () => {
    const typedNodes: GraphNodeLike[] = [
      {
        id: 'get-node',
        type: StoryNodeType.GetVariable,
        data: { variableId: 'v_score', outputValueType: { kind: 'number' } },
      },
      {
        id: 'reroute-node',
        type: StoryNodeType.Reroute,
        data: { kind: 'data', valueType: { kind: 'number' } },
      },
      {
        id: 'set-node',
        type: StoryNodeType.SetVariable,
        data: { variableId: 'v_target', value: { source: '0', bindings: {} } },
      },
    ];
    const reroutePorts = resolveNodePorts(typedNodes[1]).ports;
    expect(reroutePorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'in', kind: 'data', valueType: { kind: 'number' } }),
        expect.objectContaining({ id: 'out', kind: 'data', valueType: { kind: 'number' } }),
      ]),
    );
    expect(
      validateGraphConnection(
        { source: 'get-node', sourcePortId: 'value', target: 'reroute-node', targetPortId: 'in' },
        typedNodes,
        [],
      ),
    ).toEqual({ valid: true });
    expect(
      validateGraphConnection(
        { source: 'reroute-node', sourcePortId: 'out', target: 'set-node', targetPortId: 'value' },
        typedNodes,
        [],
      ),
    ).toEqual({ valid: true });
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
