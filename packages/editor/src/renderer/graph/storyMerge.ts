import {
  resolveNodePorts,
  StoryNodeType,
  type SourceEdge,
  type SourceGraph,
  type StorySourceDocument,
} from '@story-blueprint/common';
import {
  arrangeOverlappingAddedNodes,
  autoLayoutGraph,
  avoidOverlappingNodes,
  fromSourceGraph,
} from './editorGraph';

export type StoryMergeChoice = 'local' | 'remote' | 'local-first' | 'remote-first';

export interface ConcurrentInsertionResolution {
  kind: 'concurrent-insertion';
  localNodeId: string;
  remoteNodeId: string;
  localNodeIds: string[];
  remoteNodeIds: string[];
  localLabel: string;
  remoteLabel: string;
}

export interface ConnectionCompetitionResolution {
  kind: 'connection-competition';
  localNodeIds: string[];
  remoteNodeIds: string[];
  localLabel: string;
  remoteLabel: string;
}

export interface EntryNodeResolution {
  kind: 'entry-nodes';
  localNodeIds: string[];
  remoteNodeIds: string[];
}

export interface ExecutionRegionResolution {
  kind: 'execution-region';
  localNodeIds: string[];
  remoteNodeIds: string[];
  coreNodeIds: string[];
  boundaryNodeIds: string[];
  coreLabels: string[];
  boundaryLabels: string[];
  changedOutputCount: number;
  localImpact: ExecutionRegionImpact;
  remoteImpact: ExecutionRegionImpact;
  requiresConfirmation: boolean;
  supportsPerOutput: boolean;
  outputs: ExecutionRegionOutputResolution[];
  localCoveredConflictIds: string[];
  remoteCoveredConflictIds: string[];
  localLabel: string;
  remoteLabel: string;
}

export interface ExecutionRegionOutputResolution {
  decisionId: string;
  sourceNodeId: string;
  sourcePortId: string;
  sourceLabel: string;
  portLabel: string;
  localTargetLabels: string[];
  remoteTargetLabels: string[];
}

export interface ExecutionRegionImpact {
  nodesAdded: number;
  nodesRemoved: number;
  linksAdded: number;
  linksRemoved: number;
}

export interface StoryMergeConflict {
  id: string;
  path: string;
  kind: 'changed' | 'local-only' | 'remote-only';
  localValue?: unknown;
  remoteValue?: unknown;
  resolution?:
    | ConcurrentInsertionResolution
    | ConnectionCompetitionResolution
    | EntryNodeResolution
    | ExecutionRegionResolution;
}

export interface ThreeWayStoryDiff {
  conflicts: StoryMergeConflict[];
  autoMerged: MergeableStoryDocument;
  autoChangeCount: number;
}

export interface ThreeWayValueDiff<T> {
  conflicts: StoryMergeConflict[];
  autoMerged: T;
  autoChangeCount: number;
}

export type StoryMergeDecisions = Readonly<Record<string, StoryMergeChoice>>;

export function storyMergeConflictHasDecision(
  conflict: StoryMergeConflict,
  decisions: StoryMergeDecisions,
): boolean {
  if (decisions[conflict.id] !== undefined) return true;
  return Boolean(
    conflict.resolution?.kind === 'execution-region' &&
    conflict.resolution.supportsPerOutput &&
    conflict.resolution.outputs.length > 0 &&
    conflict.resolution.outputs.every(
      (output) =>
        decisions[output.decisionId] === 'local' || decisions[output.decisionId] === 'remote',
    ),
  );
}

export function storyMergeCoveredConflictIds(
  conflicts: readonly StoryMergeConflict[],
  decisions: StoryMergeDecisions,
): Set<string> {
  const covered = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.resolution?.kind !== 'execution-region') continue;
    const choice = decisions[conflict.id];
    const conflictIds =
      choice === 'local'
        ? conflict.resolution.localCoveredConflictIds
        : choice === 'remote'
          ? conflict.resolution.remoteCoveredConflictIds
          : [];
    for (const conflictId of conflictIds) covered.add(conflictId);
  }
  return covered;
}

export function unresolvedStoryMergeConflicts(
  conflicts: readonly StoryMergeConflict[],
  decisions: StoryMergeDecisions,
): StoryMergeConflict[] {
  const covered = storyMergeCoveredConflictIds(conflicts, decisions);
  return conflicts.filter(
    (conflict) => !covered.has(conflict.id) && !storyMergeConflictHasDecision(conflict, decisions),
  );
}

export type MergeableStoryDocument = Pick<
  StorySourceDocument,
  'id' | 'variables' | 'root' | 'chapters'
>;

const missing = Symbol('missing');
const executionRegionConfirmationThreshold = {
  coreNodes: 12,
  changedOutputs: 4,
  linksPerSide: 20,
} as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayItemKey(value: unknown, index: number): string | undefined {
  if (typeof value === 'string') return `value:${value}`;
  if (!isRecord(value)) return undefined;
  if (typeof value.id === 'string') return `id:${value.id}`;
  const from = value.from;
  const to = value.to;
  if (isRecord(from) && isRecord(to)) {
    return `edge:${String(from.nodeId)}:${String(from.portId)}>${String(to.nodeId)}:${String(to.portId)}`;
  }
  if (typeof value.name === 'string') return `name:${value.name}`;
  return `index:${index}`;
}

function keyedArray(value: unknown[]): Map<string, unknown> | undefined {
  const result = new Map<string, unknown>();
  for (let index = 0; index < value.length; index += 1) {
    const key = arrayItemKey(value[index], index);
    if (!key || key.startsWith('index:') || result.has(key)) return undefined;
    result.set(key, value[index]);
  }
  return result;
}

function childPath(path: string, segment: string): string {
  return `${path}/${encodeURIComponent(segment)}`;
}

function orderMatters(path: string): boolean {
  const field = decodeURIComponent(path.split('/').at(-1) ?? '');
  return (
    field === 'lines' ||
    field === 'options' ||
    field === 'chapters' ||
    field === 'variables' ||
    field === 'parameters'
  );
}

function isPositionPath(path: string): boolean {
  return decodeURIComponent(path.split('/').at(-1) ?? '') === 'position';
}

function mergedKeyOrder(
  primary: readonly string[],
  secondary: readonly string[],
  included: ReadonlySet<string>,
): string[] {
  const result = primary.filter((key) => included.has(key));
  for (let index = 0; index < secondary.length; index += 1) {
    const key = secondary[index];
    if (!included.has(key) || result.includes(key)) continue;
    const next = secondary.slice(index + 1).find((candidate) => result.includes(candidate));
    if (next) {
      result.splice(result.indexOf(next), 0, key);
      continue;
    }
    const previous = secondary
      .slice(0, index)
      .reverse()
      .find((candidate) => result.includes(candidate));
    if (previous) result.splice(result.indexOf(previous) + 1, 0, key);
    else result.push(key);
  }
  return result;
}

function insertionGaps(
  baseOrder: readonly string[],
  branchOrder: readonly string[],
  otherOrder: ReadonlySet<string>,
): Set<string> {
  const baseKeys = new Set(baseOrder);
  const gaps = new Set<string>();
  for (let index = 0; index < branchOrder.length; index += 1) {
    if (baseKeys.has(branchOrder[index]) || otherOrder.has(branchOrder[index])) continue;
    const previous = branchOrder
      .slice(0, index)
      .reverse()
      .find((key) => baseKeys.has(key));
    const next = branchOrder.slice(index + 1).find((key) => baseKeys.has(key));
    gaps.add(`${previous ?? '^'}\0${next ?? '$'}`);
  }
  return gaps;
}

function hasConcurrentInsertionGap(
  baseOrder: readonly string[],
  localOrder: readonly string[],
  remoteOrder: readonly string[],
): boolean {
  const localGaps = insertionGaps(baseOrder, localOrder, new Set(remoteOrder));
  const remoteGaps = insertionGaps(baseOrder, remoteOrder, new Set(localOrder));
  return [...localGaps].some((gap) => remoteGaps.has(gap));
}

