import type { Edge, Node } from '@xyflow/react';
import {
  createStableId,
  nodeRegistry,
  StoryNodeType,
  validateGraphConnection,
  type ChoiceNodeData,
  type ChapterId,
  type EdgeId,
  type FlowJumpNodeData,
  type NodeId,
  type NodeInstance,
  type OptionId,
  type SourceGraph,
  type StoryNodeDataMap,
} from '@story-blueprint/common';

export type EditorNodeData = StoryNodeDataMap[StoryNodeType] & Record<string, unknown>;

export type EditorGraphNode = Node<EditorNodeData, StoryNodeType> & {
  id: NodeId;
  name?: string;
  definitionVersion: number;
};

export type EditorGraphEdge = Edge & {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  sourceHandle: string;
  targetHandle: string;
};

export interface EditorGraphState {
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
}

export interface GraphClipboard {
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
}

export interface GraphPinReference {
  nodeId: string;
  handleId: string;
  direction: 'source' | 'target';
}

export type MoveGraphPinConnectionsResult =
  | { ok: true; graph: EditorGraphState; movedEdgeIds: readonly EdgeId[] }
  | { ok: false; message: string };

export function disconnectGraphPinConnections(
  graph: EditorGraphState,
  pin: GraphPinReference,
): { graph: EditorGraphState; removedEdgeIds: readonly EdgeId[] } {
  const removedEdges = graph.edges.filter((edge) =>
    pin.direction === 'source'
      ? edge.source === pin.nodeId && edge.sourceHandle === pin.handleId
      : edge.target === pin.nodeId && edge.targetHandle === pin.handleId,
  );
  if (removedEdges.length === 0) return { graph, removedEdgeIds: [] };
  const removedIds = new Set(removedEdges.map((edge) => edge.id));
  return {
    graph: { nodes: graph.nodes, edges: graph.edges.filter((edge) => !removedIds.has(edge.id)) },
    removedEdgeIds: [...removedIds],
  };
}

function graphNodeLikes(nodes: readonly EditorGraphNode[]) {
  return nodes.map((node) => ({ id: node.id, type: node.type, data: node.data }));
}

function graphEdgeLikes(edges: readonly EditorGraphEdge[]) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourcePortId: edge.sourceHandle,
    target: edge.target,
    targetPortId: edge.targetHandle,
  }));
}

/** Moves every wire attached to one pin onto another same-direction pin. */
export function moveGraphPinConnections(
  graph: EditorGraphState,
  origin: GraphPinReference,
  destination: GraphPinReference,
): MoveGraphPinConnectionsResult {
  if (origin.direction !== destination.direction) {
    return { ok: false, message: 'Connections can only move between pins in the same direction' };
  }
  if (origin.nodeId === destination.nodeId && origin.handleId === destination.handleId) {
    return { ok: false, message: 'Choose a different pin' };
  }

  const movingEdges = graph.edges.filter((edge) =>
    origin.direction === 'source'
      ? edge.source === origin.nodeId && edge.sourceHandle === origin.handleId
      : edge.target === origin.nodeId && edge.targetHandle === origin.handleId,
  );
  if (movingEdges.length === 0) return { ok: false, message: 'This pin has no connections' };

  let nextEdges = graph.edges.filter((edge) => !movingEdges.includes(edge));
  const movedEdges: EditorGraphEdge[] = [];
  for (const edge of movingEdges) {
    const moved = {
      ...edge,
      ...(origin.direction === 'source'
        ? { source: destination.nodeId as NodeId, sourceHandle: destination.handleId }
        : { target: destination.nodeId as NodeId, targetHandle: destination.handleId }),
    };
    let result = validateGraphConnection(
      {
        source: moved.source,
        sourcePortId: moved.sourceHandle,
        target: moved.target,
        targetPortId: moved.targetHandle,
      },
      graphNodeLikes(graph.nodes),
      graphEdgeLikes([...nextEdges, ...movedEdges]),
    );
    if (!result.valid && result.diagnostic.code === 'OUTPUT_ALREADY_CONNECTED') {
      nextEdges = nextEdges.filter(
        (candidate) =>
          candidate.source !== moved.source || candidate.sourceHandle !== moved.sourceHandle,
      );
      result = validateGraphConnection(
        {
          source: moved.source,
          sourcePortId: moved.sourceHandle,
          target: moved.target,
          targetPortId: moved.targetHandle,
        },
        graphNodeLikes(graph.nodes),
        graphEdgeLikes([...nextEdges, ...movedEdges]),
      );
    }
    if (!result.valid) return { ok: false, message: result.diagnostic.message };
    movedEdges.push(moved);
  }

  return {
    ok: true,
    graph: { nodes: graph.nodes, edges: [...nextEdges, ...movedEdges] },
    movedEdgeIds: movedEdges.map((edge) => edge.id),
  };
}

export type ExtractSelectionResult =
  | {
      ok: true;
      chapterGraph: EditorGraphState;
      remainingGraph: EditorGraphState;
      callNodeId: NodeId;
    }
  | { ok: false; message: string };

