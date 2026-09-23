import { StoryNodeType } from '@story-blueprint/common';

export const GRAPH_MINIMAP_STORAGE_KEY = 'story-blueprint.graph-minimap-visible';

export type MinimapDiffKind =
  | 'added'
  | 'modified'
  | 'removed'
  | 'conflict'
  | 'conflict-boundary'
  | 'resolved';

/**
 * Returns the accent color for a node inside the Minimap.
 * If a diffKind is specified (e.g. during merge preview, git diff, or AI proposal),
 * the diff status color takes precedence.
 */
export function getMinimapNodeColor(type?: string, diffKind?: MinimapDiffKind): string {
  if (diffKind) {
    switch (diffKind) {
      case 'conflict':
        return '#ff7657';
      case 'conflict-boundary':
        return '#dca15d';
      case 'added':
        return '#52cf7a';
      case 'modified':
        return '#e0b34f';
      case 'removed':
        return '#db6262';
      case 'resolved':
        return '#5da9e9';
    }
  }

  switch (type) {
    case StoryNodeType.Start:
      return '#62c878';
    case StoryNodeType.End:
    case StoryNodeType.EndStoryInstance:
      return '#ee6666';
    case StoryNodeType.Dialogue:
      return '#42a5f5';
    case StoryNodeType.Choice:
      return '#ffa840';
    case StoryNodeType.Branch:
      return '#b36bd4';
    case StoryNodeType.Narration:
      return '#97a9cf';
    case StoryNodeType.InkBlock:
      return '#9c89eb';
    case StoryNodeType.CallSubstory:
    case StoryNodeType.Return:
    case 'substory':
      return '#6d96df';
    case StoryNodeType.GetVariable:
    case StoryNodeType.SetVariable:
      return '#36b5a3';
    case StoryNodeType.CallEvent:
      return '#d979b5';
    case StoryNodeType.WaitSignal:
      return '#8c6ed8';
    case StoryNodeType.FlowAnchor:
    case StoryNodeType.FlowJump:
    case StoryNodeType.Reroute:
      return '#38a6a5';
    case StoryNodeType.StartStory:
    case StoryNodeType.SwitchStory:
    case StoryNodeType.ResumeStory:
      return '#3f9a80';
    case StoryNodeType.Comment:
      return '#3b4859';
    default:
      return '#6d7b91';
  }
}

/**
 * Returns the stroke color for a node inside the Minimap.
 * Selected nodes are highlighted in bright white; diff nodes receive strong contrast strokes.
 */
export function getMinimapNodeStrokeColor(
  node: { selected?: boolean },
  diffKind?: MinimapDiffKind,
): string {
  if (node.selected) {
    return '#ffffff';
  }
  if (diffKind) {
    switch (diffKind) {
      case 'conflict':
        return '#ff7657';
      case 'conflict-boundary':
        return '#dca15d';
      case 'added':
        return '#52cf7a';
      case 'modified':
        return '#e0b34f';
      case 'removed':
        return '#db6262';
      case 'resolved':
        return '#5da9e9';
    }
  }
  return 'rgba(255, 255, 255, 0.22)';
}

/**
 * Resolves the MinimapDiffKind for a given node based on active merge preview or AI state.
 */
export function getNodeDiffKind(
  nodeId: string,
  mergePreview?: {
    conflictNodeIds?: readonly string[];
    boundaryNodeIds?: readonly string[];
    addedNodeIds?: readonly string[];
    changedNodeIds?: readonly string[];
    removedNodeIds?: readonly string[];
    resolvedNodeIds?: readonly string[];
  } | null,
  aiState?: {
    addedNodeIds?: readonly string[];
    changedNodeIds?: readonly string[];
  } | null,
): MinimapDiffKind | undefined {
  if (mergePreview) {
    if (mergePreview.conflictNodeIds?.includes(nodeId)) {
      return mergePreview.boundaryNodeIds?.includes(nodeId)
        ? 'conflict-boundary'
        : 'conflict';
    }
    if (mergePreview.removedNodeIds?.includes(nodeId)) return 'removed';
    if (mergePreview.resolvedNodeIds?.includes(nodeId)) return 'resolved';
    if (mergePreview.addedNodeIds?.includes(nodeId)) return 'added';
    if (mergePreview.changedNodeIds?.includes(nodeId)) return 'modified';
  }
  if (aiState) {
    if (aiState.addedNodeIds?.includes(nodeId)) return 'added';
    if (aiState.changedNodeIds?.includes(nodeId)) return 'modified';
  }
  return undefined;
}

/**
 * Reads the initial Minimap visibility state from local storage.
 * Defaults to true.
 */
export function getInitialMinimapVisible(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true;
  }
  const saved = window.localStorage.getItem(GRAPH_MINIMAP_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}
