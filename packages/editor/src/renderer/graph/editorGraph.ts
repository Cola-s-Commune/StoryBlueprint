import type { Edge, Node } from '@xyflow/react';
import {
  createGraphConnectionValidator,
  createStableId,
  defaultForValueType,
  nodeRegistry,
  resolveNodePorts,
  StoryNodeType,
  validateGraphConnection,
  type BlueprintLayoutRequest,
  type ChapterId,
  type ChapterOutput,
  type ChapterParameter,
  type CharacterId,
  type DialogueNodeData,
  type DialogueLineId,
  type EdgeId,
  type ExpressionSource,
  type FlowJumpNodeData,
  type NodeId,
  type NodeInstance,
  type OptionId,
  type SourceGraph,
  type StoryNodeDataMap,
  type ValueType,
  type VariableDefinition,
  type VariableId,
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
  return Math.ceil(
    node.measured?.width ??
      node.width ??
      (node.type === StoryNodeType.Reroute ? 18 : autoLayoutFallbackWidth),
  );
}

function layoutNodeHeight(node: EditorGraphNode): number {
  if (node.measured?.height !== undefined || node.height !== undefined) {
    return Math.ceil(node.measured?.height ?? node.height ?? autoLayoutFallbackHeight);
  }
  if (node.type === StoryNodeType.Dialogue) {
    const lineCount = (node.data as DialogueNodeData).lines.length;
    return 74 + Math.min(3, Math.max(1, lineCount)) * 54;
  }
  if (node.type === StoryNodeType.Reroute) return 18;
  return autoLayoutFallbackHeight;
}

