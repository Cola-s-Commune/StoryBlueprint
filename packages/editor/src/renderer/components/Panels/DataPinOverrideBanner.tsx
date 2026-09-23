import type { ReactNode } from 'react';
import styles from './DataPinOverrideBanner.module.css';

export interface DataPinOverrideBannerProps {
  label: string;
  sourceNodeTitle?: string;
  sourcePortLabel?: string;
  targetNodeId?: string;
  targetHandle?: string;
  edges?: readonly {
    target: string;
    targetHandle?: string | null;
    source: string;
    sourceHandle?: string | null;
  }[];
  nodes?: readonly {
    id: string;
    type?: string;
    data?: unknown;
    name?: string;
  }[];
  className?: string;
  children?: ReactNode;
}

export function findIncomingSourceInfo(
  targetNodeId: string,
  targetHandle: string,
  edges?: readonly {
    target: string;
    targetHandle?: string | null;
    source: string;
    sourceHandle?: string | null;
  }[],
  nodes?: readonly {
    id: string;
    type?: string;
    data?: unknown;
    name?: string;
  }[],
): { sourceNodeTitle?: string; sourcePortLabel?: string } | undefined {
  if (!edges || !nodes) return undefined;
  const edge = edges.find(
    (candidate) => candidate.target === targetNodeId && candidate.targetHandle === targetHandle,
  );
  if (!edge) return undefined;
  const sourceNode = nodes.find((candidate) => candidate.id === edge.source);
  const data = sourceNode?.data as Record<string, unknown> | undefined;
  const sourceNodeTitle =
    sourceNode?.name ??
    (typeof data?.title === 'string' && data.title ? data.title : undefined) ??
    sourceNode?.type ??
    edge.source;
  const sourcePortLabel = edge.sourceHandle ?? undefined;
  return { sourceNodeTitle, sourcePortLabel };
}

function WireIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.5 8h3l2.5-4 3 8 2-4h2.5" />
    </svg>
  );
}

export function DataPinOverrideBanner({
  label,
  sourceNodeTitle: explicitSourceTitle,
  sourcePortLabel: explicitPortLabel,
  targetNodeId,
  targetHandle,
  edges,
  nodes,
  className,
  children,
}: DataPinOverrideBannerProps) {
  const resolved =
    targetNodeId && targetHandle
      ? findIncomingSourceInfo(targetNodeId, targetHandle, edges, nodes)
      : undefined;

  const sourceNodeTitle = explicitSourceTitle ?? resolved?.sourceNodeTitle;
  const sourcePortLabel = explicitPortLabel ?? resolved?.sourcePortLabel;

  return (
    <div className={`${styles.banner} ${className ?? ''}`} role="note">
      <div className={styles.header}>
        <span className={styles.icon}>
          <WireIcon />
        </span>
        <span>
          {label} comes from a data connection{sourceNodeTitle ? ` (from ${sourceNodeTitle})` : ''}.
        </span>
      </div>
      <div className={styles.details}>
        {sourceNodeTitle && sourcePortLabel && (
          <span className={styles.sourceInfo}>
            Output pin: <strong>{sourcePortLabel}</strong>
          </span>
        )}
        <span className={styles.fallbackNote}>
          The Inspector value remains as the fallback after disconnecting.
        </span>
        {children}
      </div>
    </div>
  );
}
