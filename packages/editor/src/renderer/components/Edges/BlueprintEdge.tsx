import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export function BlueprintSmoothStepEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  markerStart,
  className,
  interactionWidth,
  // Pull out React Flow-internal props that must not reach the SVG DOM element
  selectable: _selectable,
  deletable: _deletable,
  sourceHandleId: _sourceHandleId,
  targetHandleId: _targetHandleId,
  pathOptions: _pathOptions,
  sourceNode: _sourceNode,
  targetNode: _targetNode,
  source: _source,
  target: _target,
  data: _data,
  animated: _animated,
  selected: _selected,
  hidden: _hidden,
  zIndex: _zIndex,
  type: _type,
  label: _label,
  labelStyle: _labelStyle,
  labelShowBg: _labelShowBg,
  labelBgStyle: _labelBgStyle,
  labelBgPadding: _labelBgPadding,
  labelBgBorderRadius: _labelBgBorderRadius,
  focusable: _focusable,
  ...delegated
}: EdgeProps & { className?: string }) {
  const deltaX = targetX - sourceX;
  // If target is comfortably to the right of source, place the vertical bend near the target column.
  // This keeps long forward wires in their source horizontal lane, preventing premature vertical drops
  // that cut across unrelated intermediate nodes and wires.
  const centerX =
    deltaX > 60
      ? targetX - Math.min(45, deltaX / 2)
      : undefined;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    centerX,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      className={className}
      interactionWidth={interactionWidth}
      labelX={labelX}
      labelY={labelY}
      {...delegated}
    />
  );
}
