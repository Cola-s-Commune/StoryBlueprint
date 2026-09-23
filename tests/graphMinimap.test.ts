import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoryNodeType } from '@story-blueprint/common';
import {
  GRAPH_MINIMAP_STORAGE_KEY,
  getInitialMinimapVisible,
  getMinimapNodeColor,
  getMinimapNodeStrokeColor,
  getNodeDiffKind,
} from '../packages/editor/src/renderer/components/Panels/graphMinimap';

describe('graphMinimap', () => {
  describe('getMinimapNodeColor', () => {
    it('returns dedicated accent colors for execution and dialogue node types', () => {
      expect(getMinimapNodeColor(StoryNodeType.Start)).toBe('#62c878');
      expect(getMinimapNodeColor(StoryNodeType.End)).toBe('#ee6666');
      expect(getMinimapNodeColor(StoryNodeType.EndStoryInstance)).toBe('#ee6666');
      expect(getMinimapNodeColor(StoryNodeType.Dialogue)).toBe('#42a5f5');
      expect(getMinimapNodeColor(StoryNodeType.Choice)).toBe('#ffa840');
      expect(getMinimapNodeColor(StoryNodeType.Branch)).toBe('#b36bd4');
      expect(getMinimapNodeColor(StoryNodeType.Narration)).toBe('#97a9cf');
    });

    it('returns dedicated accent colors for ink, substory, variables, events, and flow jumps', () => {
      expect(getMinimapNodeColor(StoryNodeType.InkBlock)).toBe('#9c89eb');
      expect(getMinimapNodeColor(StoryNodeType.CallSubstory)).toBe('#6d96df');
      expect(getMinimapNodeColor(StoryNodeType.Return)).toBe('#6d96df');
      expect(getMinimapNodeColor('substory')).toBe('#6d96df');
      expect(getMinimapNodeColor(StoryNodeType.GetVariable)).toBe('#36b5a3');
      expect(getMinimapNodeColor(StoryNodeType.SetVariable)).toBe('#36b5a3');
      expect(getMinimapNodeColor(StoryNodeType.CallEvent)).toBe('#d979b5');
      expect(getMinimapNodeColor(StoryNodeType.WaitSignal)).toBe('#8c6ed8');
      expect(getMinimapNodeColor(StoryNodeType.FlowAnchor)).toBe('#38a6a5');
      expect(getMinimapNodeColor(StoryNodeType.FlowJump)).toBe('#38a6a5');
      expect(getMinimapNodeColor(StoryNodeType.Reroute)).toBe('#38a6a5');
      expect(getMinimapNodeColor(StoryNodeType.StartStory)).toBe('#3f9a80');
      expect(getMinimapNodeColor(StoryNodeType.SwitchStory)).toBe('#3f9a80');
      expect(getMinimapNodeColor(StoryNodeType.ResumeStory)).toBe('#3f9a80');
    });

    it('falls back to default neutral slate color for unknown or omitted types', () => {
      expect(getMinimapNodeColor(undefined)).toBe('#6d7b91');
      expect(getMinimapNodeColor('custom-unregistered-node')).toBe('#6d7b91');
    });

    it('prioritizes diff colors when diffKind is present', () => {
      expect(getMinimapNodeColor(StoryNodeType.Dialogue, 'added')).toBe('#52cf7a');
      expect(getMinimapNodeColor(StoryNodeType.Choice, 'modified')).toBe('#e0b34f');
      expect(getMinimapNodeColor(StoryNodeType.Branch, 'removed')).toBe('#db6262');
      expect(getMinimapNodeColor(StoryNodeType.Dialogue, 'conflict')).toBe('#ff7657');
      expect(getMinimapNodeColor(StoryNodeType.Dialogue, 'conflict-boundary')).toBe('#dca15d');
      expect(getMinimapNodeColor(StoryNodeType.Dialogue, 'resolved')).toBe('#5da9e9');
    });
  });

  describe('getMinimapNodeStrokeColor', () => {
    it('returns white stroke for selected nodes regardless of diff', () => {
      expect(getMinimapNodeStrokeColor({ selected: true })).toBe('#ffffff');
      expect(getMinimapNodeStrokeColor({ selected: true }, 'conflict')).toBe('#ffffff');
      expect(getMinimapNodeStrokeColor({ selected: true }, 'added')).toBe('#ffffff');
    });

    it('returns diff-specific stroke for unselected diff nodes', () => {
      expect(getMinimapNodeStrokeColor({ selected: false }, 'conflict')).toBe('#ff7657');
      expect(getMinimapNodeStrokeColor({ selected: false }, 'added')).toBe('#52cf7a');
      expect(getMinimapNodeStrokeColor({ selected: false }, 'modified')).toBe('#e0b34f');
      expect(getMinimapNodeStrokeColor({ selected: false }, 'removed')).toBe('#db6262');
      expect(getMinimapNodeStrokeColor({ selected: false }, 'resolved')).toBe('#5da9e9');
    });

    it('returns subtle semi-transparent stroke for unselected or undefined nodes without diff', () => {
      expect(getMinimapNodeStrokeColor({ selected: false })).toBe('rgba(255, 255, 255, 0.22)');
      expect(getMinimapNodeStrokeColor({})).toBe('rgba(255, 255, 255, 0.22)');
    });
  });

  describe('getNodeDiffKind', () => {
    it('resolves correct diff kinds from merge preview targets', () => {
      const preview = {
        conflictNodeIds: ['n_conf', 'n_bound'],
        boundaryNodeIds: ['n_bound'],
        addedNodeIds: ['n_add'],
        changedNodeIds: ['n_mod'],
        removedNodeIds: ['n_del'],
        resolvedNodeIds: ['n_res'],
      };

      expect(getNodeDiffKind('n_bound', preview)).toBe('conflict-boundary');
      expect(getNodeDiffKind('n_conf', preview)).toBe('conflict');
      expect(getNodeDiffKind('n_add', preview)).toBe('added');
      expect(getNodeDiffKind('n_mod', preview)).toBe('modified');
      expect(getNodeDiffKind('n_del', preview)).toBe('removed');
      expect(getNodeDiffKind('n_res', preview)).toBe('resolved');
      expect(getNodeDiffKind('n_other', preview)).toBeUndefined();
    });

    it('resolves correct diff kinds from AI proposals when no merge preview is active', () => {
      const aiState = {
        addedNodeIds: ['n_ai_add'],
        changedNodeIds: ['n_ai_mod'],
      };

      expect(getNodeDiffKind('n_ai_add', null, aiState)).toBe('added');
      expect(getNodeDiffKind('n_ai_mod', null, aiState)).toBe('modified');
      expect(getNodeDiffKind('n_other', null, aiState)).toBeUndefined();
    });
  });

  describe('getInitialMinimapVisible and storage key', () => {
    beforeEach(() => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    });

    afterEach(() => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    });

    it('has the expected localStorage key', () => {
      expect(GRAPH_MINIMAP_STORAGE_KEY).toBe('story-blueprint.graph-minimap-visible');
    });

    it('defaults to true when localStorage has no entry', () => {
      expect(getInitialMinimapVisible()).toBe(true);
    });

    it('returns false when localStorage specifies "false"', () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(GRAPH_MINIMAP_STORAGE_KEY, 'false');
        expect(getInitialMinimapVisible()).toBe(false);
      }
    });

    it('returns true when localStorage specifies "true"', () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(GRAPH_MINIMAP_STORAGE_KEY, 'true');
        expect(getInitialMinimapVisible()).toBe(true);
      }
    });
  });
});
