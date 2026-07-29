import type { Edge, Node } from '@xyflow/react';
import {
  createStableId,
  nodeRegistry,
  resolveNodePorts,
  StoryNodeType,
  validateGraphConnection,
  type ChoiceNodeData,
  type ChapterId,
  type DialogueNodeData,
  type DialogueLineId,
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

export interface AIGraphChangeSet {
  graph: EditorGraphState;
  addedNodeIds: NodeId[];
  changedNodeIds: NodeId[];
  removedNodeIds: NodeId[];
}

export type DialogueGraphEditResult =
  { ok: true; graph: EditorGraphState; affectedNodeIds: NodeId[] } | { ok: false; message: string };

const autoLayoutColumnGap = 90;
const autoLayoutRowGap = 56;
const autoLayoutFallbackWidth = 220;
const autoLayoutFallbackHeight = 120;
const splitDialogueColumnOffset = 300;

function layoutNodeWidth(node: EditorGraphNode): number {
  return Math.ceil(node.measured?.width ?? node.width ?? autoLayoutFallbackWidth);
}

function layoutNodeHeight(node: EditorGraphNode): number {
  if (node.measured?.height !== undefined || node.height !== undefined) {
    return Math.ceil(node.measured?.height ?? node.height ?? autoLayoutFallbackHeight);
  }
  if (node.type === StoryNodeType.Dialogue) {
    const lineCount = (node.data as DialogueNodeData).lines.length;
    return 74 + Math.min(3, Math.max(1, lineCount)) * 54;
  }
  return autoLayoutFallbackHeight;
}

function isLayoutExecutionEdge(
  edge: EditorGraphEdge,
  nodesById: ReadonlyMap<NodeId, EditorGraphNode>,
): boolean {
  const source = nodesById.get(edge.source);
  if (!source) return false;
  return resolveNodePorts({ id: source.id, type: source.type, data: source.data }).ports.some(
    (port) =>
      port.id === edge.sourceHandle && port.direction === 'output' && port.kind === 'execution',
  );
}

/** Arranges all or a selected subset of nodes from left to right without moving nodes outside it. */
export function autoLayoutGraph(
  graph: EditorGraphState,
  nodeIds: readonly NodeId[] = graph.nodes.map((node) => node.id),
): EditorGraphState {
  const requested = new Set(nodeIds);
  const affected = graph.nodes.filter((node) => requested.has(node.id));
  if (affected.length < 2) return graph;

  const affectedIds = new Set(affected.map((node) => node.id));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const executionEdges = graph.edges.filter(
    (edge) =>
      affectedIds.has(edge.source) &&
      affectedIds.has(edge.target) &&
      isLayoutExecutionEdge(edge, nodesById),
  );
  const outgoing = new Map<NodeId, NodeId[]>();
  const indegree = new Map<NodeId, number>(affected.map((node) => [node.id, 0]));
  for (const edge of executionEdges) {
    const targets = outgoing.get(edge.source) ?? [];
    if (!targets.includes(edge.target)) targets.push(edge.target);
    outgoing.set(edge.source, targets);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const originalOrder = [...affected].sort(
    (left, right) =>
      left.position.x - right.position.x ||
      left.position.y - right.position.y ||
      left.id.localeCompare(right.id),
  );
  const orderIndex = new Map(originalOrder.map((node, index) => [node.id, index] as const));
  const sortIds = (ids: NodeId[]) =>
    ids.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
  for (const targets of outgoing.values()) sortIds(targets);

  const layers = new Map<NodeId, number>();
  const visited = new Set<NodeId>();
  const roots = sortIds(
    affected
      .filter((node) => node.type === StoryNodeType.Start || (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id),
  );
  const visitFrom = (rootId: NodeId) => {
    if (visited.has(rootId)) return;
    const queue: Array<{ id: NodeId; layer: number }> = [{ id: rootId, layer: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      layers.set(current.id, current.layer);
      for (const targetId of outgoing.get(current.id) ?? []) {
        if (!visited.has(targetId)) queue.push({ id: targetId, layer: current.layer + 1 });
      }
    }
  };
  for (const rootId of roots) visitFrom(rootId);
  for (const node of originalOrder) visitFrom(node.id);

  const byLayer = new Map<number, EditorGraphNode[]>();
  for (const node of affected) {
    const layer = layers.get(node.id) ?? 0;
    const column = byLayer.get(layer) ?? [];
    column.push(node);
    byLayer.set(layer, column);
  }
  for (const column of byLayer.values()) {
    column.sort(
      (left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id),
    );
  }

  const originX = Math.round(Math.min(...affected.map((node) => node.position.x)));
  const originY = Math.round(Math.min(...affected.map((node) => node.position.y)));
  const positions = new Map<NodeId, { x: number; y: number }>();
  let columnX = originX;
  for (const [, column] of [...byLayer.entries()].sort(([left], [right]) => left - right)) {
    let rowY = originY;
    column.forEach((node) => {
      positions.set(node.id, {
        x: columnX,
        y: rowY,
      });
      rowY += layoutNodeHeight(node) + autoLayoutRowGap;
    });
    const columnWidth = Math.max(...column.map(layoutNodeWidth));
    columnX += columnWidth + autoLayoutColumnGap;
  }

  return {
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
    edges: graph.edges,
  };
}

/** Merges a contiguous execution chain of Dialogue nodes into its first node. */
export function mergeDialogueNodes(
  graph: EditorGraphState,
  nodeIds: readonly NodeId[],
): DialogueGraphEditResult {
  const selectedIds = new Set(nodeIds);
  const selected = graph.nodes.filter((node) => selectedIds.has(node.id));
  if (selected.length < 2) return { ok: false, message: 'Select at least two Dialogue nodes.' };
  if (selected.some((node) => node.type !== StoryNodeType.Dialogue)) {
    return { ok: false, message: 'Only Dialogue nodes can be merged.' };
  }

  const internal = graph.edges.filter(
    (edge) =>
      selectedIds.has(edge.source) &&
      selectedIds.has(edge.target) &&
      edge.sourceHandle === 'out' &&
      edge.targetHandle === 'in',
  );
  const predecessorCount = new Map<NodeId, number>();
  const successor = new Map<NodeId, NodeId>();
  for (const edge of internal) {
    if (successor.has(edge.source)) {
      return { ok: false, message: 'Selected Dialogues must form one unbranched chain.' };
    }
    successor.set(edge.source, edge.target);
    predecessorCount.set(edge.target, (predecessorCount.get(edge.target) ?? 0) + 1);
  }
  const heads = selected.filter((node) => !predecessorCount.has(node.id));
  if (heads.length !== 1 || internal.length !== selected.length - 1) {
    return { ok: false, message: 'Selected Dialogues must form one continuous chain.' };
  }
  if ([...predecessorCount.values()].some((count) => count !== 1)) {
    return { ok: false, message: 'Selected Dialogues must not merge through multiple paths.' };
  }

  const ordered: EditorGraphNode[] = [];
  const selectedById = new Map(selected.map((node) => [node.id, node] as const));
  let current: EditorGraphNode | undefined = heads[0];
  while (current && !ordered.some((node) => node.id === current!.id)) {
    ordered.push(current);
    current = successor.get(current.id) ? selectedById.get(successor.get(current.id)!) : undefined;
  }
  if (ordered.length !== selected.length) {
    return { ok: false, message: 'Selected Dialogues contain a cycle or disconnected section.' };
  }

  const head = ordered[0];
  const tail = ordered.at(-1)!;
  const invalidBoundary = graph.edges.some(
    (edge) =>
      (!selectedIds.has(edge.source) && selectedIds.has(edge.target) && edge.target !== head.id) ||
      (selectedIds.has(edge.source) && !selectedIds.has(edge.target) && edge.source !== tail.id),
  );
  if (invalidBoundary) {
    return {
      ok: false,
      message: 'The selected chain has an external connection in its middle and cannot be merged.',
    };
  }

  const removedIds = new Set(ordered.slice(1).map((node) => node.id));
  const mergedLines = ordered.flatMap((node) =>
    structuredClone((node.data as DialogueNodeData).lines),
  );
  return {
    ok: true,
    affectedNodeIds: [head.id],
    graph: {
      nodes: graph.nodes
        .filter((node) => !removedIds.has(node.id))
        .map((node) =>
          node.id === head.id
            ? { ...node, data: { ...node.data, lines: mergedLines }, selected: true }
            : { ...node, selected: false },
        ),
      edges: graph.edges
        .filter((edge) => !(selectedIds.has(edge.source) && selectedIds.has(edge.target)))
        .map((edge) =>
          edge.source === tail.id && !selectedIds.has(edge.target)
            ? { ...edge, source: head.id }
            : edge,
        ),
    },
  };
}

/** Splits a Dialogue into ordered nodes at every selected/unselected line boundary. */
export function splitDialogueLines(
  graph: EditorGraphState,
  nodeId: NodeId,
  lineIds: readonly DialogueLineId[],
  createNodeId: () => NodeId = () => createStableId('node'),
  createEdgeId: () => EdgeId = () => createStableId('edge'),
): DialogueGraphEditResult {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== StoryNodeType.Dialogue) {
    return { ok: false, message: 'Select one Dialogue node to split.' };
  }
  const data = node.data as DialogueNodeData;
  const selectedIds = new Set(lineIds);
  const selectedCount = data.lines.filter((line) => selectedIds.has(line.id)).length;
  if (selectedCount === 0) return { ok: false, message: 'Select at least one Line to split.' };
  if (selectedCount === data.lines.length) {
    return { ok: false, message: 'Leave at least one Line outside the selection.' };
  }

  const segments: Array<{ selected: boolean; lines: DialogueNodeData['lines'] }> = [];
  for (const line of data.lines) {
    const isSelected = selectedIds.has(line.id);
    const previous = segments.at(-1);
    if (!previous || previous.selected !== isSelected) {
      segments.push({ selected: isSelected, lines: [structuredClone(line)] });
    } else {
      previous.lines.push(structuredClone(line));
    }
  }
  if (segments.length < 2) return { ok: false, message: 'The selected Lines cannot be split.' };

  const segmentNodes = segments.map((segment, index): EditorGraphNode => {
    if (index === 0) {
      return {
        ...node,
        data: { ...node.data, lines: segment.lines },
        selected: segment.selected,
      };
    }
    return {
      ...structuredClone(node),
      id: createNodeId(),
      name: undefined,
      position: {
        x: Math.round(node.position.x + index * splitDialogueColumnOffset),
        y: node.position.y,
      },
      data: { ...structuredClone(node.data), lines: segment.lines },
      selected: segment.selected,
    };
  });
  const lastNode = segmentNodes.at(-1)!;
  const outgoing = graph.edges.map((edge) =>
    edge.source === node.id ? { ...edge, source: lastNode.id } : edge,
  );
  const chainEdges: EditorGraphEdge[] = segmentNodes.slice(0, -1).map((segmentNode, index) => ({
    id: createEdgeId(),
    source: segmentNode.id,
    sourceHandle: 'out',
    target: segmentNodes[index + 1].id,
    targetHandle: 'in',
  }));
  return {
    ok: true,
    affectedNodeIds: segmentNodes
      .filter((_, index) => segments[index].selected)
      .map((segmentNode) => segmentNode.id),
    graph: {
      nodes: graph.nodes.flatMap((candidate) =>
        candidate.id === node.id ? segmentNodes : [{ ...candidate, selected: false }],
      ),
      edges: [...outgoing, ...chainEdges],
    },
  };
}

function semanticNodeValue(node: EditorGraphNode): string {
  return JSON.stringify({ type: node.type, name: node.name, data: node.data });
}

/** Keeps authored positions intact and places only AI-created nodes near their flow neighbors. */
export function prepareAIGraphChanges(
  before: EditorGraphState,
  after: EditorGraphState,
): AIGraphChangeSet {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  const addedNodeIds = after.nodes
    .filter((node) => !beforeById.has(node.id))
    .map((node) => node.id);
  const removedNodeIds = before.nodes
    .filter((node) => !afterById.has(node.id))
    .map((node) => node.id);
  const changedNodeIds = after.nodes
    .filter((node) => {
      const previous = beforeById.get(node.id);
      return previous !== undefined && semanticNodeValue(previous) !== semanticNodeValue(node);
    })
    .map((node) => node.id);
  const added = new Set(addedNodeIds);
  const positions = new Map(
    after.nodes
      .filter((node) => !added.has(node.id))
      .map((node) => [node.id, { ...node.position }] as const),
  );
  const occupied = [...positions.values()];
  const pending = new Set(addedNodeIds);
  const horizontalGap = 280;
  const verticalGap = 170;
  const existingRight = Math.max(0, ...occupied.map((position) => position.x));

  const place = (nodeId: NodeId, allowFallback: boolean): boolean => {
    const predecessorPositions = after.edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => positions.get(edge.source))
      .filter((position): position is { x: number; y: number } => position !== undefined);
    const successorPositions = after.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => positions.get(edge.target))
      .filter((position): position is { x: number; y: number } => position !== undefined);
    if (!allowFallback && predecessorPositions.length === 0 && successorPositions.length === 0) {
      return false;
    }
    const anchors = [...predecessorPositions, ...successorPositions];
    const predecessorX = Math.max(...predecessorPositions.map((position) => position.x));
    const successorX = Math.min(...successorPositions.map((position) => position.x));
    let x: number;
    if (predecessorPositions.length > 0 && successorPositions.length > 0) {
      x =
        successorX - predecessorX >= horizontalGap * 1.5
          ? (predecessorX + successorX) / 2
          : predecessorX + horizontalGap;
    } else if (predecessorPositions.length > 0) {
      x = predecessorX + horizontalGap;
    } else if (successorPositions.length > 0) {
      x = successorX - horizontalGap;
    } else {
      x = existingRight + horizontalGap;
    }
    let y =
      anchors.length > 0
        ? anchors.reduce((total, position) => total + position.y, 0) / anchors.length
        : occupied.length * verticalGap;
    x = Math.round(x);
    y = Math.round(y);
    while (
      occupied.some((position) => Math.abs(position.x - x) < 220 && Math.abs(position.y - y) < 120)
    ) {
      y += verticalGap;
    }
    const position = { x, y };
    positions.set(nodeId, position);
    occupied.push(position);
    pending.delete(nodeId);
    return true;
  };

  while (pending.size > 0) {
    let progressed = false;
    for (const nodeId of [...pending]) progressed = place(nodeId, false) || progressed;
    if (!progressed) {
      for (const nodeId of [...pending]) place(nodeId, true);
    }
  }

  const highlighted = new Set([...addedNodeIds, ...changedNodeIds]);
  return {
    graph: {
      nodes: after.nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
        selected: highlighted.has(node.id),
      })),
      edges: after.edges.map((edge) => ({ ...edge, selected: false })),
    },
    addedNodeIds,
    changedNodeIds,
    removedNodeIds,
  };
}

/** Applies user-arranged preview positions to the freshly validated AI result. */
export function applyAIProposalPositions(
  prepared: EditorGraphState,
  proposal: EditorGraphState,
): EditorGraphState {
  const positions = new Map(proposal.nodes.map((node) => [node.id, node.position] as const));
  return {
    nodes: prepared.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges: prepared.edges,
  };
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
  if (node.type === StoryNodeType.Dialogue) {
    const dialogue = data as DialogueNodeData;
    dialogue.lines = dialogue.lines.map((line) => ({
      ...line,
      id: createStableId('line'),
      textId: createStableId('text'),
    }));
  }
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