function mergeConcurrentInsertions(
  baseOrder: readonly string[],
  primary: readonly string[],
  secondary: readonly string[],
  included: ReadonlySet<string>,
): string[] {
  const baseKeys = new Set(baseOrder);
  const skeleton = primary.filter((key) => baseKeys.has(key) && included.has(key));
  const additions = (
    order: readonly string[],
    excluded: ReadonlySet<string>,
  ): Map<string, string[]> => {
    const skeletonKeys = new Set(skeleton);
    const result = new Map<string, string[]>();
    for (let index = 0; index < order.length; index += 1) {
      const key = order[index];
      if (!included.has(key) || skeletonKeys.has(key) || excluded.has(key)) continue;
      const previous = order
        .slice(0, index)
        .reverse()
        .find((candidate) => skeletonKeys.has(candidate));
      const next = order.slice(index + 1).find((candidate) => skeletonKeys.has(candidate));
      const gap = `${previous ?? '^'}\0${next ?? '$'}`;
      result.set(gap, [...(result.get(gap) ?? []), key]);
    }
    return result;
  };
  const primaryAdditions = new Set(primary.filter((key) => !baseKeys.has(key)));
  const primaryByGap = additions(primary, new Set());
  const secondaryByGap = additions(secondary, primaryAdditions);
  const result: string[] = [];
  const emit = (gap: string) => {
    for (const key of [...(primaryByGap.get(gap) ?? []), ...(secondaryByGap.get(gap) ?? [])]) {
      if (!result.includes(key)) result.push(key);
    }
  };
  if (skeleton.length === 0) {
    emit('^\0$');
  } else {
    emit(`^\0${skeleton[0]}`);
    skeleton.forEach((key, index) => {
      result.push(key);
      emit(`${key}\0${skeleton[index + 1] ?? '$'}`);
    });
  }
  for (const key of [...primary, ...secondary]) {
    if (included.has(key) && !result.includes(key)) result.push(key);
  }
  return result;
}

function conflict(
  path: string,
  localPresent: boolean,
  localValue: unknown,
  remotePresent: boolean,
  remoteValue: unknown,
): StoryMergeConflict {
  return {
    id: path,
    path: path.split('/').filter(Boolean).map(decodeURIComponent).join(' › '),
    kind: !localPresent ? 'remote-only' : !remotePresent ? 'local-only' : 'changed',
    ...(localPresent ? { localValue: clone(localValue) } : {}),
    ...(remotePresent ? { remoteValue: clone(remoteValue) } : {}),
  };
}

function collectDiff(
  localPresent: boolean,
  localValue: unknown,
  remotePresent: boolean,
  remoteValue: unknown,
  path: string,
  output: StoryMergeConflict[],
) {
  if (localPresent && remotePresent && same(localValue, remoteValue)) return;
  if (!localPresent || !remotePresent) {
    output.push(conflict(path, localPresent, localValue, remotePresent, remoteValue));
    return;
  }
  if (isPositionPath(path) && isRecord(localValue) && isRecord(remoteValue)) {
    output.push(conflict(path, true, localValue, true, remoteValue));
    return;
  }
  if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
    const localItems = keyedArray(localValue);
    const remoteItems = keyedArray(remoteValue);
    if (!localItems || !remoteItems) {
      output.push(conflict(path, true, localValue, true, remoteValue));
      return;
    }
    const keys = [...localItems.keys(), ...remoteItems.keys()].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
    for (const key of keys) {
      collectDiff(
        localItems.has(key),
        localItems.get(key),
        remoteItems.has(key),
        remoteItems.get(key),
        childPath(path, `@${key}`),
        output,
      );
    }
    const localOrder = [...localItems.keys()].filter((key) => remoteItems.has(key));
    const remoteOrder = [...remoteItems.keys()].filter((key) => localItems.has(key));
    if (orderMatters(path) && !same(localOrder, remoteOrder)) {
      output.push(conflict(childPath(path, '@order'), true, localOrder, true, remoteOrder));
    }
    return;
  }
  if (isRecord(localValue) && isRecord(remoteValue)) {
    const keys = [...Object.keys(localValue), ...Object.keys(remoteValue)].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
    for (const key of keys) {
      collectDiff(
        Object.hasOwn(localValue, key),
        localValue[key],
        Object.hasOwn(remoteValue, key),
        remoteValue[key],
        childPath(path, key),
        output,
      );
    }
    return;
  }
  output.push(conflict(path, true, localValue, true, remoteValue));
}

export function mergeableStory(source: StorySourceDocument): MergeableStoryDocument {
  return {
    id: source.id,
    variables: clone(source.variables),
    root: clone(source.root),
    chapters: clone(source.chapters),
  };
}

export function diffStoryDocuments(
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
): StoryMergeConflict[] {
  const output: StoryMergeConflict[] = [];
  collectDiff(true, local, true, remote, 'story', output);
  return output;
}

function equivalent(
  leftPresent: boolean,
  leftValue: unknown,
  rightPresent: boolean,
  rightValue: unknown,
): boolean {
  return leftPresent === rightPresent && (!leftPresent || same(leftValue, rightValue));
}

