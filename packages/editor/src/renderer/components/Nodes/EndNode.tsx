import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { EndNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import styles from './Node.module.css';

export function EndNode({ data }: NodeProps) {
  const d = data as unknown as EndNodeData;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#ee6666',
          '--node-accent-soft': 'rgb(238 102 102 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>End Story</span>
        <span className={styles.typeIcon}>■</span>
      </div>
      <div className={styles.terminalBody}>{d.title || 'The End'}</div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
    </div>
  );
}
