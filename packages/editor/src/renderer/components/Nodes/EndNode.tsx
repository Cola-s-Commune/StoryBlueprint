import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { EndNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function EndNode({ data }: NodeProps) {
  const d = data as unknown as EndNodeData;
  return (
    <div className={styles.node} style={{ borderColor: '#f44336' }}>
      <div className={styles.header} style={{ background: '#f44336' }}>
        END
      </div>
      <div className={styles.body}>
        <div className={styles.field}>{d.title || 'The End'}</div>
      </div>
      <Handle type="target" position={Position.Top} id="in" />
    </div>
  );
}
