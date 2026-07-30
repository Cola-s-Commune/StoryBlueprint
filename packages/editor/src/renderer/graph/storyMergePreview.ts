import type {
  ChapterId,
  EdgeId,
  NodeId,
  SourceEdge,
  SourceGraph,
  StorySourceDocument,
} from '@story-blueprint/common';
import { fromSourceGraph, type EditorGraphState } from './editorGraph';
import type { StoryMergeConflict, StoryMergeDecisions } from './storyMerge';

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
  nodeConflictIds: Readonly<Record<string, readonly string[]>>;
  edgeConflictIds: Readonly<Record<string, readonly string[]>>;
}

export interface StoryMergePreview {
  nonce: number;
  graphs: StoryMergePreviewGraph[];
  conflicts: readonly StoryMergeConflict[];
  decisions: StoryMergeDecisions;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function edgeKey(edge: SourceEdge): string {
  return `${edge.from.nodeId}:${edge.from.portId}>${edge.to.nodeId}:${edge.to.portId}`;
}

function conflictTarget(conflict: StoryMergeConflict) {
  let nodeId: NodeId | undefined;
  let edge: string | undefined;
  for (const encoded of conflict.id.split('/')) {
    const segment = decodeURIComponent(encoded);
    if (segment.startsWith('@id:n_')) nodeId = segment.slice(4) as NodeId;
    if (segment.startsWith('@edge:')) edge = segment.slice(6);
  }
  return { conflict, nodeId, edge };
}

function conflictKeys(conflicts: readonly StoryMergeConflict[]) {
  const nodeIds = new Set<NodeId>();
  const edges = new Set<string>();
  for (const conflict of conflicts) {
    const target = conflictTarget(conflict);
    if (target.nodeId) nodeIds.add(target.nodeId);
    if (target.edge) edges.add(target.edge);
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
  allConflicts: readonly StoryMergeConflict[],
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

  const previewLoadOptions = { allowInvalidConnections: true };
  const mergedEditor = fromSourceGraph(target, previewLoadOptions);
  const localEditor = fromSourceGraph(local, previewLoadOptions);
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
  const nodeConflictIds: Record<string, string[]> = {};
  const edgeConflictIds: Record<string, string[]> = {};
  for (const conflict of allConflicts) {
    const targetConflict = conflictTarget(conflict);
    if (targetConflict.nodeId && graphNodeIds.has(targetConflict.nodeId)) {
      (nodeConflictIds[targetConflict.nodeId] ??= []).push(conflict.id);
    }
    if (targetConflict.edge) {
      const edgeIds = [
        mergedEditorEdges.get(targetConflict.edge)?.id,
        localEditorEdges.get(targetConflict.edge)?.id,
      ].filter((edgeId): edgeId is EdgeId => Boolean(edgeId));
      for (const edgeId of edgeIds) (edgeConflictIds[edgeId] ??= []).push(conflict.id);
    }
  }

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
    nodeConflictIds,
    edgeConflictIds,
  };
}

export function buildStoryMergePreview(
  local: StorySourceDocument,
  merged: StorySourceDocument,
  conflicts: readonly StoryMergeConflict[],
  decisions: StoryMergeDecisions = {},
): StoryMergePreview {
  const unresolved = conflicts.filter((conflict) => decisions[conflict.id] === undefined);
  const conflict = conflictKeys(unresolved);
  const localChapters = new Map(local.chapters.map((chapter) => [chapter.id, chapter] as const));
  const mergedChapters = new Map(merged.chapters.map((chapter) => [chapter.id, chapter] as const));
  const chapterIds = [...localChapters.keys(), ...mergedChapters.keys()].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  return {
    nonce: Date.now(),
    conflicts,
    decisions,
    graphs: [
      previewGraph(
        'root',
        'Main Story',
        local.root,
        merged.root,
        conflict.nodeIds,
        conflict.edges,
        conflicts,
      ),
      ...chapterIds.map((chapterId) => {
        const localChapter = localChapters.get(chapterId);
        const mergedChapter = mergedChapters.get(chapterId);
        return previewGraph(
          chapterId,
          mergedChapter?.displayName ?? localChapter?.displayName ?? 'Substory',
          localChapter?.graph ?? { nodes: [], edges: [] },
          mergedChapter?.graph,
          conflict.nodeIds,
          conflict.edges,
          conflicts,
        );
      }),
    ],
  };
}