function mergeThreeValue(
  basePresent: boolean,
  baseValue: unknown,
  localPresent: boolean,
  localValue: unknown,
  remotePresent: boolean,
  remoteValue: unknown,
  path: string,
  decisions: StoryMergeDecisions,
  conflicts: StoryMergeConflict[],
  autoPaths: Set<string>,
): unknown | typeof missing {
  if (equivalent(localPresent, localValue, remotePresent, remoteValue)) {
    return localPresent ? clone(localValue) : missing;
  }
  if (equivalent(basePresent, baseValue, localPresent, localValue)) {
    autoPaths.add(path);
    return remotePresent ? clone(remoteValue) : missing;
  }
  if (equivalent(basePresent, baseValue, remotePresent, remoteValue)) {
    autoPaths.add(path);
    return localPresent ? clone(localValue) : missing;
  }

  if (
    isPositionPath(path) &&
    localPresent &&
    remotePresent &&
    isRecord(localValue) &&
    isRecord(remoteValue)
  ) {
    conflicts.push(conflict(path, true, localValue, true, remoteValue));
    return clone(decisions[path] === 'remote' ? remoteValue : localValue);
  }

  if (
    localPresent &&
    remotePresent &&
    Array.isArray(localValue) &&
    Array.isArray(remoteValue) &&
    (!basePresent || Array.isArray(baseValue))
  ) {
    const baseItems = keyedArray(basePresent ? (baseValue as unknown[]) : []);
    const localItems = keyedArray(localValue);
    const remoteItems = keyedArray(remoteValue);
    if (baseItems && localItems && remoteItems) {
      const keys = [...baseItems.keys(), ...localItems.keys(), ...remoteItems.keys()].filter(
        (key, index, all) => all.indexOf(key) === index,
      );
      const mergedItems = new Map<string, unknown>();
      for (const key of keys) {
        const value = mergeThreeValue(
          baseItems.has(key),
          baseItems.get(key),
          localItems.has(key),
          localItems.get(key),
          remoteItems.has(key),
          remoteItems.get(key),
          childPath(path, `@${key}`),
          decisions,
          conflicts,
          autoPaths,
        );
        if (value !== missing) mergedItems.set(key, value);
      }

      const baseOrder = [...baseItems.keys()];
      const localOrder = [...localItems.keys()];
      const remoteOrder = [...remoteItems.keys()];
      const baseInLocal = baseOrder.filter((key) => localItems.has(key));
      const localBaseItems = localOrder.filter((key) => baseItems.has(key));
      const baseInRemote = baseOrder.filter((key) => remoteItems.has(key));
      const remoteBaseItems = remoteOrder.filter((key) => baseItems.has(key));
      const localReordered = orderMatters(path) && !same(baseInLocal, localBaseItems);
      const remoteReordered = orderMatters(path) && !same(baseInRemote, remoteBaseItems);
      const orderPath = childPath(path, '@order');
      const concurrentInsertions =
        orderMatters(path) && hasConcurrentInsertionGap(baseOrder, localOrder, remoteOrder);
      let primary = localOrder;
      let secondary = remoteOrder;
      let concurrentOrder: string[] | undefined;
      if (concurrentInsertions) {
        conflicts.push(conflict(orderPath, true, localOrder, true, remoteOrder));
        if (decisions[orderPath] === 'remote' || decisions[orderPath] === 'remote-first') {
          primary = remoteOrder;
          secondary = localOrder;
        }
        concurrentOrder = mergeConcurrentInsertions(
          baseOrder,
          primary,
          secondary,
          new Set(mergedItems.keys()),
        );
      } else if (remoteReordered && !localReordered) {
        autoPaths.add(orderPath);
        primary = remoteOrder;
        secondary = localOrder;
      } else if (localReordered && remoteReordered && !same(localBaseItems, remoteBaseItems)) {
        conflicts.push(conflict(orderPath, true, localOrder, true, remoteOrder));
        if (decisions[orderPath] === 'remote') {
          primary = remoteOrder;
          secondary = localOrder;
        }
      }
      return (
        concurrentOrder ?? mergedKeyOrder(primary, secondary, new Set(mergedItems.keys()))
      ).map((key) => mergedItems.get(key)!);
    }
  }

  if (
    localPresent &&
    remotePresent &&
    isRecord(localValue) &&
    isRecord(remoteValue) &&
    (!basePresent || isRecord(baseValue))
  ) {
    const baseRecord = basePresent ? (baseValue as Record<string, unknown>) : {};
    const result: Record<string, unknown> = {};
    const keys = [
      ...Object.keys(baseRecord),
      ...Object.keys(localValue),
      ...Object.keys(remoteValue),
    ].filter((key, index, all) => all.indexOf(key) === index);
    for (const key of keys) {
      const value = mergeThreeValue(
        Object.hasOwn(baseRecord, key),
        baseRecord[key],
        Object.hasOwn(localValue, key),
        localValue[key],
        Object.hasOwn(remoteValue, key),
        remoteValue[key],
        childPath(path, key),
        decisions,
        conflicts,
        autoPaths,
      );
      if (value !== missing) result[key] = value;
    }
    return result;
  }

  conflicts.push(conflict(path, localPresent, localValue, remotePresent, remoteValue));
  const useRemote = decisions[path] === 'remote';
  if (useRemote) return remotePresent ? clone(remoteValue) : missing;
  return localPresent ? clone(localValue) : missing;
}

function threeWayResult(
  base: unknown,
  local: unknown,
  remote: unknown,
  decisions: StoryMergeDecisions,
  rootPath: string,
) {
  const conflicts: StoryMergeConflict[] = [];
  const autoPaths = new Set<string>();
  const merged = mergeThreeValue(
    true,
    base,
    true,
    local,
    true,
    remote,
    rootPath,
    decisions,
    conflicts,
    autoPaths,
  );
  return { conflicts, merged, autoChangeCount: autoPaths.size };
}

function edgeKey(edge: SourceEdge): string {
  return `${edge.from.nodeId}:${edge.from.portId}>${edge.to.nodeId}:${edge.to.portId}`;
}

function executionSuccessors(graph: SourceGraph): Map<string, SourceEdge[]> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const result = new Map<string, SourceEdge[]>();
  for (const edge of graph.edges) {
    const node = nodes.get(edge.from.nodeId);
    if (!node) continue;
    const executionOutput = resolveNodePorts({
      id: node.id,
      type: node.type as StoryNodeType,
      data: node.data,
    }).ports.some(
      (port) =>
        port.id === edge.from.portId && port.kind === 'execution' && port.direction === 'output',
    );
    if (!executionOutput) continue;
    const key = `${edge.from.nodeId}\0${edge.from.portId}`;
    result.set(key, [...(result.get(key) ?? []), edge]);
  }
  return result;
}

function dataInputSources(graph: SourceGraph): Map<string, SourceEdge[]> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const result = new Map<string, SourceEdge[]>();
  for (const edge of graph.edges) {
    const node = nodes.get(edge.to.nodeId);
    if (!node) continue;
    const dataInput = resolveNodePorts({
      id: node.id,
      type: node.type as StoryNodeType,
      data: node.data,
    }).ports.some(
      (port) => port.id === edge.to.portId && port.kind === 'data' && port.direction === 'input',
    );
    if (!dataInput) continue;
    const key = `${edge.to.nodeId}\0${edge.to.portId}`;
    result.set(key, [...(result.get(key) ?? []), edge]);
  }
  return result;
}

function sameEdgeSet(left: readonly SourceEdge[], right: readonly SourceEdge[]): boolean {
  const leftKeys = left.map(edgeKey).sort();
  const rightKeys = right.map(edgeKey).sort();
  return same(leftKeys, rightKeys);
}

interface ConcurrentInsertionPlan extends ConcurrentInsertionResolution {
  localPath: SourceEdge[];
  remotePath: SourceEdge[];
}

function nodeLabel(graph: SourceGraph, nodeId: string): string {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return nodeId;
  if (node.name) return node.name;
  if (node.type === StoryNodeType.Dialogue) {
    const text = (node.data as { lines?: Array<{ text?: { source?: string } }> }).lines?.[0]?.text
      ?.source;
    if (text) return text;
  }
  const title = (node.data as { title?: string }).title;
  return title || nodeId;
}

function chainLabel(graph: SourceGraph, nodeIds: readonly string[]): string {
  if (nodeIds.length === 1) return nodeLabel(graph, nodeIds[0]);
  return `${nodeLabel(graph, nodeIds[0])} → ${nodeLabel(graph, nodeIds.at(-1)!)} (${nodeIds.length} nodes)`;
}

function traceLinearInsertion(
  baseGraph: SourceGraph,
  branchGraph: SourceGraph,
  otherGraph: SourceGraph,
  entry: SourceEdge,
  baseTarget: SourceEdge['to'],
): { nodeIds: string[]; path: SourceEdge[] } | undefined {
  const baseNodeIds = new Set(baseGraph.nodes.map((node) => node.id));
  const otherNodeIds = new Set(otherGraph.nodes.map((node) => node.id));
  const branchNodes = new Map(branchGraph.nodes.map((node) => [node.id, node] as const));
  const nodeIds: string[] = [];
  const path = [entry];
  const visited = new Set<string>();
  let currentNodeId = entry.to.nodeId;
  let incoming = entry;

  while (currentNodeId !== baseTarget.nodeId || incoming.to.portId !== baseTarget.portId) {
    if (
      visited.has(currentNodeId) ||
      baseNodeIds.has(currentNodeId) ||
      otherNodeIds.has(currentNodeId)
    ) {
      return;
    }
    const node = branchNodes.get(currentNodeId);
    if (!node) return;
    const executionPorts = resolveNodePorts({
      id: node.id,
      type: node.type as StoryNodeType,
      data: node.data,
    }).ports.filter((port) => port.kind === 'execution');
    const inputPorts = executionPorts.filter((port) => port.direction === 'input');
    const outputPorts = executionPorts.filter((port) => port.direction === 'output');
    if (inputPorts.length !== 1 || outputPorts.length !== 1) return;

    const incomingEdges = branchGraph.edges.filter(
      (edge) =>
        edge.to.nodeId === currentNodeId && inputPorts.some((port) => port.id === edge.to.portId),
    );
    const outgoingEdges = branchGraph.edges.filter(
      (edge) =>
        edge.from.nodeId === currentNodeId &&
        outputPorts.some((port) => port.id === edge.from.portId),
    );
    if (
      incomingEdges.length !== 1 ||
      outgoingEdges.length !== 1 ||
      edgeKey(incomingEdges[0]) !== edgeKey(incoming)
    ) {
      return;
    }

    visited.add(currentNodeId);
    nodeIds.push(currentNodeId);
    incoming = outgoingEdges[0];
    path.push(incoming);
    currentNodeId = incoming.to.nodeId;
    if (nodeIds.length > branchGraph.nodes.length) return;
  }

  return nodeIds.length > 0 ? { nodeIds, path } : undefined;
}

