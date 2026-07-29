import type { StorySourceDocument } from '@story-blueprint/common';

export type StoryMergeChoice = 'local' | 'remote';

export interface StoryMergeConflict {
  id: string;
  path: string;
  kind: 'changed' | 'local-only' | 'remote-only';
  localValue?: unknown;
  remoteValue?: unknown;
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
  if (!isRecord(value)) return undefined;
  if (typeof value.id === 'string') return `id:${value.id}`;
  const from = value.from;
  const to = value.to;
  if (isRecord(from) && isRecord(to)) {
    return `edge:${String(from.nodeId)}:${String(from.portId)}>${String(to.nodeId)}:${String(to.portId)}`;
  }
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
  return field === 'lines' || field === 'options' || field === 'chapters' || field === 'variables';
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
