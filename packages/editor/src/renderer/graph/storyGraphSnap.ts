import { StoryNodeType } from '@story-blueprint/common';
import type { EditorGraphNode } from './editorGraph';

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  right: number;
  bottom: number;
}

export function getNodeBounds(
  node: EditorGraphNode,
  overridePosition?: { x: number; y: number },
): NodeBounds {
  const x = overridePosition ? overridePosition.x : node.position.x;
  const y = overridePosition ? overridePosition.y : node.position.y;

  let width = node.measured?.width ?? (node.width as number);
  let height = node.measured?.height ?? (node.height as number);

  if (!width || !height) {
    if (node.type === StoryNodeType.Comment) {
      const data = node.data as { width?: number; height?: number };
      width = data.width ?? 400;
      height = data.height ?? 240;
    } else {
      width = width || 260;
      height = height || 140;
    }
  }

  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    right: x + width,
    bottom: y + height,
  };
}

export type SnapAlignment = 'start' | 'center' | 'end';

export interface SnapLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  coordinate: number; // constant Y for horizontal, constant X for vertical
  start: number; // min X for horizontal, min Y for vertical
  end: number; // max X for horizontal, max Y for vertical
  sourceNodeId: string;
  targetNodeIds: string[];
  alignment: SnapAlignment;
  /** Primary indicator positions on this line (e.g. centers or aligned edges) */
  markers: number[];
}

export interface NodeSnapCalculationResult {
  deltaX: number;
  deltaY: number;
  lines: SnapLine[];
}

export interface DraggedNodeItem {
  node: EditorGraphNode;
  newPosition: { x: number; y: number };
}

export interface CalculateSnapOptions {
  draggedNodes: DraggedNodeItem[];
  allNodes: readonly EditorGraphNode[];
  snapThreshold?: number; // default: 8
  disabled?: boolean;
}

const DEFAULT_SNAP_THRESHOLD = 8;
const GUIDE_LINE_PADDING = 40;

/**
 * Calculates smart alignment snapping for dragged node(s) against other nodes in the graph.
 * Returns delta adjustments to apply to positions and visual guide lines to render.
 */