function layoutNodesOverlap(
  left: EditorGraphNode,
  leftPosition: { x: number; y: number },
  right: EditorGraphNode,
  rightPosition: { x: number; y: number },
): boolean {
  const horizontalGap = 32;
  const verticalGap = 24;
  return (
    leftPosition.x < rightPosition.x + layoutNodeWidth(right) + horizontalGap &&
    leftPosition.x + layoutNodeWidth(left) + horizontalGap > rightPosition.x &&
    leftPosition.y < rightPosition.y + layoutNodeHeight(right) + verticalGap &&
    leftPosition.y + layoutNodeHeight(left) + verticalGap > rightPosition.y
  );
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
  if (affected.length === 0) return graph;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const layoutNodes = affected.filter((node) => node.type !== StoryNodeType.Reroute);
  if (layoutNodes.length === 0) return graph;
  const layoutIds = new Set(layoutNodes.map((node) => node.id));
  const rerouteIds = new Set(
    affected.filter((node) => node.type === StoryNodeType.Reroute).map((node) => node.id),
  );
  const executionEdges = graph.edges.filter((edge) => isLayoutExecutionEdge(edge, nodesById));
  // Keep a selected/newly imported region close to its existing flow boundary. New nodes are
  // initially assigned to the graph's right edge by the command executor, so using that position
  // as the layout origin makes replacements drift away from the node they replace.
  const boundaryIncoming = executionEdges.filter((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    return (
      target !== undefined &&
      layoutIds.has(target.id) &&
      source !== undefined &&
      !layoutIds.has(source.id) &&
      source.type !== StoryNodeType.Reroute
    );
  });
  const boundaryOutgoing = executionEdges.filter((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    return (
      source !== undefined &&
      layoutIds.has(source.id) &&
      target !== undefined &&
      !layoutIds.has(target.id) &&
      target.type !== StoryNodeType.Reroute
    );
  });
  const executionFrom = new Map<NodeId, EditorGraphEdge[]>();
  const executionTo = new Map<NodeId, EditorGraphEdge[]>();
  for (const edge of executionEdges) {
    executionFrom.set(edge.source, [...(executionFrom.get(edge.source) ?? []), edge]);
    executionTo.set(edge.target, [...(executionTo.get(edge.target) ?? []), edge]);
  }

  const incomingConnections = new Map<NodeId, Array<{ sourceId: NodeId; sourceHandle?: string }>>();
  const outgoingConnections = new Map<NodeId, Array<{ targetId: NodeId; sourceHandle?: string }>>();

  for (const node of layoutNodes) {
    const fromEdges = executionFrom.get(node.id) ?? [];
    for (const firstEdge of fromEdges) {
      const sourceHandle = firstEdge.sourceHandle;
      const pending: NodeId[] = [firstEdge.target];
      const traversed = new Set<NodeId>();
      while (pending.length > 0) {
        const targetId = pending.shift()!;
        if (traversed.has(targetId)) continue;
        traversed.add(targetId);
        const targetNode = nodesById.get(targetId);
        if (targetNode?.type === StoryNodeType.Reroute) {
          pending.push(...(executionFrom.get(targetId) ?? []).map((edge) => edge.target));
        } else if (targetNode && layoutIds.has(targetNode.id)) {
          outgoingConnections.set(node.id, [
            ...(outgoingConnections.get(node.id) ?? []),
            { targetId: targetNode.id, sourceHandle },
          ]);
          incomingConnections.set(targetNode.id, [
            ...(incomingConnections.get(targetNode.id) ?? []),
            { sourceId: node.id, sourceHandle },
          ]);
        }
      }
    }
  }

  const terminalTargets = (sourceId: NodeId): NodeId[] => {
    const conns = outgoingConnections.get(sourceId) ?? [];
    return [...new Set(conns.map((conn) => conn.targetId))];
  };
  const outgoing = new Map<NodeId, NodeId[]>();
  const incoming = new Map<NodeId, NodeId[]>();
  const indegree = new Map<NodeId, number>(layoutNodes.map((node) => [node.id, 0]));
  for (const node of layoutNodes) {
    const targets = terminalTargets(node.id);
    outgoing.set(node.id, targets);
    for (const targetId of targets) {
      indegree.set(targetId, (indegree.get(targetId) ?? 0) + 1);
      incoming.set(targetId, [...(incoming.get(targetId) ?? []), node.id]);
    }
  }

  const originalOrder = [...layoutNodes].sort(
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
  const originalOriginX = Math.min(...layoutNodes.map((node) => node.position.x));
  const estimatedLayer = (node: EditorGraphNode) =>
    Math.max(
      0,
      Math.round(
        (node.position.x - originalOriginX) / (autoLayoutFallbackWidth + autoLayoutColumnGap),
      ),
    );
  const nearestVisitedLayer = (node: EditorGraphNode): number | undefined => {
    let nearest: { distance: number; layer: number } | undefined;
    for (const candidate of layoutNodes) {
      const layer = layers.get(candidate.id);
      if (layer === undefined || candidate.id === node.id) continue;
      const distance =
        (candidate.position.x - node.position.x) ** 2 +
        (candidate.position.y - node.position.y) ** 2;
      if (!nearest || distance < nearest.distance) nearest = { distance, layer };
    }
    return nearest?.layer;
  };
  const startLayerFor = (node: EditorGraphNode): number => {
    const connectedTargetLayers = (outgoing.get(node.id) ?? [])
      .map((targetId) => layers.get(targetId))
      .filter((layer): layer is number => layer !== undefined);
    if (connectedTargetLayers.length > 0) {
      return Math.max(0, Math.min(...connectedTargetLayers) - 1);
    }
    return nearestVisitedLayer(node) ?? estimatedLayer(node);
  };
  const visitFrom = (rootId: NodeId, startLayer: number) => {
    if (visited.has(rootId)) return;
    const queue: Array<{ id: NodeId; layer: number }> = [{ id: rootId, layer: startLayer }];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      layers.set(current.id, current.layer);
      for (const targetId of outgoing.get(current.id) ?? []) {
        if (!visited.has(targetId)) queue.push({ id: targetId, layer: current.layer + 1 });
      }
    }
  };
  const startRoots = sortIds(
    layoutNodes.filter((node) => node.type === StoryNodeType.Start).map((node) => node.id),
  );
  for (const rootId of startRoots) visitFrom(rootId, 0);
  const otherRoots = sortIds(
    layoutNodes
      .filter((node) => node.type !== StoryNodeType.Start && (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id),
  );
  for (const rootId of otherRoots) {
    const root = nodesById.get(rootId)!;
    visitFrom(rootId, startLayerFor(root));
  }
  for (const node of originalOrder) visitFrom(node.id, startLayerFor(node));

  // Breadth-first discovery gives a merge the rank of whichever branch reaches it first. Refine
  // acyclic regions with longest-path ranks so a shared successor always sits to the right of the
  // longest incoming branch. Kahn's queue intentionally leaves cyclic regions on the finite BFS
  // ranks above; relaxing a loop as a longest path would move it right forever.
  const remainingIndegree = new Map(indegree);
  const acyclicLayers = new Map<NodeId, number>();
  const rankQueue = sortIds(
    layoutNodes.filter((node) => (remainingIndegree.get(node.id) ?? 0) === 0).map((node) => node.id),
  );
  let rankQueueIndex = 0;
  for (const rootId of rankQueue) acyclicLayers.set(rootId, layers.get(rootId) ?? 0);
  while (rankQueueIndex < rankQueue.length) {
    const sourceId = rankQueue[rankQueueIndex++];
    const sourceLayer = acyclicLayers.get(sourceId) ?? layers.get(sourceId) ?? 0;
    for (const targetId of outgoing.get(sourceId) ?? []) {
      acyclicLayers.set(
        targetId,
        Math.max(acyclicLayers.get(targetId) ?? 0, sourceLayer + 1),
      );
      const nextIndegree = (remainingIndegree.get(targetId) ?? 0) - 1;
      remainingIndegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) rankQueue.push(targetId);
    }
  }
  for (const [nodeId, layer] of acyclicLayers) {
    if ((remainingIndegree.get(nodeId) ?? 0) === 0) layers.set(nodeId, layer);
  }
  // Right-align terminal nodes immediately before a merge. Without this, an edge from a shorter
  // branch can span an occupied intermediate column and React Flow's orthogonal path runs beneath
  // that column's node. Only single-successor terminals move, so shared or continuing flow keeps
  // its established rank.
  for (const merge of originalOrder) {
    const predecessors = incoming.get(merge.id) ?? [];
    const mergeLayer = layers.get(merge.id) ?? 0;
    if (predecessors.length < 2 || mergeLayer < 2) continue;
    for (const predecessorId of predecessors) {
      if ((outgoing.get(predecessorId) ?? []).length !== 1) continue;
      const predecessorLayer = layers.get(predecessorId) ?? 0;
      const predecessorInLayers = (incoming.get(predecessorId) ?? []).map(
        (id) => acyclicLayers.get(id) ?? layers.get(id) ?? 0,
      );
      const maxInLayer = predecessorInLayers.length > 0 ? Math.max(...predecessorInLayers) : 0;
      const targetLayer = mergeLayer - 1;
      if (predecessorLayer < targetLayer && targetLayer - maxInLayer <= 2) {
        layers.set(predecessorId, targetLayer);
      }
    }
  }

  const initialPositions = new Map(layoutNodes.map((node) => [node.id, node.position.y]));
  const nodeExecutionPorts = (node: EditorGraphNode) => {
    return resolveNodePorts(node).ports.filter(
      (port) => port.direction === 'output' && port.kind === 'execution',
    );
  };
  const sourcePortFraction = (node: EditorGraphNode, sourceHandle?: string) => {
    if (!sourceHandle) return 0.5;
    const ports = nodeExecutionPorts(node);
    if (ports.length <= 1) return 0.5;
    const index = ports.findIndex((port) => port.id === sourceHandle);
    if (index === -1) return 0.5;
    return (index + 0.5) / ports.length;
  };
  const sourcePortAnchorY = (node: EditorGraphNode, sourceHandle?: string) => {
    const pos = positions.get(node.id) ?? node.position;
    const height = layoutNodeHeight(node);
    const fraction = sourcePortFraction(node, sourceHandle);
    return pos.y + height * fraction;
  };

  const byLayer = new Map<number, EditorGraphNode[]>();
  for (const node of layoutNodes) {
    const layer = layers.get(node.id) ?? 0;
    const column = byLayer.get(layer) ?? [];
    column.push(node);
    byLayer.set(layer, column);
  }

  const orderedColumns = [...byLayer.entries()].sort(([left], [right]) => left - right);
  for (const [layer, column] of orderedColumns) {
    column.sort((a, b) => {
      if (layer > 0) {
        const inConnsA = incomingConnections.get(a.id) ?? [];
        const inConnsB = incomingConnections.get(b.id) ?? [];
        const anchorsA = inConnsA
          .filter((c) => (layers.get(c.sourceId) ?? layer) < layer)
          .map((c) => {
            const s = nodesById.get(c.sourceId);
            return s
              ? s.position.y + layoutNodeHeight(s) * sourcePortFraction(s, c.sourceHandle)
              : undefined;
          })
          .filter((y): y is number => y !== undefined);
        const anchorsB = inConnsB
          .filter((c) => (layers.get(c.sourceId) ?? layer) < layer)
          .map((c) => {
            const s = nodesById.get(c.sourceId);
            return s
              ? s.position.y + layoutNodeHeight(s) * sourcePortFraction(s, c.sourceHandle)
              : undefined;
          })
          .filter((y): y is number => y !== undefined);
        const avgA =
          anchorsA.length > 0 ? anchorsA.reduce((sum, y) => sum + y, 0) / anchorsA.length : undefined;
        const avgB =
          anchorsB.length > 0 ? anchorsB.reduce((sum, y) => sum + y, 0) / anchorsB.length : undefined;
        if (avgA !== undefined && avgB !== undefined && Math.abs(avgA - avgB) > 0.001) {
          return avgA - avgB;
        }
      }
      const initialPosA = initialPositions.get(a.id) ?? a.position.y;
      const initialPosB = initialPositions.get(b.id) ?? b.position.y;
      return initialPosA - initialPosB || a.id.localeCompare(b.id);
    });
  }

  const incomingOriginX = Math.max(
    ...boundaryIncoming.map((edge) => {
      const source = nodesById.get(edge.source)!;
      return source.position.x + layoutNodeWidth(source) + autoLayoutColumnGap;
    }),
    Number.NEGATIVE_INFINITY,
  );
  const boundaryOriginX =
    boundaryIncoming.length > 0
      ? incomingOriginX
      : boundaryOutgoing.length > 0
        ? Math.min(...boundaryOutgoing.map((edge) => nodesById.get(edge.target)!.position.x)) -
          autoLayoutColumnGap
        : originalOriginX;
  const originX = Math.round(boundaryOriginX);
  const boundaryY = [
    ...boundaryIncoming.map((edge) => nodesById.get(edge.source)!.position.y),
    ...boundaryOutgoing.map((edge) => nodesById.get(edge.target)!.position.y),
  ];
  const originY = Math.round(
    boundaryY.length > 0
      ? boundaryY.reduce((sum, value) => sum + value, 0) / boundaryY.length
      : Math.min(...layoutNodes.map((node) => node.position.y)),
  );
  const positions = new Map<NodeId, { x: number; y: number }>();
  let columnX = originX;
  for (const [, column] of orderedColumns) {
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

  const nodeCenterY = (nodeId: NodeId) => {
    const node = nodesById.get(nodeId);
    const position = positions.get(nodeId);
    return node && position ? position.y + layoutNodeHeight(node) / 2 : undefined;
  };
  const forwardDesiredCenter = (node: EditorGraphNode, currentLayer: number): number => {
    const inConns = incomingConnections.get(node.id) ?? [];
    const validAnchors = inConns
      .filter((conn) => (layers.get(conn.sourceId) ?? currentLayer) < currentLayer)
      .map((conn) => {
        const sourceNode = nodesById.get(conn.sourceId);
        return sourceNode ? sourcePortAnchorY(sourceNode, conn.sourceHandle) : undefined;
      })
      .filter((y): y is number => y !== undefined);

    if (validAnchors.length > 0) {
      return validAnchors.reduce((sum, y) => sum + y, 0) / validAnchors.length;
    }
    const currentPos = positions.get(node.id) ?? node.position;
    return currentPos.y + layoutNodeHeight(node) / 2;
  };

  const backwardDesiredCenter = (node: EditorGraphNode, currentLayer: number): number => {
    const outConns = outgoingConnections.get(node.id) ?? [];
    const validCenters = outConns
      .filter((conn) => (layers.get(conn.targetId) ?? currentLayer) > currentLayer)
      .map((conn) => {
        const targetCenter = nodeCenterY(conn.targetId);
        if (targetCenter === undefined) return undefined;
        const fraction = sourcePortFraction(node, conn.sourceHandle);
        const offsetFromCenter = (fraction - 0.5) * layoutNodeHeight(node);
        return targetCenter - offsetFromCenter;
      })
      .filter((y): y is number => y !== undefined);

    if (validCenters.length > 0) {
      return validCenters.reduce((sum, y) => sum + y, 0) / validCenters.length;
    }
    const currentPos = positions.get(node.id) ?? node.position;
    return currentPos.y + layoutNodeHeight(node) / 2;
  };

  const placeColumn = (
    column: EditorGraphNode[],
    getDesiredCenter: (node: EditorGraphNode) => number,
  ) => {
    const desiredCenters = new Map<NodeId, number>();
    for (const node of column) {
      desiredCenters.set(node.id, getDesiredCenter(node));
    }

    column.sort((a, b) => {
      const desiredA = desiredCenters.get(a.id) ?? 0;
      const desiredB = desiredCenters.get(b.id) ?? 0;
      if (Math.abs(desiredA - desiredB) > 0.001) {
        return desiredA - desiredB;
      }
      const initialPosA = initialPositions.get(a.id) ?? a.position.y;
      const initialPosB = initialPositions.get(b.id) ?? b.position.y;
      return initialPosA - initialPosB || a.id.localeCompare(b.id);
    });

    if (column.length === 1) {
      const node = column[0];
      const desired = desiredCenters.get(node.id) ?? originY + layoutNodeHeight(node) / 2;
      const current = positions.get(node.id)!;
      positions.set(node.id, {
        x: current.x,
        y: desired - layoutNodeHeight(node) / 2,
      });
      return;
    }

    interface NodeBlock {
      nodes: EditorGraphNode[];
      top: number;
      height: number;
      desiredCenterSum: number;
    }

    let blocks: NodeBlock[] = column.map((node) => {
      const h = layoutNodeHeight(node);
      const desired = desiredCenters.get(node.id) ?? originY + h / 2;
      return {
        nodes: [node],
        top: desired - h / 2,
        height: h,
        desiredCenterSum: desired,
      };
    });

    // Iteratively merge any blocks that collide or violate minimum row gap
    let merged = true;
    while (merged) {
      merged = false;
      const nextBlocks: NodeBlock[] = [];
      for (let i = 0; i < blocks.length; i++) {
        if (nextBlocks.length === 0) {
          nextBlocks.push(blocks[i]);
          continue;
        }
        const prev = nextBlocks[nextBlocks.length - 1];
        const curr = blocks[i];
        if (curr.top < prev.top + prev.height + autoLayoutRowGap) {
          const combinedNodes = [...prev.nodes, ...curr.nodes];
          const combinedDesiredSum = prev.desiredCenterSum + curr.desiredCenterSum;
          const avgDesiredCenter = combinedDesiredSum / combinedNodes.length;

          let totalHeight = 0;
          for (let k = 0; k < combinedNodes.length; k++) {
            totalHeight += layoutNodeHeight(combinedNodes[k]);
            if (k < combinedNodes.length - 1) totalHeight += autoLayoutRowGap;
          }

          const newTop = avgDesiredCenter - totalHeight / 2;
          nextBlocks[nextBlocks.length - 1] = {
            nodes: combinedNodes,
            top: newTop,
            height: totalHeight,
            desiredCenterSum: combinedDesiredSum,
          };
          merged = true;
        } else {
          nextBlocks.push(curr);
        }
      }
      blocks = nextBlocks;
    }

    for (const block of blocks) {
      let cursor = block.top;
      for (const node of block.nodes) {
        const current = positions.get(node.id)!;
        positions.set(node.id, { x: current.x, y: cursor });
        cursor += layoutNodeHeight(node) + autoLayoutRowGap;
      }
    }
  };

  // Sugiyama-style barycentric sweeps keep split branches around their source and place a shared
  // successor between its predecessors. Only forward edges participate, so loops cannot pull a
  // column back across the graph.
  // 1. Initial forward pass: propagate source anchors left-to-right
  for (const [layer, column] of orderedColumns.slice(1)) {
    placeColumn(column, (node) => forwardDesiredCenter(node, layer));
  }
  // 2. Backward pass: center split/branch roots between their outgoing children.
  // Columns with no forward outgoing edges (e.g. terminals) are skipped to prevent drift.
  for (const [layer, column] of [...orderedColumns].reverse().slice(1)) {
    const hasOutgoing = column.some((node) =>
      (outgoingConnections.get(node.id) ?? []).some(
        (c) => (layers.get(c.targetId) ?? layer) > layer,
      ),
    );
    if (!hasOutgoing) continue;
    placeColumn(column, (node) => backwardDesiredCenter(node, layer));
  }
  // 3. Final forward pass: align branches horizontally with their established sources.
  for (const [layer, column] of orderedColumns.slice(1)) {
    placeColumn(column, (node) => forwardDesiredCenter(node, layer));
  }
  const minimumY = Math.min(...layoutNodes.map((node) => positions.get(node.id)!.y));
  const verticalOffset = originY - minimumY;
  for (const node of layoutNodes) {
    const position = positions.get(node.id)!;
    positions.set(node.id, {
      x: Math.round(position.x),
      y: Math.round(position.y + verticalOffset),
    });
  }

  const positionedNode = (nodeId: NodeId): EditorGraphNode | undefined => {
    const node = nodesById.get(nodeId);
    const position = node && positions.get(nodeId);
    return node && position ? { ...node, position } : node;
  };
  const findAnchor = (rerouteId: NodeId, direction: 'incoming' | 'outgoing') => {
    let currentId = rerouteId;
    const traversed = new Set<NodeId>();
    while (!traversed.has(currentId)) {
      traversed.add(currentId);
      const candidates =
        direction === 'incoming' ? executionTo.get(currentId) : executionFrom.get(currentId);
      if (candidates?.length !== 1) return undefined;
      const nextId = direction === 'incoming' ? candidates[0].source : candidates[0].target;
      const next = positionedNode(nextId);
      if (!next) return undefined;
      if (next.type !== StoryNodeType.Reroute) return next;
      currentId = next.id;
    }
    return undefined;
  };

  const regularNodes = graph.nodes
    .filter((node) => node.type !== StoryNodeType.Reroute)
    .map((node) => positionedNode(node.id)!);
  const graphBottom = Math.max(
    0,
    ...regularNodes.map((node) => node.position.y + layoutNodeHeight(node)),
  );
  const processedReroutes = new Set<NodeId>();
  let returnLane = 0;
  const routeChain = (startId: NodeId) => {
    const chain: EditorGraphNode[] = [];
    let currentId: NodeId | undefined = startId;
    while (currentId && rerouteIds.has(currentId) && !processedReroutes.has(currentId)) {
      const current = nodesById.get(currentId);
      if (!current) break;
      chain.push(current);
      processedReroutes.add(currentId);
      const nextEdges: EditorGraphEdge[] = executionFrom.get(currentId) ?? [];
      currentId = nextEdges.length === 1 ? nextEdges[0].target : undefined;
    }
    if (chain.length === 0) return;
    const source = findAnchor(chain[0].id, 'incoming');
    const target = findAnchor(chain.at(-1)!.id, 'outgoing');
    if (!source || !target) return;
    const sourceX = source.position.x + layoutNodeWidth(source);
    const targetX = target.position.x;
    const forward = targetX > sourceX;
    const routeY = forward ? undefined : graphBottom + 100 + returnLane++ * (autoLayoutRowGap + 18);
    chain.forEach((reroute, index) => {
      const fraction = (index + 1) / (chain.length + 1);
      const centerX = sourceX + (targetX - sourceX) * fraction;
      const sourceY = source.position.y + layoutNodeHeight(source) / 2;
      const targetY = target.position.y + layoutNodeHeight(target) / 2;
      const centerY = routeY ?? sourceY + (targetY - sourceY) * fraction;
      positions.set(reroute.id, {
        x: Math.round(centerX - layoutNodeWidth(reroute) / 2),
        y: Math.round(centerY - layoutNodeHeight(reroute) / 2),
      });
    });
  };
  for (const rerouteId of rerouteIds) {
    const previous = executionTo.get(rerouteId) ?? [];
    if (previous.length !== 1 || !rerouteIds.has(previous[0].source)) routeChain(rerouteId);
  }
  for (const rerouteId of rerouteIds) routeChain(rerouteId);

  return {
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
    edges: graph.edges,
  };
}

export function replaceCharacterEmotionReferences(
  graph: EditorGraphState,
  characterId: CharacterId,
  fromEmotion: string,
  toEmotion?: string,
): EditorGraphState {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== StoryNodeType.Dialogue) return node;
    const data = node.data as DialogueNodeData;
    let nodeChanged = false;
    const lines = data.lines.map((line) => {
      if (line.speakerId !== characterId || line.emotion !== fromEmotion) return line;
      changed = true;
      nodeChanged = true;
      return { ...line, emotion: toEmotion };
    });
    return nodeChanged ? { ...node, data: { ...node.data, lines } } : node;
  });
  return changed ? { ...graph, nodes } : graph;
}

