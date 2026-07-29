import type {
  ChapterId,
  EdgeId,
  NodeId,
  SourceEdge,
  SourceGraph,
  StorySourceDocument,
} from '@story-blueprint/common';
import { fromSourceGraph, type EditorGraphState } from './editorGraph';
import type { StoryMergeConflict } from './storyMerge';

export type StoryMergePreviewGraphId = 'root' | ChapterId;

export interface StoryMergePreviewGraph {
  id: StoryMergePreviewGraphId;
  displayName: string;
  graph: EditorGraphState;
  addedNodeIds: NodeId[];
  changedNodeIds: NodeId[];
  removedNodeIds: NodeId[];
  conflictNodeIds: NodeId[];
  addedEdgeIds: EdgeId[];
  removedEdgeIds: EdgeId[];
  conflictEdgeIds: EdgeId[];
}

export interface StoryMergePreview {
  nonce: number;
  graphs: StoryMergePreviewGraph[];
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function edgeKey(edge: SourceEdge): string {
  return `${edge.from.nodeId}:${edge.from.portId}>${edge.to.nodeId}:${edge.to.portId}`;
}

function conflictKeys(conflicts: readonly StoryMergeConflict[]) {
  const nodeIds = new Set<NodeId>();
  const edges = new Set<string>();
  for (const conflict of conflicts) {
    for (const encoded of conflict.id.split('/')) {
      const segment = decodeURIComponent(encoded);
      if (segment.startsWith('@id:n_')) nodeIds.add(segment.slice(4) as NodeId);
      if (segment.startsWith('@edge:')) edges.add(segment.slice(6));
    }
  }
  return { nodeIds, edges };
}

function previewGraph(
  id: StoryMergePreviewGraphId,
  displayName: string,
  local: SourceGraph,
  merged: SourceGraph | undefined,
  conflictNodeIds: ReadonlySet<NodeId>,
  conflictEdges: ReadonlySet<string>,
): StoryMergePreviewGraph {
  const target = merged ?? { nodes: [], edges: [] };
  const localNodes = new Map(local.nodes.map((node) => [node.id, node] as const));
  const mergedNodes = new Map(target.nodes.map((node) => [node.id, node] as const));
  const addedNodeIds = target.nodes
    .filter((node) => !localNodes.has(node.id))
    .map((node) => node.id);
  const removedNodeIds = local.nodes
    .filter((node) => !mergedNodes.has(node.id))
    .map((node) => node.id);
  const changedNodeIds = target.nodes
    .filter((node) => {
      const before = localNodes.get(node.id);
      return before !== undefined && !same(before, node);
    })
    .map((node) => node.id);

  const mergedEditor = fromSourceGraph(target);
  const localEditor = fromSourceGraph(local);
  const combinedNodes = [
    ...mergedEditor.nodes,
    ...localEditor.nodes.filter((node) => !mergedNodes.has(node.id)),
  ];
  const localEdges = new Map(local.edges.map((edge) => [edgeKey(edge), edge] as const));
  const mergedEdges = new Map(target.edges.map((edge) => [edgeKey(edge), edge] as const));
  const mergedEditorEdges = new Map(
    target.edges.map((edge, index) => [edgeKey(edge), mergedEditor.edges[index]] as const),
  );
  const localEditorEdges = new Map(
    local.edges.map((edge, index) => [edgeKey(edge), localEditor.edges[index]] as const),
  );
  const addedKeys = new Set([...mergedEdges.keys()].filter((key) => !localEdges.has(key)));
  const removedKeys = new Set([...localEdges.keys()].filter((key) => !mergedEdges.has(key)));
  const combinedEdges = [
    ...mergedEditor.edges,
    ...[...removedKeys].map((key) => localEditorEdges.get(key)!),
  ];
  const idsForKeys = (keys: ReadonlySet<string>, source: ReadonlyMap<string, { id: EdgeId }>) =>
    [...keys]
      .map((key) => source.get(key)?.id)
      .filter((edgeId): edgeId is EdgeId => Boolean(edgeId));
  const graphNodeIds = new Set(combinedNodes.map((node) => node.id));

  return {
    id,
    displayName,
    graph: { nodes: combinedNodes, edges: combinedEdges },
    addedNodeIds,
    changedNodeIds,
    removedNodeIds,
    conflictNodeIds: [...conflictNodeIds].filter((nodeId) => graphNodeIds.has(nodeId)),
    addedEdgeIds: idsForKeys(addedKeys, mergedEditorEdges),
    removedEdgeIds: idsForKeys(removedKeys, localEditorEdges),
    conflictEdgeIds: [
      ...idsForKeys(conflictEdges, mergedEditorEdges),
      ...idsForKeys(conflictEdges, localEditorEdges),
    ].filter((edgeId, index, all) => all.indexOf(edgeId) === index),
  };
}

export function buildStoryMergePreview(
  local: StorySourceDocument,
  merged: StorySourceDocument,
  conflicts: readonly StoryMergeConflict[],
): StoryMergePreview {
  const conflict = conflictKeys(conflicts);
  const mergedChapters = new Map(merged.chapters.map((chapter) => [chapter.id, chapter] as const));
  return {
    nonce: Date.now(),
    graphs: [
      previewGraph('root', 'Main Story', local.root, merged.root, conflict.nodeIds, conflict.edges),
      ...local.chapters.map((chapter) =>
        previewGraph(
          chapter.id,
          chapter.displayName,
          chapter.graph,
          mergedChapters.get(chapter.id)?.graph,
          conflict.nodeIds,
          conflict.edges,
        ),
      ),
    ],
  };
}
