import {
  StoryNodeType,
  type ChoiceNodeData,
  type DialogueNodeData,
  type InkBlockNodeData,
  type NarrationNodeData,
  type NodeId,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import type { ActiveGraphId, StoryDataSelection } from './StoryGraphStore';

export interface StorySearchEntry {
  id: string;
  kind: 'node' | 'resource';
  title: string;
  detail: string;
  category: string;
  searchText: string;
  graphId?: ActiveGraphId;
  nodeId?: NodeId;
  selection?: StoryDataSelection;
}

function compact(value: string, length = 80): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function searchable(...values: unknown[]): string {
  return values
    .flatMap((value) => (typeof value === 'string' ? [value] : [JSON.stringify(value)]))
    .join(' ')
    .toLocaleLowerCase();
}

/** Builds a node-position-free index for every graph and Story resource. */
export function buildStorySearchIndex(snapshot: StorySemanticSnapshot): StorySearchEntry[] {
  const entries: StorySearchEntry[] = [];
  const resourceNames = new Map<string, string>();
  for (const resource of [
    ...snapshot.variables,
    ...snapshot.characters,
    ...snapshot.assets,
    ...snapshot.events,
    ...snapshot.signals,
  ]) {
    resourceNames.set(resource.id, resource.displayName);
  }

  for (const graph of snapshot.graphs) {
    const graphId = (graph.kind === 'root' ? 'root' : graph.chapterId!) as ActiveGraphId;
    for (const node of graph.nodes) {
      const relatedNames = [...resourceNames.entries()]
        .filter(([id]) => JSON.stringify(node.data).includes(id))
        .map(([, name]) => name);
      const baseSearch = searchable(
        node.id,
        node.name,
        node.type,
        graph.name,
        graph.displayName,
        relatedNames,
      );
      const addNodeEntry = (suffix: string, title: string, detail: string, extra?: unknown) => {
        entries.push({
          id: `${graphId}:${node.id}:${suffix}`,
          kind: 'node',
          graphId,
          nodeId: node.id as NodeId,
          title: compact(title) || node.name || node.type,
          detail: `${graph.displayName} · ${detail}`,
          category: node.type,
          searchText: searchable(baseSearch, title, detail, extra),
        });
      };

      if (node.type === StoryNodeType.Dialogue) {
        const dialogue = node.data as DialogueNodeData;
        dialogue.lines.forEach((line, index) => {
          const speaker = line.speakerId
            ? (resourceNames.get(line.speakerId) ?? line.speakerId)
            : 'Narrator';
          addNodeEntry(
            line.id,
            `${speaker}: ${line.text.source || 'Empty dialogue line'}`,
            `Dialogue · Line ${index + 1}`,
            line,
          );
        });
      } else if (node.type === StoryNodeType.Narration) {
        const narration = node.data as NarrationNodeData;
        addNodeEntry(
          'text',
          narration.text.source || 'Empty narration',
          'Narration · Text',
          narration,
        );
      } else if (node.type === StoryNodeType.InkBlock) {
        const ink = node.data as InkBlockNodeData;
        addNodeEntry(
          'source',
          ink.entryKnot || 'Ink Block',
          ink.sourceMode === 'embedded' ? 'Ink Block · Embedded source' : 'Ink Block · Linked file',
          ink.sourceMode === 'embedded' ? ink.source : ink.path,
        );
      } else if (node.type === StoryNodeType.Choice) {
        const choice = node.data as ChoiceNodeData;
        addNodeEntry('prompt', choice.prompt.source || 'Choice', 'Choice · Prompt', choice.prompt);
        choice.options.forEach((option, index) =>
          addNodeEntry(
            option.id,
            option.text.source || `Option ${index + 1}`,
            `Choice · Option ${index + 1}`,
            option,
          ),
        );
      } else {
        addNodeEntry('node', node.name || node.type, node.type, node.data);
      }
    }
  }

  const addResource = (
    kind: StoryDataSelection['kind'],
    id: string,
    title: string,
    detail: string,
    value: unknown,
  ) => {
    if (kind === 'event-table') return;
    entries.push({
      id: `resource:${kind}:${id}`,
      kind: 'resource',
      title,
      detail,
      category: kind,
      selection: { kind, id } as StoryDataSelection,
      searchText: searchable(id, title, detail, value),
    });
  };
  snapshot.variables.forEach((item) =>
    addResource('variable', item.id, item.displayName, `Variable · ${item.name}`, item),
  );
  snapshot.characters.forEach((item) =>
    addResource('character', item.id, item.displayName, `Character · ${item.name}`, item),
  );
  snapshot.assets.forEach((item) =>
    addResource('asset', item.id, item.displayName, `Asset · ${item.kind}`, item),
  );
  snapshot.events.forEach((item) =>
    addResource('event', item.id, item.displayName, `Event · ${item.name}`, item),
  );
  snapshot.signals.forEach((item) =>
    addResource('signal', item.id, item.displayName, `Signal · ${item.name}`, item),
  );
  return entries;
}

export function searchStoryIndex(
  index: readonly StorySearchEntry[],
  query: string,
  limit = 100,
): StorySearchEntry[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return index
    .filter((entry) => tokens.every((token) => entry.searchText.includes(token)))
    .sort((left, right) => {
      const normalized = query.toLocaleLowerCase().trim();
      const leftTitle = left.title.toLocaleLowerCase();
      const rightTitle = right.title.toLocaleLowerCase();
      const leftScore = leftTitle === normalized ? 0 : leftTitle.startsWith(normalized) ? 1 : 2;
      const rightScore = rightTitle === normalized ? 0 : rightTitle.startsWith(normalized) ? 1 : 2;
      return leftScore - rightScore || left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}
