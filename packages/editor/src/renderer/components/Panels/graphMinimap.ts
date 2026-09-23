import { StoryNodeType } from '@story-blueprint/common';

export const GRAPH_MINIMAP_STORAGE_KEY = 'story-blueprint.graph-minimap-visible';

/**
 * Returns the accent color for a node inside the Minimap based on its StoryNodeType.
 */
export function getMinimapNodeColor(type?: string): string {
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
    default:
      return '#6d7b91';
  }
}

/**
 * Returns the stroke color for a node inside the Minimap.
 * Selected nodes are highlighted in bright white, while unselected nodes use a subtle border.
 */
export function getMinimapNodeStrokeColor(node: { selected?: boolean }): string {
  if (node.selected) {
    return '#ffffff';
  }
  return 'rgba(255, 255, 255, 0.22)';
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