function detectConcurrentInsertion(
  baseGraph: SourceGraph,
  localGraph: SourceGraph,
  remoteGraph: SourceGraph,
  baseEdges: readonly SourceEdge[],
  localEdges: readonly SourceEdge[],
  remoteEdges: readonly SourceEdge[],
): ConcurrentInsertionPlan | undefined {
  if (baseEdges.length !== 1 || localEdges.length !== 1 || remoteEdges.length !== 1) return;
  const baseEdge = baseEdges[0];
  const localEntry = localEdges[0];
  const remoteEntry = remoteEdges[0];
  const local = traceLinearInsertion(baseGraph, localGraph, remoteGraph, localEntry, baseEdge.to);
  const remote = traceLinearInsertion(baseGraph, remoteGraph, localGraph, remoteEntry, baseEdge.to);
  if (!local || !remote || local.nodeIds.some((nodeId) => remote.nodeIds.includes(nodeId))) return;
  const localNodeId = local.nodeIds[0];
  const remoteNodeId = remote.nodeIds[0];
  return {
    kind: 'concurrent-insertion',
    localNodeId,
    remoteNodeId,
    localNodeIds: local.nodeIds,
    remoteNodeIds: remote.nodeIds,
    localLabel: chainLabel(localGraph, local.nodeIds),
    remoteLabel: chainLabel(remoteGraph, remote.nodeIds),
    localPath: local.path,
    remotePath: remote.path,
  };
}

function applyConcurrentInsertionChoice(
  graph: SourceGraph,
  plan: ConcurrentInsertionPlan,
  choice: StoryMergeChoice | undefined,
): void {
  if (!choice) return;
  const localNodeIds = new Set(plan.localNodeIds);
  const remoteNodeIds = new Set(plan.remoteNodeIds);
  const pathEdgeKeys = new Set([...plan.localPath, ...plan.remotePath].map(edgeKey));
  const retainedEdges = graph.edges.filter((edge) => !pathEdgeKeys.has(edgeKey(edge)));
  if (choice === 'local') {
    graph.nodes = graph.nodes.filter((node) => !remoteNodeIds.has(node.id));
    graph.edges = [
      ...retainedEdges.filter(
        (edge) => !remoteNodeIds.has(edge.from.nodeId) && !remoteNodeIds.has(edge.to.nodeId),
      ),
      ...clone(plan.localPath),
    ];
    return;
  }
  if (choice === 'remote') {
    graph.nodes = graph.nodes.filter((node) => !localNodeIds.has(node.id));
    graph.edges = [
      ...retainedEdges.filter(
        (edge) => !localNodeIds.has(edge.from.nodeId) && !localNodeIds.has(edge.to.nodeId),
      ),
      ...clone(plan.remotePath),
    ];
    return;
  }
  const localEntry = plan.localPath[0];
  const localContinuation = plan.localPath.at(-1)!;
  const remoteEntry = plan.remotePath[0];
  const remoteContinuation = plan.remotePath.at(-1)!;
  if (choice === 'local-first') {
    graph.edges = [
      ...retainedEdges,
      ...clone(plan.localPath.slice(0, -1)),
      { from: clone(localContinuation.from), to: clone(remoteEntry.to) },
      ...clone(plan.remotePath.slice(1)),
    ];
    return;
  }
  graph.edges = [
    ...retainedEdges,
    ...clone(plan.remotePath.slice(0, -1)),
    { from: clone(remoteContinuation.from), to: clone(localEntry.to) },
    ...clone(plan.localPath.slice(1)),
  ];
}

function storyGraphs(story: MergeableStoryDocument): Map<string, SourceGraph> {
  return new Map([
    ['root', story.root] as const,
    ...story.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  ]);
}

interface ExecutionSuccessorCandidate {
  outputKey: string;
}

interface ExecutionRegionPlan extends ExecutionRegionResolution {
  path: string;
  affectedNodeIds: string[];
  localEdges: SourceEdge[];
  remoteEdges: SourceEdge[];
  outputPlans: ExecutionRegionOutputPlan[];
}

interface ExecutionRegionOutputPlan extends ExecutionRegionOutputResolution {
  outputKey: string;
  localEdges: SourceEdge[];
  remoteEdges: SourceEdge[];
}

function conflictNodeTargetInGraph(
  conflict: StoryMergeConflict,
  graphId: string,
): { nodeId: string; nodeRoot: boolean } | undefined {
  const segments = conflict.id.split('/').map(decodeURIComponent);
  if (segments[0] !== 'story' || segments[1] !== graphId || segments[2] !== 'nodes') return;
  const nodeIndex = segments.findIndex((segment) => segment.startsWith('@id:'));
  if (nodeIndex < 0) return;
  return { nodeId: segments[nodeIndex].slice(4), nodeRoot: nodeIndex === segments.length - 1 };
}

function executionEdges(graph: SourceGraph): SourceEdge[] {
  return [...executionSuccessors(graph).values()].flat();
}

function executionRegionEdges(graph: SourceGraph, coreNodeIds: ReadonlySet<string>): SourceEdge[] {
  return executionEdges(graph).filter(
    (edge) => coreNodeIds.has(edge.from.nodeId) || coreNodeIds.has(edge.to.nodeId),
  );
}

function executionRegionImpact(
  baseGraph: SourceGraph,
  branchGraph: SourceGraph,
  coreNodeIds: ReadonlySet<string>,
): ExecutionRegionImpact {
  const baseNodes = new Set(
    baseGraph.nodes.filter((node) => coreNodeIds.has(node.id)).map((node) => node.id),
  );
  const branchNodes = new Set(
    branchGraph.nodes.filter((node) => coreNodeIds.has(node.id)).map((node) => node.id),
  );
  const baseEdges = new Set(executionRegionEdges(baseGraph, coreNodeIds).map(edgeKey));
  const branchEdges = new Set(executionRegionEdges(branchGraph, coreNodeIds).map(edgeKey));
  return {
    nodesAdded: [...branchNodes].filter((nodeId) => !baseNodes.has(nodeId)).length,
    nodesRemoved: [...baseNodes].filter((nodeId) => !branchNodes.has(nodeId)).length,
    linksAdded: [...branchEdges].filter((key) => !baseEdges.has(key)).length,
    linksRemoved: [...baseEdges].filter((key) => !branchEdges.has(key)).length,
  };
}

