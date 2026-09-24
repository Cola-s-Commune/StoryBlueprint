import { describe, expect, it } from 'vitest';
import { StoryNodeType } from '@story-blueprint/common';
import {
  calculateNodeSnap,
  getNodeBounds,
  type SnapLine,
} from '../packages/editor/src/renderer/graph/storyGraphSnap';
import type { EditorGraphNode } from '../packages/editor/src/renderer/graph/editorGraph';

function createMockNode(
  id: string,
  x: number,
  y: number,
  width?: number,
  height?: number,
  type: StoryNodeType = StoryNodeType.Dialogue,
  data: any = {},
): EditorGraphNode {
  return {
    id: id as any,
    type,
    position: { x, y },
    width,
    height,
    measured: width && height ? { width, height } : undefined,
    data,
    definitionVersion: 1,
  };
}

describe('storyGraphSnap - Smart Alignment Guides & Snapping', () => {
  describe('getNodeBounds', () => {
    it('uses measured width and height when available', () => {
      const node = createMockNode('n1', 100, 200, 300, 150);
      const bounds = getNodeBounds(node);
      expect(bounds.x).toBe(100);
      expect(bounds.y).toBe(200);
      expect(bounds.width).toBe(300);
      expect(bounds.height).toBe(150);
      expect(bounds.centerX).toBe(250);
      expect(bounds.centerY).toBe(275);
      expect(bounds.right).toBe(400);
      expect(bounds.bottom).toBe(350);
    });

    it('falls back to default dimensions for standard nodes', () => {
      const node = createMockNode('n2', 50, 50);
      const bounds = getNodeBounds(node);
      expect(bounds.width).toBe(260);
      expect(bounds.height).toBe(140);
      expect(bounds.centerX).toBe(180);
      expect(bounds.centerY).toBe(120);
    });

    it('uses Comment node dimensions from data when available', () => {
      const commentNode = createMockNode(
        'c1',
        0,
        0,
        undefined,
        undefined,
        StoryNodeType.Comment,
        { width: 500, height: 350 },
      );
      const bounds = getNodeBounds(commentNode);
      expect(bounds.width).toBe(500);
      expect(bounds.height).toBe(350);
    });

    it('applies overridePosition correctly', () => {
      const node = createMockNode('n3', 100, 100, 200, 100);
      const bounds = getNodeBounds(node, { x: 500, y: 600 });
      expect(bounds.x).toBe(500);
      expect(bounds.y).toBe(600);
      expect(bounds.centerX).toBe(600);
      expect(bounds.centerY).toBe(650);
    });
  });

  describe('calculateNodeSnap', () => {
    it('returns 0 delta and empty lines when disabled or no other nodes', () => {
      const nodeA = createMockNode('nA', 100, 100, 200, 100);
      const resDisabled = calculateNodeSnap({
        draggedNodes: [{ node: nodeA, newPosition: { x: 105, y: 105 } }],
        allNodes: [nodeA],
        disabled: true,
      });
      expect(resDisabled.deltaX).toBe(0);
      expect(resDisabled.deltaY).toBe(0);
      expect(resDisabled.lines).toEqual([]);

      const resSingle = calculateNodeSnap({
        draggedNodes: [{ node: nodeA, newPosition: { x: 105, y: 105 } }],
        allNodes: [nodeA],
      });
      expect(resSingle.deltaX).toBe(0);
      expect(resSingle.deltaY).toBe(0);
      expect(resSingle.lines).toEqual([]);
    });

    it('snaps Left-to-Left on X axis (producing vertical guide line)', () => {
      const target = createMockNode('target', 200, 100, 200, 100);
      const dragged = createMockNode('dragged', 0, 300, 200, 100);

      // Drag dragged to x=204 (4px away from target.x=200, <= 8px threshold)
      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 204, y: 300 } }],
        allNodes: [target, dragged],
        snapThreshold: 8,
      });

      expect(res.deltaX).toBe(-4);
      expect(res.deltaY).toBe(0);
      expect(res.lines.length).toBe(1);
      const line = res.lines[0];
      expect(line.orientation).toBe('vertical');
      expect(line.coordinate).toBe(200);
      expect(line.alignment).toBe('start');
      expect(line.targetNodeIds).toContain('target');
    });

    it('snaps Center-to-Center on X axis', () => {
      // target center = 100 + 200/2 = 200
      const target = createMockNode('target', 100, 50, 200, 100);
      // dragged width = 100, dragged center = x + 50. If x=148, center=198 (2px away from 200)
      const dragged = createMockNode('dragged', 0, 300, 100, 100);

      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 148, y: 300 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaX).toBe(2);
      expect(res.lines.length).toBe(1);
      expect(res.lines[0].orientation).toBe('vertical');
      expect(res.lines[0].coordinate).toBe(200);
      expect(res.lines[0].alignment).toBe('center');
    });

    it('snaps Right-to-Right on X axis', () => {
      // target right = 100 + 200 = 300
      const target = createMockNode('target', 100, 50, 200, 100);
      // dragged width = 150. If x=155, right=305 (5px away from 300)
      const dragged = createMockNode('dragged', 0, 300, 150, 100);

      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 155, y: 300 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaX).toBe(-5);
      expect(res.lines[0].coordinate).toBe(300);
      expect(res.lines[0].alignment).toBe('end');
    });

    it('snaps Top-to-Top on Y axis (producing horizontal guide line)', () => {
      const target = createMockNode('target', 100, 150, 200, 100);
      const dragged = createMockNode('dragged', 400, 0, 200, 100);

      // Drag dragged to y=153 (3px away from target.y=150)
      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 400, y: 153 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaY).toBe(-3);
      expect(res.deltaX).toBe(0);
      expect(res.lines.length).toBe(1);
      const line = res.lines[0];
      expect(line.orientation).toBe('horizontal');
      expect(line.coordinate).toBe(150);
      expect(line.alignment).toBe('start');
    });

    it('snaps Center-to-Center on Y axis', () => {
      // target centerY = 100 + 100/2 = 150
      const target = createMockNode('target', 100, 100, 200, 100);
      // dragged height = 120. If y=88, centerY=88+60=148 (2px away from 150)
      const dragged = createMockNode('dragged', 400, 0, 200, 120);

      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 400, y: 88 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaY).toBe(2);
      expect(res.lines[0].orientation).toBe('horizontal');
      expect(res.lines[0].coordinate).toBe(150);
      expect(res.lines[0].alignment).toBe('center');
    });

    it('snaps Bottom-to-Bottom on Y axis', () => {
      // target bottom = 50 + 200 = 250
      const target = createMockNode('target', 100, 50, 200, 200);
      // dragged height = 100. If y=156, bottom=256 (6px away from 250)
      const dragged = createMockNode('dragged', 400, 0, 200, 100);

      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 400, y: 156 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaY).toBe(-6);
      expect(res.lines[0].coordinate).toBe(250);
      expect(res.lines[0].alignment).toBe('end');
    });

    it('snaps simultaneously on both X and Y axes', () => {
      const target = createMockNode('target', 200, 200, 200, 100);
      const dragged = createMockNode('dragged', 0, 0, 200, 100);

      // Drag dragged to x=203, y=197 (3px away on both axes)
      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 203, y: 197 } }],
        allNodes: [target, dragged],
      });

      expect(res.deltaX).toBe(-3);
      expect(res.deltaY).toBe(3);
      expect(res.lines.length).toBe(2);
      const vertLine = res.lines.find((l) => l.orientation === 'vertical');
      const horizLine = res.lines.find((l) => l.orientation === 'horizontal');
      expect(vertLine?.coordinate).toBe(200);
      expect(horizLine?.coordinate).toBe(200);
    });

    it('does NOT snap when distance exceeds threshold', () => {
      const target = createMockNode('target', 100, 100, 200, 100);
      const dragged = createMockNode('dragged', 0, 0, 200, 100);

      // Drag to x=115, y=120 (diff is 15 and 20, > 8)
      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 115, y: 120 } }],
        allNodes: [target, dragged],
        snapThreshold: 8,
      });

      expect(res.deltaX).toBe(0);
      expect(res.deltaY).toBe(0);
      expect(res.lines).toEqual([]);
    });

    it('snaps a multi-selection as a rigid group', () => {
      const target = createMockNode('target', 400, 100, 200, 100);
      const draggedA = createMockNode('dA', 100, 100, 200, 100);
      const draggedB = createMockNode('dB', 100, 250, 200, 100);

      // Dragging selection: draggedA top is moved near target top (y=104 vs y=100)
      const res = calculateNodeSnap({
        draggedNodes: [
          { node: draggedA, newPosition: { x: 100, y: 104 } },
          { node: draggedB, newPosition: { x: 100, y: 254 } },
        ],
        allNodes: [target, draggedA, draggedB],
      });

      expect(res.deltaY).toBe(-4);
      expect(res.lines.length).toBe(1);
      expect(res.lines[0].coordinate).toBe(100);
    });

    it('excludes enclosed children when dragging a Comment Box', () => {
      // Comment box at (0, 0) with width 500, height 400
      const commentBox = createMockNode(
        'comment1',
        0,
        0,
        500,
        400,
        StoryNodeType.Comment,
        { width: 500, height: 400 },
      );
      // Child node physically inside comment box at (100, 100)
      const childNode = createMockNode('child', 100, 100, 200, 100);
      // External target outside comment box at (700, 0)
      const externalTarget = createMockNode('ext', 700, 0, 200, 100);

      // Drag comment box slightly: (4, 3)
      const res = calculateNodeSnap({
        draggedNodes: [{ node: commentBox, newPosition: { x: 4, y: 3 } }],
        allNodes: [commentBox, childNode, externalTarget],
      });

      // Should snap to externalTarget's top (y=0) and NOT snap to childNode
      expect(res.deltaY).toBe(-3);
      expect(res.lines[0].targetNodeIds).toContain('ext');
      expect(res.lines[0].targetNodeIds).not.toContain('child');
    });

    it('spans guide line across multiple aligned target nodes', () => {
      // Three targets in a column with left edge at x=300
      const t1 = createMockNode('t1', 300, 100, 100, 80);
      const t2 = createMockNode('t2', 300, 250, 150, 80);
      const t3 = createMockNode('t3', 300, 400, 120, 80);
      const dragged = createMockNode('dragged', 0, 0, 100, 80);

      const res = calculateNodeSnap({
        draggedNodes: [{ node: dragged, newPosition: { x: 302, y: 0 } }],
        allNodes: [t1, t2, t3, dragged],
      });

      expect(res.deltaX).toBe(-2);
      expect(res.lines.length).toBe(1);
      const line = res.lines[0];
      expect(line.coordinate).toBe(300);
      expect(line.targetNodeIds).toContain('t1');
      expect(line.targetNodeIds).toContain('t2');
      expect(line.targetNodeIds).toContain('t3');
      // Line should span through all of them (min Y to max bottom)
      expect(line.start).toBeLessThan(100);
      expect(line.end).toBeGreaterThan(480);
    });
  });
});
