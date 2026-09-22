import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
  type NodeId,
  type RerouteNodeData,
  StoryNodeType,
} from '@story-blueprint/common';
import { useEffect, type CSSProperties } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { valueTypeColor } from '../../graph/valueTypeColors';
import styles from './Node.module.css';

function horizontalSideToward(
  origin: { x: number; y: number } | undefined,
  target: { x: number; y: number } | undefined,
  fallback: Position,
): Position {
  if (!origin || !target) return fallback;
  const dx = target.x - origin.x;
  if (Math.abs(dx) < 1) return fallback;
  return dx < 0 ? Position.Left : Position.Right;
}

function rerouteHandleStyle(position: Position): CSSProperties {
  return position === Position.Left ? { left: 5 } : { right: 5 };
}

export function RerouteNode({ id }: NodeProps) {
  const { nodes, edges } = useStoryGraphStore();
  const updateNodeInternals = useUpdateNodeInternals();
  const reroute = nodes.find((node) => node.id === id);
  const incoming = edges.find((edge) => edge.target === id);
  const outgoing = edges.find((edge) => edge.source === id);
  const previous = incoming ? nodes.find((node) => node.id === incoming.source) : undefined;
  const next = outgoing ? nodes.find((node) => node.id === outgoing.target) : undefined;
  const inputSide = horizontalSideToward(reroute?.position, previous?.position, Position.Left);
  const outputSide = horizontalSideToward(reroute?.position, next?.position, Position.Right);
  const rerouteData = reroute?.data as RerouteNodeData | undefined;
  const dataReroute = rerouteData?.kind === 'data';

  useEffect(() => updateNodeInternals(id), [id, inputSide, outputSide, updateNodeInternals]);

  return (
    <div
      className={`${styles.reroute} ${dataReroute ? styles.rerouteData : ''}`}
      style={
        dataReroute && rerouteData?.valueType
          ? ({
              borderColor: valueTypeColor(rerouteData.valueType),
              background: `color-mix(in srgb, ${valueTypeColor(rerouteData.valueType)} 38%, #20242b)`,
            } as CSSProperties)
          : undefined
      }
      title={dataReroute ? `Data Reroute · ${rerouteData?.valueType?.kind ?? 'any'}` : 'Reroute'}
    >
      <Handle
        className={styles.rerouteHandle}
        type="target"
        position={inputSide}
        id="in"
        style={rerouteHandleStyle(inputSide)}
      />
      <Handle
        className={styles.rerouteHandle}
        type="source"
        position={outputSide}
        id="out"
        style={rerouteHandleStyle(outputSide)}
      />
    </div>
  );
}

export function FlowAnchorNode({ data }: NodeProps) {
  const anchor = data as unknown as FlowAnchorNodeData;
  return (
    <div
      className={`${styles.node} ${styles.flowNode}`}
      style={
        {
          '--node-accent': '#38a6a5',
          '--node-accent-soft': 'rgb(56 166 165 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Flow Anchor</span>
        <span className={styles.typeIcon}>◎</span>
      </div>
      <div className={styles.portalBody}>
        <strong>{anchor.label || 'Portal'}</strong>
        <small>Destination</small>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
      />
      <Handle
        className={styles.portalVirtualHandle}
        type="target"
        position={Position.Left}
        id="portal-in"
        isConnectable={false}
      />
    </div>
  );
}

export function FlowJumpNode({ data }: NodeProps) {
  const jump = data as unknown as FlowJumpNodeData;
  const { nodes } = useStoryGraphStore();
  const target = nodes.find(
    (candidate) =>
      candidate.id === jump.targetNodeId && candidate.type === StoryNodeType.FlowAnchor,
  );
  const label = target
    ? (target.data as FlowAnchorNodeData).label
    : jump.targetNodeId
      ? 'Missing target'
      : 'Select target';
  return (
    <div
      className={`${styles.node} ${styles.flowNode}`}
      style={
        {
          '--node-accent': '#38a6a5',
          '--node-accent-soft': 'rgb(56 166 165 / 14%)',
        } as CSSProperties
      }
      data-target-node-id={jump.targetNodeId as NodeId | undefined}
    >
      <div className={styles.header}>
        <span className={styles.title}>Flow Jump</span>
        <span className={styles.typeIcon}>↪</span>
      </div>
      <div className={styles.portalBody}>
        <strong>{label}</strong>
        <small>Hidden connection</small>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      <Handle
        className={styles.portalVirtualHandle}
        type="source"
        position={Position.Right}
        id="portal-out"
        isConnectable={false}
      />
    </div>
  );
}
