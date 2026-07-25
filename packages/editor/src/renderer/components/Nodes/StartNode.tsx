import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StartNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import styles from './Node.module.css';

export function StartNode({ data }: NodeProps) {
  const d = data as unknown as StartNodeData;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#62c878',
          '--node-accent-soft': 'rgb(98 200 120 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Story Entry</span>
        <span className={styles.typeIcon}>▶</span>
      </div>
      <div className={styles.terminalBody}>{d.title || 'Untitled'}</div>
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
      />
    </div>
  );
}
