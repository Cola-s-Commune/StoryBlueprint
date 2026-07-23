import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StartNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function StartNode({ data }: NodeProps) {
  const d = data as unknown as StartNodeData;
  return (
    <div className={styles.node} style={{ borderColor: '#4caf50' }}>
      <div className={styles.header} style={{ background: '#4caf50' }}>
        START
      </div>
      <div className={styles.body}>
        <div className={styles.field}>{d.title || 'Untitled'}</div>
      </div>
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