export function applyBlueprintLayoutRequests(
  graph: EditorGraphState,
  requests: readonly BlueprintLayoutRequest[],
): EditorGraphState {
  let result = graph;
  for (const request of requests) {
    if (request.kind === 'layout-selection') {
      result = autoLayoutGraph(result, [...request.nodeIds]);
      continue;
    }
    const seedIds = new Set(request.nodeIds);
    const affected = new Set(request.nodeIds);
    const nodesById = new Map(result.nodes.map((node) => [node.id, node] as const));
    for (const edge of result.edges) {
      if (seedIds.has(edge.source)) {
        const neighbor = nodesById.get(edge.target);
        if (neighbor?.type !== StoryNodeType.Reroute) affected.add(edge.target);
      }
      if (seedIds.has(edge.target)) {
        const neighbor = nodesById.get(edge.source);
        if (neighbor?.type !== StoryNodeType.Reroute) affected.add(edge.source);
      }
    }
    const directEdges = result.edges.filter(
      (edge) =>
        nodesById.get(edge.source)?.type !== StoryNodeType.Reroute &&
        nodesById.get(edge.target)?.type !== StoryNodeType.Reroute,
    );
    const arranged = autoLayoutGraph({ ...result, edges: directEdges }, [...affected]);
    result = { ...arranged, edges: result.edges };
  }
  return result;
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
  const occupied = [...positions].map(([nodeId, position]) => ({
    node: afterById.get(nodeId)!,
    position,
  }));
  const getMinIncomingPortFraction = (nodeId: NodeId): number => {
    const inEdges = after.edges.filter((e) => e.target === nodeId);
    let minFraction = 0.5;
    for (const edge of inEdges) {
      const source = afterById.get(edge.source);
      if (source && edge.sourceHandle) {
        const ports = resolveNodePorts(source).ports.filter(
          (p) => p.direction === 'output' && p.kind === 'execution',
        );
        if (ports.length > 1) {
          const idx = ports.findIndex((p) => p.id === edge.sourceHandle);
          if (idx !== -1) {
            const fraction = (idx + 0.5) / ports.length;
            if (fraction < minFraction) minFraction = fraction;
          }
        }
      }
    }
    return minFraction;
  };
  const sortedAddedNodeIds = [...addedNodeIds].sort((a, b) => {
    const fractionA = getMinIncomingPortFraction(a);
    const fractionB = getMinIncomingPortFraction(b);
    if (Math.abs(fractionA - fractionB) > 0.001) return fractionA - fractionB;
    return a.localeCompare(b);
  });
  const pending = new Set(sortedAddedNodeIds);
  const horizontalGap = 280;
  const verticalGap = 170;
  const existingRight = Math.max(
    0,
    ...occupied.map(({ node, position }) => position.x + layoutNodeWidth(node)),
  );

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
    const node = afterById.get(nodeId)!;
    while (
      occupied.some((entry) => layoutNodesOverlap(node, { x, y }, entry.node, entry.position))
    ) {
      y += verticalGap;
    }
    const position = { x, y };
    positions.set(nodeId, position);
    occupied.push({ node, position });
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

/** Keeps non-overlapping incoming nodes authored in place and relocates only additions that collide. */
export function arrangeOverlappingAddedNodes(
  before: EditorGraphState,
  after: EditorGraphState,
): EditorGraphState {
  const existingIds = new Set(before.nodes.map((node) => node.id));
  const addedIds = new Set(
    after.nodes.filter((node) => !existingIds.has(node.id)).map((node) => node.id),
  );
  const occupied: EditorGraphNode[] = after.nodes.filter((node) => !addedIds.has(node.id));
  const relocate = new Set<NodeId>();
  for (const node of after.nodes.filter((candidate) => addedIds.has(candidate.id))) {
    if (
      occupied.some((candidate) =>
        layoutNodesOverlap(node, node.position, candidate, candidate.position),
      )
    ) {
      relocate.add(node.id);
    } else {
      occupied.push(node);
    }
  }
  if (relocate.size === 0) return after;
  return prepareAIGraphChanges(
    {
      nodes: after.nodes.filter((node) => !relocate.has(node.id)),
      edges: after.edges,
    },
    after,
  ).graph;
}

/** Preserves proposed positions where possible and moves only selected nodes away from fixed nodes. */
export function avoidOverlappingNodes(
  graph: EditorGraphState,
  nodeIds: ReadonlySet<NodeId>,
): EditorGraphState {
  const movable = graph.nodes
    .filter((node) => nodeIds.has(node.id))
    .sort(
      (left, right) =>
        left.position.x - right.position.x ||
        left.position.y - right.position.y ||
        left.id.localeCompare(right.id),
    );
  const occupied = graph.nodes
    .filter((node) => !nodeIds.has(node.id))
    .map((node) => ({ node, position: node.position }));
  const positions = new Map<NodeId, { x: number; y: number }>();
  for (const node of movable) {
    const position = { ...node.position };
    let collisions = occupied.filter((entry) =>
      layoutNodesOverlap(node, position, entry.node, entry.position),
    );
    while (collisions.length > 0) {
      position.y = Math.max(
        position.y + 64,
        ...collisions.map(
          ({ node: obstacle, position: obstaclePosition }) =>
            obstaclePosition.y + layoutNodeHeight(obstacle) + 24,
        ),
      );
      collisions = occupied.filter((entry) =>
        layoutNodesOverlap(node, position, entry.node, entry.position),
      );
    }
    position.x = Math.round(position.x);
    position.y = Math.round(position.y);
    positions.set(node.id, position);
    occupied.push({ node, position });
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node,
    ),
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
    if (
      !result.valid &&
      (result.diagnostic.code === 'OUTPUT_ALREADY_CONNECTED' ||
        result.diagnostic.code === 'INPUT_ALREADY_CONNECTED')
    ) {
      nextEdges =
        result.diagnostic.code === 'OUTPUT_ALREADY_CONNECTED'
          ? nextEdges.filter(
              (candidate) =>
                candidate.source !== moved.source || candidate.sourceHandle !== moved.sourceHandle,
            )
          : nextEdges.filter(
              (candidate) =>
                candidate.target !== moved.target || candidate.targetHandle !== moved.targetHandle,
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
      parameters: readonly ChapterParameter[];
      outputs: readonly ChapterOutput[];
    }
  | { ok: false; message: string };

export interface ExtractSelectionOptions {
  visibleVariables?: readonly VariableDefinition[];
}

function isGraphExecutionEdge(
  edge: EditorGraphEdge,
  nodesById: ReadonlyMap<NodeId, EditorGraphNode>,
): boolean {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) return false;
  if (
    source.type === StoryNodeType.Reroute &&
    (source.data as Record<string, unknown>)?.rerouteType === 'data'
  ) {
    return false;
  }
  if (
    target.type === StoryNodeType.Reroute &&
    (target.data as Record<string, unknown>)?.rerouteType === 'data'
  ) {
    return false;
  }
  const sourcePorts = resolveNodePorts({
    id: source.id,
    type: source.type,
    data: source.data,
  }).ports;
  const sourcePort = sourcePorts.find((port) => port.id === edge.sourceHandle);
  if (sourcePort) return sourcePort.kind === 'execution';
  const targetPorts = resolveNodePorts({
    id: target.id,
    type: target.type,
    data: target.data,
  }).ports;
  const targetPort = targetPorts.find((port) => port.id === edge.targetHandle);
  if (targetPort) return targetPort.kind === 'execution';
  return edge.sourceHandle === 'out' && edge.targetHandle === 'in';
}

function sanitizeVariableName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `var_${cleaned}`;
  }
  return cleaned;
}

