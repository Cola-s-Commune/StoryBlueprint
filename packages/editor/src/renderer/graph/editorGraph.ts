import type { Edge, Node } from '@xyflow/react';
import {
  createStableId,
  nodeRegistry,
  StoryNodeType,
  validateGraphConnection,
  type ChoiceNodeData,
  type EdgeId,
  type NodeId,
  type NodeInstance,
  type OptionId,
  type SourceGraph,
  type StoryNodeDataMap,
} from '@story-blueprint/common';

export type EditorNodeData = StoryNodeDataMap[StoryNodeType] & Record<string, unknown>;

export type EditorGraphNode = Node<EditorNodeData, StoryNodeType> & {
  id: NodeId;
  name: string;
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
              name: `option_${option.id.slice(-8).replaceAll('-', '_')}`,
              displayName: option.label,
            }))
          : undefined;

      return {
        id: node.id,
        name: node.name,
        type: node.type,
        definitionVersion: node.definitionVersion,
        position: node.position,
        data: node.data,
        dynamicPorts,
      };
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
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
    if (!result.valid) throw new Error(`Invalid edge ${edge.id}: ${result.diagnostic.message}`);
    edges.push({
      id: edge.id,
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

function uniqueCopyName(name: string, usedNames: Set<string>): string {
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
  const usedNames = new Set(graph.nodes.map((node) => node.name));

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
