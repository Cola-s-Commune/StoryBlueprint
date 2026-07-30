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

export type StoryMergeChoice = 'local' | 'remote';

export interface StoryMergeConflict {
  id: string;
  path: string;
  kind: 'changed' | 'local-only' | 'remote-only';
  localValue?: unknown;
  remoteValue?: unknown;
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

export type MergeableStoryDocument = Pick<
  StorySourceDocument,
  'id' | 'variables' | 'root' | 'chapters'
>;

const missing = Symbol('missing');

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
      let primary = localOrder;
      let secondary = remoteOrder;
      if (remoteReordered && !localReordered) {
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
      return mergedKeyOrder(primary, secondary, new Set(mergedItems.keys())).map((key) =>
        mergedItems.get(key)!,
      );
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
        port.id === edge.from.portId &&
        port.kind === 'execution' &&
        port.direction === 'output',
    );
    if (!executionOutput) continue;
    const key = `${edge.from.nodeId}\0${edge.from.portId}`;
    result.set(key, [...(result.get(key) ?? []), edge]);
  }
  return result;
}

function sameEdgeSet(left: readonly SourceEdge[], right: readonly SourceEdge[]): boolean {
  const leftKeys = left.map(edgeKey).sort();
  const rightKeys = right.map(edgeKey).sort();
  return same(leftKeys, rightKeys);
}

function storyGraphs(story: MergeableStoryDocument): Map<string, SourceGraph> {
  return new Map([
    ['root', story.root] as const,
    ...story.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  ]);
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
    const outputKeys = [...baseOutputs.keys(), ...localOutputs.keys(), ...remoteOutputs.keys()].filter(
      (key, index, all) => all.indexOf(key) === index,
    );
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
      conflicts.push(conflict(path, true, localEdges, true, remoteEdges));
      const chosen = decisions[path] === 'remote' ? remoteEdges : localEdges;
      const competingKeys = new Set([...localEdges, ...remoteEdges].map(edgeKey));
      mergedGraph.edges = [
        ...mergedGraph.edges.filter((edge) => !competingKeys.has(edgeKey(edge))),
        ...clone(chosen),
      ];
    }
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
  resolveExecutionSuccessorConflicts(
    base,
    local,
    remote,
    merged,
    decisions,
    result.conflicts,
  );
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
          ? { ...(preferredPositions.get(node.id) ?? fallbackPositions.get(node.id) ?? node.position) }
          : node.position,
      })),
      edges: editorGraph.edges.filter(
        (edge) =>
          nodesById.get(edge.source)?.type !== StoryNodeType.Reroute &&
          nodesById.get(edge.target)?.type !== StoryNodeType.Reroute,
      ),
    };
    const arranged = avoidOverlappingNodes(
      autoLayoutGraph(seeded, [...affected]),
      affected,
    );
    const positions = new Map(arranged.nodes.map((node) => [node.id, node.position] as const));
    return {
      ...graph,
      nodes: graph.nodes.map((node) =>
        affected.has(node.id) ? { ...node, position: { ...positions.get(node.id)! } } : node,
      ),
    };
  };
  const localChapters = new Map(local.chapters.map((chapter) => [chapter.id, chapter.graph] as const));
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