/** Extracts a single-entry/single-exit selection into a callable substory graph. */
export function extractSelectionToSubstory(
  graph: EditorGraphState,
  chapterId: ChapterId,
): ExtractSelectionResult {
  const selected = graph.nodes.filter((node) => node.selected);
  if (selected.length === 0) return { ok: false, message: 'Select one or more nodes first.' };
  if (
    selected.some(
      (node) =>
        node.type === StoryNodeType.Start ||
        node.type === StoryNodeType.End ||
        node.type === StoryNodeType.Return ||
        node.type === StoryNodeType.FlowAnchor ||
        node.type === StoryNodeType.FlowJump,
    )
  ) {
    return {
      ok: false,
      message: 'Entry, End Story, Return, and Flow Portal nodes cannot be extracted.',
    };
  }

  const selectedIds = new Set(selected.map((node) => node.id));
  const incoming = graph.edges.filter(
    (edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const outgoing = graph.edges.filter(
    (edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target),
  );
  if (incoming.length !== 1 || outgoing.length !== 1) {
    return {
      ok: false,
      message: `Selection needs exactly one incoming and one outgoing connection (found ${incoming.length} in, ${outgoing.length} out).`,
    };
  }
  if (incoming[0].targetHandle !== 'in' || outgoing[0].targetHandle !== 'in') {
    return { ok: false, message: 'Data-pin boundaries cannot be extracted yet.' };
  }

  const minX = Math.min(...selected.map((node) => node.position.x));
  const maxX = Math.max(...selected.map((node) => node.position.x));
  const centerX = Math.round(
    selected.reduce((sum, node) => sum + node.position.x, 0) / selected.length,
  );
  const centerY = Math.round(
    selected.reduce((sum, node) => sum + node.position.y, 0) / selected.length,
  );
  const incomingTarget = selected.find((node) => node.id === incoming[0].target)!;
  const outgoingSource = selected.find((node) => node.id === outgoing[0].source)!;
  const entry: EditorGraphNode = {
    id: createStableId('node'),
    type: StoryNodeType.Start,
    definitionVersion: 1,
    position: { x: Math.round(minX - 280), y: Math.round(incomingTarget.position.y) },
    data: { title: 'Substory Entry' } as EditorNodeData,
    selected: false,
  };
  const returnNode: EditorGraphNode = {
    id: createStableId('node'),
    type: StoryNodeType.Return,
    definitionVersion: 1,
    position: { x: Math.round(maxX + 280), y: Math.round(outgoingSource.position.y) },
    data: {} as EditorNodeData,
    selected: false,
  };
  const call: EditorGraphNode = {
    id: createStableId('node'),
    type: StoryNodeType.CallSubstory,
    definitionVersion: 1,
    position: { x: centerX, y: centerY },
    data: { chapterId } as EditorNodeData,
    selected: true,
  };

  const internalEdges = graph.edges.filter(
    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const chapterGraph: EditorGraphState = {
    nodes: [
      entry,
      ...selected.map((node) => ({ ...structuredClone(node), selected: false })),
      returnNode,
    ],
    edges: [
      ...internalEdges.map((edge) => ({ ...structuredClone(edge), selected: false })),
      {
        id: createStableId('edge'),
        source: entry.id,
        sourceHandle: 'out',
        target: incoming[0].target,
        targetHandle: incoming[0].targetHandle,
      },
      {
        id: createStableId('edge'),
        source: outgoing[0].source,
        sourceHandle: outgoing[0].sourceHandle,
        target: returnNode.id,
        targetHandle: 'in',
      },
    ],
  };

  const remainingGraph: EditorGraphState = {
    nodes: [
      ...graph.nodes
        .filter((node) => !selectedIds.has(node.id))
        .map((node) => ({ ...node, selected: false })),
      call,
    ],
    edges: [
      ...graph.edges
        .filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target))
        .map((edge) => ({ ...edge, selected: false })),
      {
        id: createStableId('edge'),
        source: incoming[0].source,
        sourceHandle: incoming[0].sourceHandle,
        target: call.id,
        targetHandle: 'in',
      },
      {
        id: createStableId('edge'),
        source: call.id,
        sourceHandle: 'out',
        target: outgoing[0].target,
        targetHandle: outgoing[0].targetHandle,
      },
    ],
  };
  return { ok: true, chapterGraph, remainingGraph, callNodeId: call.id };
}

export function toEditorGraphNode(instance: NodeInstance): EditorGraphNode {
  return {
    ...instance,
    data: instance.data as EditorNodeData,
  };
}

export function toSourceGraph(graph: EditorGraphState): SourceGraph {
  return {
    nodes: graph.nodes.map((node) => {
      const dynamicPorts =
        node.type === StoryNodeType.Choice
          ? (node.data as ChoiceNodeData).options.map((option) => ({
              id: option.id,
              name: option.id,
              displayName: option.text.source,
            }))
          : undefined;

      return {
        id: node.id,
        name: node.name,
        type: node.type,
        definitionVersion: node.definitionVersion,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        data: node.data,
        dynamicPorts,
      };
    }),
    edges: graph.edges.map((edge) => ({
      from: { nodeId: edge.source, portId: edge.sourceHandle },
      to: { nodeId: edge.target, portId: edge.targetHandle },
    })),
  };
}

export function fromSourceGraph(source: SourceGraph): EditorGraphState {
  const nodes: EditorGraphNode[] = source.nodes.map((node) => {
    if (!nodeRegistry.has(node.type as StoryNodeType)) {
      throw new Error(`Unsupported node type: ${node.type}`);
    }
    return {
      id: node.id,
      name: node.name,
      type: node.type as StoryNodeType,
      definitionVersion: node.definitionVersion,
      position: { ...node.position },
      data: structuredClone(node.data) as EditorNodeData,
      selected: false,
    };
  });

  const edges: EditorGraphEdge[] = [];
  for (const edge of source.edges) {
    const candidate = {
      source: edge.from.nodeId,
      sourcePortId: edge.from.portId,
      target: edge.to.nodeId,
      targetPortId: edge.to.portId,
    };
    const result = validateGraphConnection(
      candidate,
      nodes.map((node) => ({ id: node.id, type: node.type, data: node.data })),
      edges.map((existing) => ({
        id: existing.id,
        source: existing.source,
        sourcePortId: existing.sourceHandle,
        target: existing.target,
        targetPortId: existing.targetHandle,
      })),
    );
    if (!result.valid) throw new Error(`Invalid link: ${result.diagnostic.message}`);
    edges.push({
      id: createStableId('edge'),
      source: edge.from.nodeId,
      sourceHandle: edge.from.portId,
      target: edge.to.nodeId,
      targetHandle: edge.to.portId,
      selected: false,
    });
  }
  return { nodes, edges };
}

export function createGraphClipboard(graph: EditorGraphState): GraphClipboard | null {
  const selectedIds = new Set(graph.nodes.filter((node) => node.selected).map((node) => node.id));
  if (selectedIds.size === 0) return null;

  return structuredClone({
    nodes: graph.nodes.filter((node) => selectedIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
    ),
  });
}

function uniqueCopyName(name: string | undefined, usedNames: Set<string>): string | undefined {
  if (!name) return undefined;
  const base = `${name}_copy`;
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) candidate = `${base}_${suffix++}`;
  usedNames.add(candidate);
  return candidate;
}