function detectExecutionRegions(
  graphId: string,
  baseGraph: SourceGraph,
  localGraph: SourceGraph,
  remoteGraph: SourceGraph,
  candidates: readonly ExecutionSuccessorCandidate[],
  protectedNodeIds: ReadonlySet<string>,
): ExecutionRegionPlan[] {
  if (candidates.length === 0) return [];
  const baseNodeIds = new Set<string>(baseGraph.nodes.map((node) => node.id));
  const localNodeIdsInGraph = new Set<string>(localGraph.nodes.map((node) => node.id));
  const remoteNodeIdsInGraph = new Set<string>(remoteGraph.nodes.map((node) => node.id));
  const candidateSourceNodeIds = new Set<string>(
    candidates.map((candidate) => candidate.outputKey.split('\0')[0]),
  );
  const stableBoundaryNodeIds = new Set<string>(
    [...baseNodeIds].filter(
      (nodeId) =>
        localNodeIdsInGraph.has(nodeId) &&
        remoteNodeIdsInGraph.has(nodeId) &&
        !candidateSourceNodeIds.has(nodeId),
    ),
  );
  const baseEdgeKeys = new Set(executionEdges(baseGraph).map(edgeKey));
  const localEdgeKeys = new Set(executionEdges(localGraph).map(edgeKey));
  const remoteEdgeKeys = new Set(executionEdges(remoteGraph).map(edgeKey));
  const structuralEdges = [
    ...executionEdges(baseGraph),
    ...executionEdges(localGraph),
    ...executionEdges(remoteGraph),
  ].filter((edge, index, all) => {
    const key = edgeKey(edge);
    if (all.findIndex((candidate) => edgeKey(candidate) === key) !== index) return false;
    if (protectedNodeIds.has(edge.from.nodeId) || protectedNodeIds.has(edge.to.nodeId))
      return false;
    const presence = [baseEdgeKeys.has(key), localEdgeKeys.has(key), remoteEdgeKeys.has(key)];
    return !presence.every((value) => value === presence[0]);
  });
  const neighbors = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    const adjacent = neighbors.get(from) ?? new Set<string>();
    adjacent.add(to);
    neighbors.set(from, adjacent);
  };
  for (const edge of structuralEdges) {
    connect(edge.from.nodeId, edge.to.nodeId);
    connect(edge.to.nodeId, edge.from.nodeId);
  }
  const componentFor = (start: string): string[] => {
    const visited = new Set<string>();
    const pending = [start];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (visited.has(nodeId) || protectedNodeIds.has(nodeId)) continue;
      visited.add(nodeId);
      if (nodeId !== start && stableBoundaryNodeIds.has(nodeId)) continue;
      for (const neighbor of neighbors.get(nodeId) ?? []) pending.push(neighbor);
    }
    return [...visited].sort();
  };
  const groups = new Map<
    string,
    { nodeIds: string[]; candidates: ExecutionSuccessorCandidate[] }
  >();
  for (const candidate of candidates) {
    const [sourceNodeId] = candidate.outputKey.split('\0');
    const nodeIds = componentFor(sourceNodeId);
    const key = nodeIds.join('\0');
    const group = groups.get(key) ?? { nodeIds, candidates: [] };
    group.candidates.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ nodeIds, candidates: regionCandidates }) => {
    const coreNodeIds = new Set(
      nodeIds.filter(
        (nodeId) =>
          candidateSourceNodeIds.has(nodeId) ||
          baseNodeIds.has(nodeId) !== localNodeIdsInGraph.has(nodeId) ||
          baseNodeIds.has(nodeId) !== remoteNodeIdsInGraph.has(nodeId),
      ),
    );
    const boundaryNodeIds = nodeIds.filter((nodeId) => !coreNodeIds.has(nodeId));
    const localEdges = executionRegionEdges(localGraph, coreNodeIds);
    const remoteEdges = executionRegionEdges(remoteGraph, coreNodeIds);
    const anchors = regionCandidates
      .map((candidate) => candidate.outputKey.replace('\0', ':'))
      .sort()
      .join(',');
    const path = childPath(childPath('story', graphId), `execution-region:${anchors}`);
    const localNodeIds = nodeIds.filter((nodeId) => localNodeIdsInGraph.has(nodeId));
    const remoteNodeIds = nodeIds.filter((nodeId) => remoteNodeIdsInGraph.has(nodeId));
    const labelFor = (nodeId: string) => {
      if (localNodeIdsInGraph.has(nodeId)) return nodeLabel(localGraph, nodeId);
      if (remoteNodeIdsInGraph.has(nodeId)) return nodeLabel(remoteGraph, nodeId);
      return nodeLabel(baseGraph, nodeId);
    };
    const outputPlans: ExecutionRegionOutputPlan[] = [...regionCandidates]
      .sort((left, right) => left.outputKey.localeCompare(right.outputKey))
      .map((candidate) => {
        const [sourceNodeId, sourcePortId] = candidate.outputKey.split('\0');
        const sourceNode =
          localGraph.nodes.find((node) => node.id === sourceNodeId) ??
          remoteGraph.nodes.find((node) => node.id === sourceNodeId) ??
          baseGraph.nodes.find((node) => node.id === sourceNodeId);
        const portLabel = sourceNode
          ? (resolveNodePorts({
              id: sourceNode.id,
              type: sourceNode.type as StoryNodeType,
              data: sourceNode.data,
            }).ports.find((port) => port.id === sourcePortId)?.label ?? sourcePortId)
          : sourcePortId;
        const localOutputEdges = executionSuccessors(localGraph).get(candidate.outputKey) ?? [];
        const remoteOutputEdges = executionSuccessors(remoteGraph).get(candidate.outputKey) ?? [];
        return {
          decisionId: childPath(path, `output:${sourceNodeId}:${sourcePortId}`),
          outputKey: candidate.outputKey,
          sourceNodeId,
          sourcePortId,
          sourceLabel: labelFor(sourceNodeId),
          portLabel,
          localTargetLabels: localOutputEdges.map((edge) => nodeLabel(localGraph, edge.to.nodeId)),
          remoteTargetLabels: remoteOutputEdges.map((edge) =>
            nodeLabel(remoteGraph, edge.to.nodeId),
          ),
          localEdges: [...localOutputEdges],
          remoteEdges: [...remoteOutputEdges],
        };
      });
    const coreLabels = [...coreNodeIds].map(labelFor);
    const boundaryLabels = boundaryNodeIds.map(labelFor);
    const localImpact = executionRegionImpact(baseGraph, localGraph, coreNodeIds);
    const remoteImpact = executionRegionImpact(baseGraph, remoteGraph, coreNodeIds);
    const changedOutputCount = regionCandidates.length;
    const requiresConfirmation =
      coreNodeIds.size > executionRegionConfirmationThreshold.coreNodes ||
      changedOutputCount > executionRegionConfirmationThreshold.changedOutputs ||
      Math.max(localEdges.length, remoteEdges.length) >
        executionRegionConfirmationThreshold.linksPerSide;
    const supportsPerOutput =
      outputPlans.length > 1 &&
      nodeIds
        .filter((nodeId) => baseNodeIds.has(nodeId))
        .every((nodeId) => localNodeIdsInGraph.has(nodeId) && remoteNodeIdsInGraph.has(nodeId));
    return {
      kind: 'execution-region',
      path,
      affectedNodeIds: nodeIds,
      localNodeIds,
      remoteNodeIds,
      coreNodeIds: [...coreNodeIds],
      boundaryNodeIds,
      coreLabels,
      boundaryLabels,
      changedOutputCount,
      localImpact,
      remoteImpact,
      requiresConfirmation,
      supportsPerOutput,
      outputs: outputPlans,
      localCoveredConflictIds: [],
      remoteCoveredConflictIds: [],
      localEdges,
      remoteEdges,
      outputPlans,
      localLabel: `Local region · ${localNodeIds.length} nodes · ${localEdges.length} links`,
      remoteLabel: `Remote region · ${remoteNodeIds.length} nodes · ${remoteEdges.length} links`,
    };
  });
}