export function calculateNodeSnap(options: CalculateSnapOptions): NodeSnapCalculationResult {
  const { draggedNodes, allNodes, snapThreshold = DEFAULT_SNAP_THRESHOLD, disabled = false } = options;

  if (disabled || draggedNodes.length === 0 || allNodes.length <= 1) {
    return { deltaX: 0, deltaY: 0, lines: [] };
  }

  const draggedNodeIds = new Set(draggedNodes.map((item) => item.node.id));

  // Determine candidate target nodes
  let candidateTargets = allNodes.filter((candidate) => !draggedNodeIds.has(candidate.id));

  // If a Comment box is being dragged, exclude nodes enclosed within it
  for (const item of draggedNodes) {
    if (item.node.type === StoryNodeType.Comment) {
      const boxX = item.node.position.x;
      const boxY = item.node.position.y;
      const boxW = ((item.node.data as any)?.width as number) ?? 400;
      const boxH = ((item.node.data as any)?.height as number) ?? 240;

      candidateTargets = candidateTargets.filter(
        (target) =>
          !(
            target.type !== StoryNodeType.Comment &&
            target.position.x >= boxX &&
            target.position.x <= boxX + boxW &&
            target.position.y >= boxY &&
            target.position.y <= boxY + boxH
          ),
      );
    }
  }

  if (candidateTargets.length === 0) {
    return { deltaX: 0, deltaY: 0, lines: [] };
  }

  const targetBoundsList = candidateTargets.map((target) => ({
    node: target,
    bounds: getNodeBounds(target),
  }));

  let bestDeltaX: number | null = null;
  let bestDistX = Infinity;
  let bestLineX: {
    coordinate: number;
    alignment: SnapAlignment;
    sourceNode: EditorGraphNode;
    targetBounds: (typeof targetBoundsList)[0];
  } | null = null;

  let bestDeltaY: number | null = null;
  let bestDistY = Infinity;
  let bestLineY: {
    coordinate: number;
    alignment: SnapAlignment;
    sourceNode: EditorGraphNode;
    targetBounds: (typeof targetBoundsList)[0];
  } | null = null;

  // Evaluate alignment candidates across all dragged nodes
  for (const draggedItem of draggedNodes) {
    const currentBounds = getNodeBounds(draggedItem.node, draggedItem.newPosition);

    for (const targetItem of targetBoundsList) {
      const tb = targetItem.bounds;

      // ---- X Axis Alignments (Produces vertical guide lines) ----
      // 1. Left to Left
      const diffLeftLeft = tb.x - currentBounds.x;
      if (Math.abs(diffLeftLeft) <= snapThreshold && Math.abs(diffLeftLeft) < bestDistX) {
        bestDistX = Math.abs(diffLeftLeft);
        bestDeltaX = diffLeftLeft;
        bestLineX = {
          coordinate: tb.x,
          alignment: 'start',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }

      // 2. Center to Center
      const diffCenterCenter = tb.centerX - currentBounds.centerX;
      if (Math.abs(diffCenterCenter) <= snapThreshold && Math.abs(diffCenterCenter) < bestDistX) {
        bestDistX = Math.abs(diffCenterCenter);
        bestDeltaX = diffCenterCenter;
        bestLineX = {
          coordinate: tb.centerX,
          alignment: 'center',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }

      // 3. Right to Right
      const diffRightRight = tb.right - currentBounds.right;
      if (Math.abs(diffRightRight) <= snapThreshold && Math.abs(diffRightRight) < bestDistX) {
        bestDistX = Math.abs(diffRightRight);
        bestDeltaX = diffRightRight;
        bestLineX = {
          coordinate: tb.right,
          alignment: 'end',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }

      // ---- Y Axis Alignments (Produces horizontal guide lines) ----
      // 1. Top to Top
      const diffTopTop = tb.y - currentBounds.y;
      if (Math.abs(diffTopTop) <= snapThreshold && Math.abs(diffTopTop) < bestDistY) {
        bestDistY = Math.abs(diffTopTop);
        bestDeltaY = diffTopTop;
        bestLineY = {
          coordinate: tb.y,
          alignment: 'start',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }

      // 2. Center to Center
      const diffCenterCenterY = tb.centerY - currentBounds.centerY;
      if (Math.abs(diffCenterCenterY) <= snapThreshold && Math.abs(diffCenterCenterY) < bestDistY) {
        bestDistY = Math.abs(diffCenterCenterY);
        bestDeltaY = diffCenterCenterY;
        bestLineY = {
          coordinate: tb.centerY,
          alignment: 'center',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }

      // 3. Bottom to Bottom
      const diffBottomBottom = tb.bottom - currentBounds.bottom;
      if (Math.abs(diffBottomBottom) <= snapThreshold && Math.abs(diffBottomBottom) < bestDistY) {
        bestDistY = Math.abs(diffBottomBottom);
        bestDeltaY = diffBottomBottom;
        bestLineY = {
          coordinate: tb.bottom,
          alignment: 'end',
          sourceNode: draggedItem.node,
          targetBounds: targetItem,
        };
      }
    }
  }

  const deltaX = bestDeltaX ?? 0;
  const deltaY = bestDeltaY ?? 0;
  const lines: SnapLine[] = [];

  // Build vertical guide line
  if (bestLineX !== null) {
    const coord = bestLineX.coordinate;
    const alignedSourceBounds = getNodeBounds(bestLineX.sourceNode, {
      x: (draggedNodes.find((d) => d.node.id === bestLineX!.sourceNode.id)?.newPosition.x ?? 0) + deltaX,
      y: (draggedNodes.find((d) => d.node.id === bestLineX!.sourceNode.id)?.newPosition.y ?? 0) + deltaY,
    });

    // Find all target nodes matching this vertical line coordinate
    const matchingTargets = targetBoundsList.filter((item) => {
      const b = item.bounds;
      if (bestLineX!.alignment === 'start') return Math.abs(b.x - coord) < 1;
      if (bestLineX!.alignment === 'center') return Math.abs(b.centerX - coord) < 1;
      return Math.abs(b.right - coord) < 1;
    });

    const allYValues = [
      alignedSourceBounds.y,
      alignedSourceBounds.bottom,
      ...matchingTargets.flatMap((t) => [t.bounds.y, t.bounds.bottom]),
    ];

    const minY = Math.min(...allYValues) - GUIDE_LINE_PADDING;
    const maxY = Math.max(...allYValues) + GUIDE_LINE_PADDING;

    const markers = [
      alignedSourceBounds.centerY,
      ...matchingTargets.map((t) => t.bounds.centerY),
    ];

    lines.push({
      id: `v-${Math.round(coord)}-${bestLineX.alignment}`,
      orientation: 'vertical',
      coordinate: Math.round(coord),
      start: Math.round(minY),
      end: Math.round(maxY),
      sourceNodeId: bestLineX.sourceNode.id,
      targetNodeIds: matchingTargets.map((t) => t.node.id),
      alignment: bestLineX.alignment,
      markers: markers.map((m) => Math.round(m)),
    });
  }

  // Build horizontal guide line
  if (bestLineY !== null) {
    const coord = bestLineY.coordinate;
    const alignedSourceBounds = getNodeBounds(bestLineY.sourceNode, {
      x: (draggedNodes.find((d) => d.node.id === bestLineY!.sourceNode.id)?.newPosition.x ?? 0) + deltaX,
      y: (draggedNodes.find((d) => d.node.id === bestLineY!.sourceNode.id)?.newPosition.y ?? 0) + deltaY,
    });

    // Find all target nodes matching this horizontal line coordinate
    const matchingTargets = targetBoundsList.filter((item) => {
      const b = item.bounds;
      if (bestLineY!.alignment === 'start') return Math.abs(b.y - coord) < 1;
      if (bestLineY!.alignment === 'center') return Math.abs(b.centerY - coord) < 1;
      return Math.abs(b.bottom - coord) < 1;
    });

    const allXValues = [
      alignedSourceBounds.x,
      alignedSourceBounds.right,
      ...matchingTargets.flatMap((t) => [t.bounds.x, t.bounds.right]),
    ];

    const minX = Math.min(...allXValues) - GUIDE_LINE_PADDING;
    const maxX = Math.max(...allXValues) + GUIDE_LINE_PADDING;

    const markers = [
      alignedSourceBounds.centerX,
      ...matchingTargets.map((t) => t.bounds.centerX),
    ];

    lines.push({
      id: `h-${Math.round(coord)}-${bestLineY.alignment}`,
      orientation: 'horizontal',
      coordinate: Math.round(coord),
      start: Math.round(minX),
      end: Math.round(maxX),
      sourceNodeId: bestLineY.sourceNode.id,
      targetNodeIds: matchingTargets.map((t) => t.node.id),
      alignment: bestLineY.alignment,
      markers: markers.map((m) => Math.round(m)),
    });
  }

  return {
    deltaX,
    deltaY,
    lines,
  };
}