function getUniqueVariableName(base: string, usedNames: Set<string>): string {
  const sanitized = sanitizeVariableName(base);
  let candidate = sanitized;
  let counter = 1;
  while (usedNames.has(candidate)) {
    candidate = `${sanitized}_${counter++}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function resolveEdgeValueType(
  edge: EditorGraphEdge,
  sourceNode: EditorGraphNode,
  targetNode: EditorGraphNode,
  visibleVariables?: readonly VariableDefinition[],
): ValueType {
  if (sourceNode.type === StoryNodeType.GetVariable) {
    const varId = (sourceNode.data as Record<string, unknown>)?.variableId as
      | VariableId
      | undefined;
    if (varId && visibleVariables) {
      const found = visibleVariables.find((v) => v.id === varId);
      if (found) return found.valueType;
    }
  }
  const sourcePorts = resolveNodePorts({
    id: sourceNode.id,
    type: sourceNode.type,
    data: sourceNode.data,
  }).ports;
  const sourcePort = sourcePorts.find((port) => port.id === edge.sourceHandle);
  if (sourcePort?.valueType && sourcePort.valueType.kind !== 'any') {
    return sourcePort.valueType;
  }
  const targetPorts = resolveNodePorts({
    id: targetNode.id,
    type: targetNode.type,
    data: targetNode.data,
  }).ports;
  const targetPort = targetPorts.find((port) => port.id === edge.targetHandle);
  if (targetPort?.valueType && targetPort.valueType.kind !== 'any') {
    return targetPort.valueType;
  }
  return { kind: 'any' };
}

/** Extracts a single-entry/single-exit selection into a callable substory graph with data-pin boundaries. */
export function extractSelectionToSubstory(
  graph: EditorGraphState,
  chapterId: ChapterId,
  options?: ExtractSelectionOptions,
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
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));

  const incoming = graph.edges.filter(
    (edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const outgoing = graph.edges.filter(
    (edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target),
  );

  const incomingExecution = incoming.filter((edge) => isGraphExecutionEdge(edge, nodesById));
  const incomingData = incoming.filter((edge) => !isGraphExecutionEdge(edge, nodesById));
  const outgoingExecution = outgoing.filter((edge) => isGraphExecutionEdge(edge, nodesById));
  const outgoingData = outgoing.filter((edge) => !isGraphExecutionEdge(edge, nodesById));

  if (incomingExecution.length !== 1 || outgoingExecution.length !== 1) {
    return {
      ok: false,
      message: `Selection needs exactly one incoming and one outgoing connection (found ${incomingExecution.length} in, ${outgoingExecution.length} out).`,
    };
  }

  const minX = Math.min(...selected.map((node) => node.position.x));
  const maxX = Math.max(...selected.map((node) => node.position.x));
  const centerX = Math.round(
    selected.reduce((sum, node) => sum + node.position.x, 0) / selected.length,
  );
  const centerY = Math.round(
    selected.reduce((sum, node) => sum + node.position.y, 0) / selected.length,
  );
  const incomingTarget = selected.find((node) => node.id === incomingExecution[0].target)!;
  const outgoingSource = selected.find((node) => node.id === outgoingExecution[0].source)!;

  const entry: EditorGraphNode = {
    id: createStableId('node'),
    type: StoryNodeType.Start,
    definitionVersion: 1,
    position: { x: Math.round(minX - 280), y: Math.round(incomingTarget.position.y) },
    data: { title: 'Substory Entry' } as EditorNodeData,
    selected: false,
  };

  const usedVariableNames = new Set(
    (options?.visibleVariables ?? []).map((v) => v.name),
  );

  // Group incoming data edges by source node + source handle
  interface IncomingDataGroup {
    sourceNodeId: NodeId;
    sourceHandle: string;
    edges: EditorGraphEdge[];
  }
  const incomingDataGroups: IncomingDataGroup[] = [];
  const incomingGroupMap = new Map<string, IncomingDataGroup>();
  for (const edge of incomingData) {
    const key = `${edge.source}\0${edge.sourceHandle}`;
    let group = incomingGroupMap.get(key);
    if (!group) {
      group = {
        sourceNodeId: edge.source,
        sourceHandle: edge.sourceHandle,
        edges: [],
      };
      incomingGroupMap.set(key, group);
      incomingDataGroups.push(group);
    }
    group.edges.push(edge);
  }

  const parameters: ChapterParameter[] = [];
  const internalGetVariableNodes: EditorGraphNode[] = [];
  const internalDataEdges: EditorGraphEdge[] = [];
  const externalCallInputEdges: EditorGraphEdge[] = [];
  const callArguments: Record<VariableId, ExpressionSource> = {};
  const callArgumentInputTypes: Record<string, ValueType> = {};
  const callNodeId = createStableId('node');

  incomingDataGroups.forEach((group, index) => {
    const paramId = createStableId('variable') as VariableId;
    const sourceNode = nodesById.get(group.sourceNodeId)!;
    const firstTargetNode = nodesById.get(group.edges[0].target)!;
    const valueType = resolveEdgeValueType(
      group.edges[0],
      sourceNode,
      firstTargetNode,
      options?.visibleVariables,
    );
    const defaultValue = defaultForValueType(valueType);

    let baseName = 'input';
    if (sourceNode.type === StoryNodeType.GetVariable) {
      const varId = (sourceNode.data as Record<string, unknown>)?.variableId as
        | VariableId
        | undefined;
      const foundVar = options?.visibleVariables?.find((v) => v.id === varId);
      if (foundVar) baseName = foundVar.name;
    } else {
      const targetPorts = resolveNodePorts({
        id: firstTargetNode.id,
        type: firstTargetNode.type,
        data: firstTargetNode.data,
      }).ports;
      const targetPort = targetPorts.find((p) => p.id === group.edges[0].targetHandle);
      if (targetPort?.label) {
        baseName = targetPort.label;
      } else if (group.edges[0].targetHandle && group.edges[0].targetHandle !== 'in') {
        baseName = group.edges[0].targetHandle;
      }
    }
    const paramName = getUniqueVariableName(baseName, usedVariableNames);
    const paramDisplayName = paramName;

    parameters.push({
      direction: 'input',
      variable: {
        id: paramId,
        name: paramName,
        displayName: paramDisplayName,
        scope: 'local',
        valueType,
        defaultValue,
      },
    });

    const getVarNode: EditorGraphNode = {
      id: createStableId('node'),
      type: StoryNodeType.GetVariable,
      definitionVersion: 1,
      position: {
        x: Math.round(minX - 280),
        y: Math.round(incomingTarget.position.y + (index + 1) * 110),
      },
      data: {
        variableId: paramId,
      } as EditorNodeData,
      selected: false,
    };
    internalGetVariableNodes.push(getVarNode);

    for (const edge of group.edges) {
      internalDataEdges.push({
        id: createStableId('edge'),
        source: getVarNode.id,
        sourceHandle: 'value',
        target: edge.target,
        targetHandle: edge.targetHandle,
      });
    }

    externalCallInputEdges.push({
      id: createStableId('edge'),
      source: group.sourceNodeId,
      sourceHandle: group.sourceHandle,
      target: callNodeId,
      targetHandle: `argument:${paramId}`,
    });

    callArguments[paramId] = {
      source: JSON.stringify(defaultValue),
      bindings: {},
    };
    callArgumentInputTypes[paramId] = valueType;
  });

  // Group outgoing data edges by source node + source handle
  interface OutgoingDataGroup {
    sourceNodeId: NodeId;
    sourceHandle: string;
    edges: EditorGraphEdge[];
  }
  const outgoingDataGroups: OutgoingDataGroup[] = [];
  const outgoingGroupMap = new Map<string, OutgoingDataGroup>();
  for (const edge of outgoingData) {
    const key = `${edge.source}\0${edge.sourceHandle}`;
    let group = outgoingGroupMap.get(key);
    if (!group) {
      group = {
        sourceNodeId: edge.source,
        sourceHandle: edge.sourceHandle,
        edges: [],
      };
      outgoingGroupMap.set(key, group);
      outgoingDataGroups.push(group);
    }
    group.edges.push(edge);
  }

  const returnNodeId = createStableId('node');
  const outputs: ChapterOutput[] = [];
  const internalReturnDataEdges: EditorGraphEdge[] = [];
  const externalCallOutputEdges: EditorGraphEdge[] = [];
  const returnValues: Record<VariableId, ExpressionSource> = {};
  const returnValueInputTypes: Record<string, ValueType> = {};
  const callOutputPorts: { id: VariableId; label: string; valueType: ValueType }[] = [];

  outgoingDataGroups.forEach((group) => {
    const outputId = createStableId('variable') as VariableId;
    const sourceNode = nodesById.get(group.sourceNodeId)!;
    const firstTargetNode = nodesById.get(group.edges[0].target)!;
    const valueType = resolveEdgeValueType(
      group.edges[0],
      sourceNode,
      firstTargetNode,
      options?.visibleVariables,
    );
    const defaultValue = defaultForValueType(valueType);

    let baseName = 'output';
    if (sourceNode.type === StoryNodeType.GetVariable) {
      const varId = (sourceNode.data as Record<string, unknown>)?.variableId as
        | VariableId
        | undefined;
      const foundVar = options?.visibleVariables?.find((v) => v.id === varId);
      if (foundVar) baseName = foundVar.name;
    } else {
      const sourcePorts = resolveNodePorts({
        id: sourceNode.id,
        type: sourceNode.type,
        data: sourceNode.data,
      }).ports;
      const sourcePort = sourcePorts.find((p) => p.id === group.sourceHandle);
      if (sourcePort?.label) {
        baseName = sourcePort.label;
      } else if (group.sourceHandle && group.sourceHandle !== 'out') {
        baseName = group.sourceHandle;
      }
    }
    const outputName = getUniqueVariableName(baseName, usedVariableNames);
    const outputDisplayName = outputName;

    outputs.push({
      direction: 'output',
      variable: {
        id: outputId,
        name: outputName,
        displayName: outputDisplayName,
        scope: 'local',
        valueType,
        defaultValue,
      },
    });

    internalReturnDataEdges.push({
      id: createStableId('edge'),
      source: group.sourceNodeId,
      sourceHandle: group.sourceHandle,
      target: returnNodeId,
      targetHandle: `value:${outputId}`,
    });

    returnValues[outputId] = {
      source: JSON.stringify(defaultValue),
      bindings: {},
    };
    returnValueInputTypes[outputId] = valueType;

    for (const edge of group.edges) {
      externalCallOutputEdges.push({
        id: createStableId('edge'),
        source: callNodeId,
        sourceHandle: `output:${outputId}`,
        target: edge.target,
        targetHandle: edge.targetHandle,
      });
    }

    callOutputPorts.push({
      id: outputId,
      label: outputDisplayName,
      valueType,
    });
  });

  const returnNode: EditorGraphNode = {
    id: returnNodeId,
    type: StoryNodeType.Return,
    definitionVersion: 1,
    position: { x: Math.round(maxX + 280), y: Math.round(outgoingSource.position.y) },
    data: {
      values: returnValues,
      valueInputTypes: returnValueInputTypes,
    } as EditorNodeData,
    selected: false,
  };

  const call: EditorGraphNode = {
    id: callNodeId,
    type: StoryNodeType.CallSubstory,
    definitionVersion: 1,
    position: { x: centerX, y: centerY },
    data: {
      chapterId,
      arguments: callArguments,
      argumentInputTypes: callArgumentInputTypes,
      outputPorts: callOutputPorts,
      resultVariableIds: {},
    } as EditorNodeData,
    selected: true,
  };

  const internalEdges = graph.edges.filter(
    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  const chapterGraph: EditorGraphState = {
    nodes: [
      entry,
      ...internalGetVariableNodes,
      ...selected.map((node) => ({ ...structuredClone(node), selected: false })),
      returnNode,
    ],
    edges: [
      ...internalEdges.map((edge) => ({ ...structuredClone(edge), selected: false })),
      {
        id: createStableId('edge'),
        source: entry.id,
        sourceHandle: 'out',
        target: incomingExecution[0].target,
        targetHandle: incomingExecution[0].targetHandle,
      },
      ...internalDataEdges,
      {
        id: createStableId('edge'),
        source: outgoingExecution[0].source,
        sourceHandle: outgoingExecution[0].sourceHandle,
        target: returnNode.id,
        targetHandle: 'in',
      },
      ...internalReturnDataEdges,
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
        source: incomingExecution[0].source,
        sourceHandle: incomingExecution[0].sourceHandle,
        target: call.id,
        targetHandle: 'in',
      },
      {
        id: createStableId('edge'),
        source: call.id,
        sourceHandle: 'out',
        target: outgoingExecution[0].target,
        targetHandle: outgoingExecution[0].targetHandle,
      },
      ...externalCallInputEdges,
      ...externalCallOutputEdges,
    ],
  };
  return {
    ok: true,
    chapterGraph,
    remainingGraph,
    callNodeId: call.id,
    parameters,
    outputs,
  };
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
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        definitionVersion: node.definitionVersion,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        data: node.data,
      };
    }),
    edges: graph.edges.map((edge) => ({
      from: { nodeId: edge.source, portId: edge.sourceHandle },
      to: { nodeId: edge.target, portId: edge.targetHandle },
    })),
  };
}

export function fromSourceGraph(
  source: SourceGraph,
  options: { allowInvalidConnections?: boolean } = {},
): EditorGraphState {
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
  const connectionValidator = createGraphConnectionValidator(
    nodes.map((node) => ({ id: node.id, type: node.type, data: node.data })),
  );
  for (const edge of source.edges) {
    const candidate = {
      source: edge.from.nodeId,
      sourcePortId: edge.from.portId,
      target: edge.to.nodeId,
      targetPortId: edge.to.portId,
    };
    if (!options.allowInvalidConnections) {
      const result = connectionValidator.validate(candidate);
      if (!result.valid) throw new Error(`Invalid link: ${result.diagnostic.message}`);
    }
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
  // Only Choice option IDs are owned by the node. Other dynamic outputs identify
  // project resources (External Function outputs and Object fields) and must survive copying.
  if (node.type !== StoryNodeType.Choice) return { data, portIds };
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