function cloneNodeData(node: EditorGraphNode): {
  data: EditorNodeData;
  portIds: ReadonlyMap<string, string>;
} {
  const data = structuredClone(node.data);
  const portIds = new Map<string, string>();
  const dynamic = nodeRegistry.get(node.type)?.dynamicOutputs;
  if (!dynamic) return { data, portIds };

  const items = data[dynamic.sourceProperty];
  if (!Array.isArray(items)) return { data, portIds };

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const oldId = record[dynamic.idProperty];
    if (typeof oldId !== 'string') continue;
    const newId: OptionId = createStableId('option');
    record[dynamic.idProperty] = newId;
    portIds.set(oldId, newId);
  }

  return { data, portIds };
}

export function pasteGraphClipboard(
  graph: EditorGraphState,
  clipboard: GraphClipboard,
  offset = { x: 32, y: 32 },
): EditorGraphState {
  const nodeIds = new Map<string, NodeId>();
  const portIds = new Map<string, ReadonlyMap<string, string>>();
  const usedNames = new Set(graph.nodes.flatMap((node) => (node.name ? [node.name] : [])));

  const pastedNodes = clipboard.nodes.map((node) => {
    const id = createStableId('node');
    const cloned = cloneNodeData(node);
    nodeIds.set(node.id, id);
    portIds.set(node.id, cloned.portIds);
    return {
      ...structuredClone(node),
      id,
      name: uniqueCopyName(node.name, usedNames),
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: cloned.data,
      selected: true,
    };
  });

  for (const node of pastedNodes) {
    if (node.type !== StoryNodeType.FlowJump) continue;
    const data = node.data as FlowJumpNodeData;
    const remappedTarget = data.targetNodeId ? nodeIds.get(data.targetNodeId) : undefined;
    if (remappedTarget) node.data = { ...node.data, targetNodeId: remappedTarget };
  }

  const pastedEdges = clipboard.edges.flatMap((edge): EditorGraphEdge[] => {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        ...structuredClone(edge),
        id: createStableId('edge'),
        source,
        target,
        sourceHandle: portIds.get(edge.source)?.get(edge.sourceHandle) ?? edge.sourceHandle,
        targetHandle: portIds.get(edge.target)?.get(edge.targetHandle) ?? edge.targetHandle,
        selected: false,
      },
    ];
  });

  return {
    nodes: [...graph.nodes.map((node) => ({ ...node, selected: false })), ...pastedNodes],
    edges: [...graph.edges.map((edge) => ({ ...edge, selected: false })), ...pastedEdges],
  };
}
