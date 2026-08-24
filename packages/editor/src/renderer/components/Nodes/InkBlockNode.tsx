import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { InkBlockNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

function summary(source: string): string {
  const firstLine = source.split(/\r?\n/).find((line) => line.trim());
  if (!firstLine) return 'No Ink source yet…';
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function InkBlockNode({ data }: NodeProps) {
  const ink = data as unknown as InkBlockNodeData;
  const lineCount =
    ink.sourceMode === 'embedded' && ink.source ? ink.source.split(/\r?\n/).length : '↗';
  const sourceSummary = ink.sourceMode === 'embedded' ? summary(ink.source) : ink.path;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#9c89eb',
          '--node-accent-soft': 'rgb(156 137 235 / 15%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Ink Block</span>
        <span className={styles.typeIcon}>{lineCount}</span>
      </div>
      <div className={styles.body}>
        {ink.entryKnot && <label>Entry: {ink.entryKnot}</label>}
        <div className={styles.field}>{sourceSummary}</div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
      />
    </div>
  );
}