function applyExecutionRegionChoice(
  graph: SourceGraph,
  localGraph: SourceGraph,
  remoteGraph: SourceGraph,
  plan: ExecutionRegionPlan,
  choice: StoryMergeChoice | undefined,
): void {
  if (choice !== 'local' && choice !== 'remote') return;
  const affectedNodeIds = new Set(plan.affectedNodeIds);
  const chosenGraph = choice === 'remote' ? remoteGraph : localGraph;
  const chosenEdges = choice === 'remote' ? plan.remoteEdges : plan.localEdges;
  const chosenNodes = new Map<string, SourceGraph['nodes'][number]>(
    chosenGraph.nodes
      .filter((node) => affectedNodeIds.has(node.id))
      .map((node) => [node.id, node] as const),
  );
  const removedNodeIds = new Set(plan.affectedNodeIds.filter((nodeId) => !chosenNodes.has(nodeId)));
  const existingNodeIds = new Set(graph.nodes.map((node) => node.id));
  graph.nodes = [
    ...graph.nodes.filter((node) => !removedNodeIds.has(node.id)),
    ...[...chosenNodes.values()].filter((node) => !existingNodeIds.has(node.id)).map(clone),
  ];
  const regionEdgeKeys = new Set([...plan.localEdges, ...plan.remoteEdges].map(edgeKey));
  graph.edges = [
    ...graph.edges.filter(
      (edge) =>
        !regionEdgeKeys.has(edgeKey(edge)) &&
        !removedNodeIds.has(edge.from.nodeId) &&
        !removedNodeIds.has(edge.to.nodeId),
    ),
    ...clone(chosenEdges),
  ].filter(
    (edge, index, all) =>
      all.findIndex((candidate) => edgeKey(candidate) === edgeKey(edge)) === index,
  );
}

function applyExecutionRegionDecisions(
  graph: SourceGraph,
  baseGraph: SourceGraph,
  localGraph: SourceGraph,
  remoteGraph: SourceGraph,
  plan: ExecutionRegionPlan,
  decisions: StoryMergeDecisions,
): void {
  const wholeChoice = decisions[plan.path];
  if (wholeChoice === 'local' || wholeChoice === 'remote') {
    applyExecutionRegionChoice(graph, localGraph, remoteGraph, plan, wholeChoice);
    return;
  }
  if (
    !plan.supportsPerOutput ||
    plan.outputPlans.some(
      (output) =>
        decisions[output.decisionId] !== 'local' && decisions[output.decisionId] !== 'remote',
    )
  ) {
    return;
  }

  const outputKeys = new Set(plan.outputPlans.map((output) => output.outputKey));
  const chosenEdges = plan.outputPlans.flatMap((output) =>
    clone(decisions[output.decisionId] === 'remote' ? output.remoteEdges : output.localEdges),
  );
  graph.edges = [
    ...graph.edges.filter((edge) => !outputKeys.has(`${edge.from.nodeId}\0${edge.from.portId}`)),
    ...chosenEdges,
  ].filter(
    (edge, index, all) =>
      all.findIndex((candidate) => edgeKey(candidate) === edgeKey(edge)) === index,
  );

  const baseNodeIds = new Set<string>(baseGraph.nodes.map((node) => node.id));
  const exclusiveAddedNodeIds = new Set<string>(
    plan.affectedNodeIds.filter((nodeId) => !baseNodeIds.has(nodeId)),
  );
  const outgoing = new Map<string, string[]>();
  for (const edge of executionEdges(graph)) {
    outgoing.set(edge.from.nodeId, [...(outgoing.get(edge.from.nodeId) ?? []), edge.to.nodeId]);
  }
  const reachable = new Set<string>();
  const pending: string[] = graph.nodes
    .filter((node) => !exclusiveAddedNodeIds.has(node.id))
    .map((node) => node.id);
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const targetNodeId of outgoing.get(nodeId) ?? []) pending.push(targetNodeId);
  }
  const removedNodeIds = new Set(
    [...exclusiveAddedNodeIds].filter((nodeId) => !reachable.has(nodeId)),
  );
  graph.nodes = graph.nodes.filter((node) => !removedNodeIds.has(node.id));
  graph.edges = graph.edges.filter(
    (edge) => !removedNodeIds.has(edge.from.nodeId) && !removedNodeIds.has(edge.to.nodeId),
  );
}

function resolveExecutionSuccessorConflicts(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  merged: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
  conflicts: StoryMergeConflict[],
): void {
  const baseGraphs = storyGraphs(base);
  const localGraphs = storyGraphs(local);
  const remoteGraphs = storyGraphs(remote);
  const mergedGraphs = storyGraphs(merged);
  for (const [graphId, baseGraph] of baseGraphs) {
    const localGraph = localGraphs.get(graphId);
    const remoteGraph = remoteGraphs.get(graphId);
    const mergedGraph = mergedGraphs.get(graphId);
    if (!localGraph || !remoteGraph || !mergedGraph) continue;
    const baseOutputs = executionSuccessors(baseGraph);
    const localOutputs = executionSuccessors(localGraph);
    const remoteOutputs = executionSuccessors(remoteGraph);
    const outputKeys = [
      ...baseOutputs.keys(),
      ...localOutputs.keys(),
      ...remoteOutputs.keys(),
    ].filter((key, index, all) => all.indexOf(key) === index);
    const genericCandidates: ExecutionSuccessorCandidate[] = [];
    const protectedInsertionNodeIds = new Set<string>();
    for (const outputKey of outputKeys) {
      const baseEdges = baseOutputs.get(outputKey) ?? [];
      const localEdges = localOutputs.get(outputKey) ?? [];
      const remoteEdges = remoteOutputs.get(outputKey) ?? [];
      if (
        sameEdgeSet(baseEdges, localEdges) ||
        sameEdgeSet(baseEdges, remoteEdges) ||
        sameEdgeSet(localEdges, remoteEdges)
      ) {
        continue;
      }
      const [nodeId, portId] = outputKey.split('\0');
      const path = childPath(
        childPath(childPath(childPath('story', graphId), 'nodes'), `@id:${nodeId}`),
        `execution-successor:${portId}`,
      );
      const insertion = detectConcurrentInsertion(
        baseGraph,
        localGraph,
        remoteGraph,
        baseEdges,
        localEdges,
        remoteEdges,
      );
      const successorConflict = conflict(path, true, localEdges, true, remoteEdges);
      if (insertion) {
        successorConflict.resolution = {
          kind: insertion.kind,
          localNodeId: insertion.localNodeId,
          remoteNodeId: insertion.remoteNodeId,
          localNodeIds: insertion.localNodeIds,
          remoteNodeIds: insertion.remoteNodeIds,
          localLabel: insertion.localLabel,
          remoteLabel: insertion.remoteLabel,
        };
        conflicts.push(successorConflict);
        for (const nodeId of [...insertion.localNodeIds, ...insertion.remoteNodeIds]) {
          protectedInsertionNodeIds.add(nodeId);
        }
        if (decisions[path]) {
          applyConcurrentInsertionChoice(mergedGraph, insertion, decisions[path]);
        } else {
          const competingKeys = new Set([...localEdges, ...remoteEdges].map(edgeKey));
          mergedGraph.edges = [
            ...mergedGraph.edges.filter((edge) => !competingKeys.has(edgeKey(edge))),
            ...clone(localEdges),
            ...clone(remoteEdges),
          ];
        }
        continue;
      }
      genericCandidates.push({ outputKey });
    }
    for (const region of detectExecutionRegions(
      graphId,
      baseGraph,
      localGraph,
      remoteGraph,
      genericCandidates,
      protectedInsertionNodeIds,
    )) {
      const affectedNodeIds = new Set(region.affectedNodeIds);
      const localNodeIds = new Set(region.localNodeIds);
      const remoteNodeIds = new Set(region.remoteNodeIds);
      region.localCoveredConflictIds = conflicts
        .filter((candidate) => {
          const target = conflictNodeTargetInGraph(candidate, graphId);
          if (!target || !affectedNodeIds.has(target.nodeId)) return false;
          return (
            !localNodeIds.has(target.nodeId) ||
            (target.nodeRoot && !remoteNodeIds.has(target.nodeId))
          );
        })
        .map((candidate) => candidate.id);
      region.remoteCoveredConflictIds = conflicts
        .filter((candidate) => {
          const target = conflictNodeTargetInGraph(candidate, graphId);
          if (!target || !affectedNodeIds.has(target.nodeId)) return false;
          return (
            !remoteNodeIds.has(target.nodeId) ||
            (target.nodeRoot && !localNodeIds.has(target.nodeId))
          );
        })
        .map((candidate) => candidate.id);
      const regionConflict = conflict(
        region.path,
        true,
        region.localEdges,
        true,
        region.remoteEdges,
      );
      regionConflict.resolution = {
        kind: 'execution-region',
        localNodeIds: region.localNodeIds,
        remoteNodeIds: region.remoteNodeIds,
        coreNodeIds: region.coreNodeIds,
        boundaryNodeIds: region.boundaryNodeIds,
        coreLabels: region.coreLabels,
        boundaryLabels: region.boundaryLabels,
        changedOutputCount: region.changedOutputCount,
        localImpact: region.localImpact,
        remoteImpact: region.remoteImpact,
        requiresConfirmation: region.requiresConfirmation,
        supportsPerOutput: region.supportsPerOutput,
        outputs: region.outputs,
        localCoveredConflictIds: region.localCoveredConflictIds,
        remoteCoveredConflictIds: region.remoteCoveredConflictIds,
        localLabel: region.localLabel,
        remoteLabel: region.remoteLabel,
      };
      conflicts.push(regionConflict);
      applyExecutionRegionDecisions(
        mergedGraph,
        baseGraph,
        localGraph,
        remoteGraph,
        region,
        decisions,
      );
    }
  }
}

