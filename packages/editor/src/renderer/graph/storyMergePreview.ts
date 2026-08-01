import type {
  ChapterId,
  EdgeId,
  NodeId,
  SourceEdge,
  SourceGraph,
  StorySourceDocument,
} from '@story-blueprint/common';
import {
  avoidOverlappingNodes,
  fromSourceGraph,
  type EditorGraphState,
} from './editorGraph';
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
  resolvedNodeIds: NodeId[];
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

function sameNodeContent(
  left: SourceGraph['nodes'][number],
  right: SourceGraph['nodes'][number],
): boolean {
  const { position: _leftPosition, ...leftContent } = left;
  const { position: _rightPosition, ...rightContent } = right;
  return same(leftContent, rightContent);
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

function isSourceEdge(value: unknown): value is SourceEdge {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Partial<SourceEdge>;
  return Boolean(
    edge.from?.nodeId && edge.from.portId && edge.to?.nodeId && edge.to.portId,
  );
}

function conflictNodeTargets(conflict: StoryMergeConflict): NodeId[] {
  if (conflict.resolution?.kind === 'concurrent-insertion') {
    return [
      conflict.resolution.localNodeId as NodeId,
      conflict.resolution.remoteNodeId as NodeId,
    ];
  }
  if (
    conflict.resolution?.kind === 'connection-competition' ||
    conflict.resolution?.kind === 'entry-nodes'
  ) {
    return [...conflict.resolution.localNodeIds, ...conflict.resolution.remoteNodeIds].map(
      (nodeId) => nodeId as NodeId,
    );
  }
  const target = conflictTarget(conflict);
  return target.nodeId ? [target.nodeId] : [];
}

function conflictEdgeTargets(conflict: StoryMergeConflict): string[] {
  if (
    conflict.resolution?.kind === 'concurrent-insertion' ||
    conflict.resolution?.kind === 'connection-competition'
  ) {
    return [conflict.localValue, conflict.remoteValue]
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .filter(isSourceEdge)
      .map(edgeKey);
  }
  const target = conflictTarget(conflict);
  return target.edge ? [target.edge] : [];
}

function conflictKeys(conflicts: readonly StoryMergeConflict[]) {
  const nodeIds = new Set<NodeId>();
  const edges = new Set<string>();
  for (const conflict of conflicts) {
    for (const nodeId of conflictNodeTargets(conflict)) nodeIds.add(nodeId);
    for (const edge of conflictEdgeTargets(conflict)) edges.add(edge);
  }
  return { nodeIds, edges };
}

function resolvedConflictNodes(
  conflicts: readonly StoryMergeConflict[],
  decisions: StoryMergeDecisions,
): Set<NodeId> {
  const result = new Set<NodeId>();
  for (const conflict of conflicts) {
    const resolution = conflict.resolution;
    const decision = decisions[conflict.id];
    if (!resolution || !decision) continue;
    if (resolution.kind === 'concurrent-insertion') {
      if (decision !== 'remote') result.add(resolution.localNodeId as NodeId);
      if (decision !== 'local') result.add(resolution.remoteNodeId as NodeId);
      continue;
    }
    if (resolution.kind === 'connection-competition' || resolution.kind === 'entry-nodes') {
      const selected = decision === 'remote' ? resolution.remoteNodeIds : resolution.localNodeIds;
      for (const nodeId of selected) result.add(nodeId as NodeId);
    }
  }
  return result;
}

function previewGraph(
  id: StoryMergePreviewGraphId,
  displayName: string,
  local: SourceGraph,
  merged: SourceGraph | undefined,
  remote: SourceGraph | undefined,
  conflictNodeIds: ReadonlySet<NodeId>,
  resolvedNodeIds: ReadonlySet<NodeId>,
  conflictEdges: ReadonlySet<string>,
  allConflicts: readonly StoryMergeConflict[],
): StoryMergePreviewGraph {
  const target = merged ?? { nodes: [], edges: [] };
  const incoming = remote ?? { nodes: [], edges: [] };
  const localNodes = new Map(local.nodes.map((node) => [node.id, node] as const));
  const mergedNodes = new Map(target.nodes.map((node) => [node.id, node] as const));
  const addedNodeIds = target.nodes
    .filter((node) => !localNodes.has(node.id))
    .map((node) => node.id);
  const removedNodeIds = [...local.nodes, ...incoming.nodes]
    .filter((node) => !mergedNodes.has(node.id))
    .map((node) => node.id)
    .filter((nodeId, index, all) => all.indexOf(nodeId) === index);
  const changedNodeIds = target.nodes
    .filter((node) => {
      const before = localNodes.get(node.id);
      return before !== undefined && !sameNodeContent(before, node);
    })
    .map((node) => node.id);

  const previewLoadOptions = { allowInvalidConnections: true };
  const mergedEditor = fromSourceGraph(target, previewLoadOptions);
  const localEditor = fromSourceGraph(local, previewLoadOptions);
  const remoteEditor = fromSourceGraph(incoming, previewLoadOptions);
  const combinedNodes = [
    ...mergedEditor.nodes,
    ...localEditor.nodes.filter((node) => !mergedNodes.has(node.id)),
    ...remoteEditor.nodes.filter(
      (node) => !mergedNodes.has(node.id) && !localNodes.has(node.id),
    ),
  ];
  const localEdges = new Map(local.edges.map((edge) => [edgeKey(edge), edge] as const));
  const remoteEdges = new Map(incoming.edges.map((edge) => [edgeKey(edge), edge] as const));
  const mergedEdges = new Map(target.edges.map((edge) => [edgeKey(edge), edge] as const));
  const mergedEditorEdges = new Map(
    target.edges.map((edge, index) => [edgeKey(edge), mergedEditor.edges[index]] as const),
  );
  const localEditorEdges = new Map(
    local.edges.map((edge, index) => [edgeKey(edge), localEditor.edges[index]] as const),
  );
  const remoteEditorEdges = new Map(
    incoming.edges.map((edge, index) => [edgeKey(edge), remoteEditor.edges[index]] as const),
  );
  const addedKeys = new Set([...mergedEdges.keys()].filter((key) => !localEdges.has(key)));
  const removedKeys = new Set(
    [...localEdges.keys(), ...remoteEdges.keys()].filter((key) => !mergedEdges.has(key)),
  );
  const combinedEdges = [
    ...mergedEditor.edges,
    ...[...removedKeys]
      .filter((key) => localEditorEdges.has(key))
      .map((key) => localEditorEdges.get(key)!),
    ...[...removedKeys]
      .filter((key) => !localEditorEdges.has(key))
      .map((key) => remoteEditorEdges.get(key)!),
  ];
  const arrangedPreview = avoidOverlappingNodes(
    { nodes: combinedNodes, edges: combinedEdges },
    new Set(removedNodeIds),
  );
  const graphEdgeIds = new Set(arrangedPreview.edges.map((edge) => edge.id));
  const idsForKeys = (keys: ReadonlySet<string>, source: ReadonlyMap<string, { id: EdgeId }>) =>
    [...keys]
      .map((key) => source.get(key)?.id)
      .filter((edgeId): edgeId is EdgeId => Boolean(edgeId));
  const graphNodeIds = new Set(combinedNodes.map((node) => node.id));
  const nodeConflictIds: Record<string, string[]> = {};
  const edgeConflictIds: Record<string, string[]> = {};
  for (const conflict of allConflicts) {
    for (const nodeId of conflictNodeTargets(conflict)) {
      if (graphNodeIds.has(nodeId)) (nodeConflictIds[nodeId] ??= []).push(conflict.id);
    }
    for (const edge of conflictEdgeTargets(conflict)) {
      const edgeIds = [
        mergedEditorEdges.get(edge)?.id,
        localEditorEdges.get(edge)?.id,
        remoteEditorEdges.get(edge)?.id,
      ].filter((edgeId): edgeId is EdgeId => Boolean(edgeId && graphEdgeIds.has(edgeId)));
      for (const edgeId of edgeIds) (edgeConflictIds[edgeId] ??= []).push(conflict.id);
    }
  }

  return {
    id,
    displayName,
    graph: arrangedPreview,
    addedNodeIds,
    changedNodeIds,
    removedNodeIds,
    conflictNodeIds: [...conflictNodeIds].filter((nodeId) => graphNodeIds.has(nodeId)),
    resolvedNodeIds: [...resolvedNodeIds].filter(
      (nodeId) => graphNodeIds.has(nodeId) && !removedNodeIds.includes(nodeId),
    ),
    addedEdgeIds: idsForKeys(addedKeys, mergedEditorEdges),
    removedEdgeIds: [
      ...idsForKeys(removedKeys, localEditorEdges),
      ...idsForKeys(removedKeys, remoteEditorEdges),
    ].filter((edgeId, index, all) => graphEdgeIds.has(edgeId) && all.indexOf(edgeId) === index),
    conflictEdgeIds: [
      ...idsForKeys(conflictEdges, mergedEditorEdges),
      ...idsForKeys(conflictEdges, localEditorEdges),
      ...idsForKeys(conflictEdges, remoteEditorEdges),
    ].filter(
      (edgeId, index, all) => graphEdgeIds.has(edgeId) && all.indexOf(edgeId) === index,
    ),
    nodeConflictIds,
    edgeConflictIds,
  };
}

export function buildStoryMergePreview(
  local: StorySourceDocument,
  merged: StorySourceDocument,
  conflicts: readonly StoryMergeConflict[],
  decisions: StoryMergeDecisions = {},
  remote?: StorySourceDocument,
): StoryMergePreview {
  const unresolved = conflicts.filter((conflict) => decisions[conflict.id] === undefined);
  const conflict = conflictKeys(unresolved);
  const resolvedNodes = resolvedConflictNodes(conflicts, decisions);
  const localChapters = new Map(local.chapters.map((chapter) => [chapter.id, chapter] as const));
  const mergedChapters = new Map(merged.chapters.map((chapter) => [chapter.id, chapter] as const));
  const remoteChapters = new Map(
    remote?.chapters.map((chapter) => [chapter.id, chapter] as const) ?? [],
  );
  const chapterIds = [
    ...localChapters.keys(),
    ...mergedChapters.keys(),
    ...remoteChapters.keys(),
  ].filter(
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
        remote?.root,
        conflict.nodeIds,
        resolvedNodes,
        conflict.edges,
        conflicts,
      ),
      ...chapterIds.map((chapterId) => {
        const localChapter = localChapters.get(chapterId);
        const mergedChapter = mergedChapters.get(chapterId);
        const remoteChapter = remoteChapters.get(chapterId);
        return previewGraph(
          chapterId,
          mergedChapter?.displayName ??
            localChapter?.displayName ??
            remoteChapter?.displayName ??
            'Substory',
          localChapter?.graph ?? { nodes: [], edges: [] },
          mergedChapter?.graph,
          remoteChapter?.graph,
          conflict.nodeIds,
          resolvedNodes,
          conflict.edges,
          conflicts,
        );
      }),
    ],
  };
}