function resolveDataInputConflicts(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  merged: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
  conflicts: StoryMergeConflict[],
): void {
  const baseGraphs = storyGraphs(base);
  const localGraphs = storyGraphs(local);
  const remoteGraphs = storyGraphs(remote);
  const mergedGraphs = storyGraphs(merged);
  for (const [graphId, mergedGraph] of mergedGraphs) {
    const baseGraph = baseGraphs.get(graphId);
    const localGraph = localGraphs.get(graphId);
    const remoteGraph = remoteGraphs.get(graphId);
    if (!baseGraph || !localGraph || !remoteGraph) continue;
    const baseInputs = dataInputSources(baseGraph);
    const localInputs = dataInputSources(localGraph);
    const remoteInputs = dataInputSources(remoteGraph);
    const inputKeys = [...baseInputs.keys(), ...localInputs.keys(), ...remoteInputs.keys()].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
    for (const inputKey of inputKeys) {
      const baseEdges = baseInputs.get(inputKey) ?? [];
      const localEdges = localInputs.get(inputKey) ?? [];
      const remoteEdges = remoteInputs.get(inputKey) ?? [];
      if (
        sameEdgeSet(baseEdges, localEdges) ||
        sameEdgeSet(baseEdges, remoteEdges) ||
        sameEdgeSet(localEdges, remoteEdges)
      ) {
        continue;
      }
      const [nodeId, portId] = inputKey.split('\0');
      const path = childPath(
        childPath(childPath(childPath('story', graphId), 'nodes'), `@id:${nodeId}`),
        `data-input:${portId}`,
      );
      const inputConflict = conflict(path, true, localEdges, true, remoteEdges);
      inputConflict.resolution = {
        kind: 'connection-competition',
        localNodeIds: localEdges.map((edge) => edge.from.nodeId),
        remoteNodeIds: remoteEdges.map((edge) => edge.from.nodeId),
        localLabel: localEdges.map((edge) => nodeLabel(localGraph, edge.from.nodeId)).join(', '),
        remoteLabel: remoteEdges.map((edge) => nodeLabel(remoteGraph, edge.from.nodeId)).join(', '),
      };
      conflicts.push(inputConflict);
      const chosen = decisions[path] === 'remote' ? remoteEdges : localEdges;
      const competingKeys = new Set([...localEdges, ...remoteEdges].map(edgeKey));
      mergedGraph.edges = [
        ...mergedGraph.edges.filter((edge) => !competingKeys.has(edgeKey(edge))),
        ...clone(chosen),
      ];
    }
  }
}

function resolveEntryNodeConflicts(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  merged: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
  conflicts: StoryMergeConflict[],
): void {
  const baseGraphs = storyGraphs(base);
  const localGraphs = storyGraphs(local);
  const remoteGraphs = storyGraphs(remote);
  const mergedGraphs = storyGraphs(merged);
  for (const [graphId, mergedGraph] of mergedGraphs) {
    const baseGraph = baseGraphs.get(graphId);
    const localGraph = localGraphs.get(graphId);
    const remoteGraph = remoteGraphs.get(graphId);
    if (!baseGraph || !localGraph || !remoteGraph) continue;
    const entries = (graph: SourceGraph) =>
      graph.nodes.filter((node) => node.type === StoryNodeType.Start);
    const baseEntries = entries(baseGraph);
    const localEntries = entries(localGraph);
    const remoteEntries = entries(remoteGraph);
    const ids = (nodes: readonly SourceGraph['nodes'][number][]) =>
      nodes.map((node) => node.id).sort();
    if (
      same(ids(baseEntries), ids(localEntries)) ||
      same(ids(baseEntries), ids(remoteEntries)) ||
      same(ids(localEntries), ids(remoteEntries))
    ) {
      continue;
    }
    const path = childPath(childPath('story', graphId), 'entry-node');
    const entryConflict = conflict(path, true, localEntries, true, remoteEntries);
    entryConflict.resolution = {
      kind: 'entry-nodes',
      localNodeIds: localEntries.map((node) => node.id),
      remoteNodeIds: remoteEntries.map((node) => node.id),
    };
    conflicts.push(entryConflict);
    const chosenEntries = decisions[path] === 'remote' ? remoteEntries : localEntries;
    const chosenIds = new Set(chosenEntries.map((node) => node.id));
    const competingIds = new Set([...localEntries, ...remoteEntries].map((node) => node.id));
    const removedIds = new Set([...competingIds].filter((nodeId) => !chosenIds.has(nodeId)));
    mergedGraph.nodes = [
      ...mergedGraph.nodes.filter((node) => !competingIds.has(node.id)),
      ...clone(chosenEntries),
    ];
    mergedGraph.edges = mergedGraph.edges.filter(
      (edge) => !removedIds.has(edge.from.nodeId) && !removedIds.has(edge.to.nodeId),
    );
  }
}

function threeWayStoryResult(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
) {
  const result = threeWayResult(base, local, remote, decisions, 'story');
  const merged = result.merged as MergeableStoryDocument;
  resolveExecutionSuccessorConflicts(base, local, remote, merged, decisions, result.conflicts);
  resolveDataInputConflicts(base, local, remote, merged, decisions, result.conflicts);
  resolveEntryNodeConflicts(base, local, remote, merged, decisions, result.conflicts);
  return { ...result, merged };
}

function threeWayOptionalResult<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  decisions: StoryMergeDecisions,
  rootPath: string,
) {
  const conflicts: StoryMergeConflict[] = [];
  const autoPaths = new Set<string>();
  const merged = mergeThreeValue(
    base !== undefined,
    base,
    local !== undefined,
    local,
    remote !== undefined,
    remote,
    rootPath,
    decisions,
    conflicts,
    autoPaths,
  );
  return {
    conflicts,
    merged: merged === missing ? undefined : (merged as T),
    autoChangeCount: autoPaths.size,
  };
}

export function diffThreeWayStoryDocuments(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
): ThreeWayStoryDiff {
  const result = threeWayStoryResult(base, local, remote, {});
  return {
    conflicts: result.conflicts,
    autoMerged: result.merged as MergeableStoryDocument,
    autoChangeCount: result.autoChangeCount,
  };
}

export function mergeThreeWayStoryDocuments(
  base: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
): MergeableStoryDocument {
  return threeWayStoryResult(base, local, remote, decisions).merged;
}

export function diffThreeWayValues<T>(
  base: T,
  local: T,
  remote: T,
  rootPath = 'resource',
): ThreeWayValueDiff<T> {
  const result = threeWayResult(base, local, remote, {}, rootPath);
  return {
    conflicts: result.conflicts,
    autoMerged: result.merged as T,
    autoChangeCount: result.autoChangeCount,
  };
}

export function mergeThreeWayValues<T>(
  base: T,
  local: T,
  remote: T,
  decisions: StoryMergeDecisions,
  rootPath = 'resource',
): T {
  return threeWayResult(base, local, remote, decisions, rootPath).merged as T;
}

export function diffThreeWayOptionalValues<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  rootPath = 'resource',
): ThreeWayValueDiff<T | undefined> {
  const result = threeWayOptionalResult(base, local, remote, {}, rootPath);
  return {
    conflicts: result.conflicts,
    autoMerged: result.merged,
    autoChangeCount: result.autoChangeCount,
  };
}

export function mergeThreeWayOptionalValues<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  decisions: StoryMergeDecisions,
  rootPath = 'resource',
): T | undefined {
  return threeWayOptionalResult(base, local, remote, decisions, rootPath).merged;
}

function mergeValue(
  localPresent: boolean,
  localValue: unknown,
  remotePresent: boolean,
  remoteValue: unknown,
  path: string,
  decisions: StoryMergeDecisions,
): unknown | typeof missing {
  if (localPresent && remotePresent && same(localValue, remoteValue)) return clone(localValue);
  if (!localPresent || !remotePresent) {
    const useRemote = decisions[path] === 'remote';
    if (useRemote) return remotePresent ? clone(remoteValue) : missing;
    return localPresent ? clone(localValue) : missing;
  }
  if (isPositionPath(path) && isRecord(localValue) && isRecord(remoteValue)) {
    return clone(decisions[path] === 'remote' ? remoteValue : localValue);
  }
  if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
    const localItems = keyedArray(localValue);
    const remoteItems = keyedArray(remoteValue);
    if (!localItems || !remoteItems) {
      return decisions[path] === 'remote' ? clone(remoteValue) : clone(localValue);
    }
    const keys = [...localItems.keys(), ...remoteItems.keys()].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
    const mergedItems = new Map<string, unknown>();
    for (const key of keys) {
      const value = mergeValue(
        localItems.has(key),
        localItems.get(key),
        remoteItems.has(key),
        remoteItems.get(key),
        childPath(path, `@${key}`),
        decisions,
      );
      if (value !== missing) mergedItems.set(key, value);
    }
    const orderPath = childPath(path, '@order');
    const useRemoteOrder = orderMatters(path) && decisions[orderPath] === 'remote';
    const primary = useRemoteOrder ? [...remoteItems.keys()] : [...localItems.keys()];
    const secondary = useRemoteOrder ? [...localItems.keys()] : [...remoteItems.keys()];
    return mergedKeyOrder(primary, secondary, new Set(mergedItems.keys())).map((key) =>
      mergedItems.get(key)!,
    );
  }
  if (isRecord(localValue) && isRecord(remoteValue)) {
    const result: Record<string, unknown> = {};
    const keys = [...Object.keys(localValue), ...Object.keys(remoteValue)].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
    for (const key of keys) {
      const value = mergeValue(
        Object.hasOwn(localValue, key),
        localValue[key],
        Object.hasOwn(remoteValue, key),
        remoteValue[key],
        childPath(path, key),
        decisions,
      );
      if (value !== missing) result[key] = value;
    }
    return result;
  }
  return decisions[path] === 'remote' ? clone(remoteValue) : clone(localValue);
}

export function mergeStoryDocuments(
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  decisions: StoryMergeDecisions,
): MergeableStoryDocument {
  return mergeValue(true, local, true, remote, 'story', decisions) as MergeableStoryDocument;
}

export function applyMergedStory(
  local: StorySourceDocument,
  merged: MergeableStoryDocument,
): StorySourceDocument {
  return { ...local, ...clone(merged) };
}

export type CoordinateLayoutOrder = 'local-first' | 'remote-first';

export function autoLayoutStoryConflictNeighborhoods(
  story: MergeableStoryDocument,
  local: MergeableStoryDocument,
  remote: MergeableStoryDocument,
  nodeIds: ReadonlySet<string>,
  order: CoordinateLayoutOrder,
): MergeableStoryDocument {
  const result = clone(story);
  const layoutGraph = (
    graph: SourceGraph,
    localGraph: SourceGraph | undefined,
    remoteGraph: SourceGraph | undefined,
  ): SourceGraph => {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
    const conflictIds = new Set(
      graph.nodes
        .filter((node) => nodeIds.has(node.id) && node.type !== StoryNodeType.Reroute)
        .map((node) => node.id),
    );
    if (conflictIds.size === 0) return graph;
    const affected = new Set(conflictIds);
    for (const edge of graph.edges) {
      if (conflictIds.has(edge.from.nodeId)) {
        const neighbor = nodesById.get(edge.to.nodeId);
        if (neighbor?.type !== StoryNodeType.Reroute) affected.add(edge.to.nodeId);
      }
      if (conflictIds.has(edge.to.nodeId)) {
        const neighbor = nodesById.get(edge.from.nodeId);
        if (neighbor?.type !== StoryNodeType.Reroute) affected.add(edge.from.nodeId);
      }
    }
    const preferred = order === 'local-first' ? localGraph : remoteGraph;
    const fallback = order === 'local-first' ? remoteGraph : localGraph;
    const preferredPositions = new Map(
      preferred?.nodes.map((node) => [node.id, node.position] as const) ?? [],
    );
    const fallbackPositions = new Map(
      fallback?.nodes.map((node) => [node.id, node.position] as const) ?? [],
    );
    const editorGraph = fromSourceGraph(graph, { allowInvalidConnections: true });
    const seeded = {
      ...editorGraph,
      nodes: editorGraph.nodes.map((node) => ({
        ...node,
        position: affected.has(node.id)
          ? {
              ...(preferredPositions.get(node.id) ??
                fallbackPositions.get(node.id) ??
                node.position),
            }
          : node.position,
      })),
      edges: editorGraph.edges.filter(
        (edge) =>
          nodesById.get(edge.source)?.type !== StoryNodeType.Reroute &&
          nodesById.get(edge.target)?.type !== StoryNodeType.Reroute,
      ),
    };
    const arranged = avoidOverlappingNodes(autoLayoutGraph(seeded, [...affected]), affected);
    const positions = new Map(arranged.nodes.map((node) => [node.id, node.position] as const));
    return {
      ...graph,
      nodes: graph.nodes.map((node) =>
        affected.has(node.id) ? { ...node, position: { ...positions.get(node.id)! } } : node,
      ),
    };
  };
  const localChapters = new Map(
    local.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  );
  const remoteChapters = new Map(
    remote.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  );
  result.root = layoutGraph(result.root, local.root, remote.root);
  result.chapters = result.chapters.map((chapter) => ({
    ...chapter,
    graph: layoutGraph(
      chapter.graph,
      localChapters.get(chapter.id),
      remoteChapters.get(chapter.id),
    ),
  }));
  return result;
}

export function autoLayoutStoryAddedNodeOverlaps(
  local: MergeableStoryDocument,
  merged: MergeableStoryDocument,
): MergeableStoryDocument {
  const result = clone(merged);
  const layoutGraph = (localGraph: SourceGraph | undefined, graph: SourceGraph): SourceGraph => {
    const editorGraph = fromSourceGraph(graph, { allowInvalidConnections: true });
    const layout = arrangeOverlappingAddedNodes(
      fromSourceGraph(localGraph ?? { nodes: [], edges: [] }, { allowInvalidConnections: true }),
      editorGraph,
    );
    const positions = new Map(layout.nodes.map((node) => [node.id, node.position] as const));
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        position: { ...positions.get(node.id)! },
      })),
    };
  };
  const localChapters = new Map(local.chapters.map((chapter) => [chapter.id, chapter] as const));
  result.root = layoutGraph(local.root, result.root);
  result.chapters = result.chapters.map((chapter) => ({
    ...chapter,
    graph: layoutGraph(localChapters.get(chapter.id)?.graph, chapter.graph),
  }));
  return result;
}
