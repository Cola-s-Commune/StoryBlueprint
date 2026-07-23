import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BranchNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function BranchNode({ data }: NodeProps) {
  const d = data as unknown as BranchNodeData;
  return (
    <div className={styles.node} style={{ borderColor: '#9c27b0' }}>
      <div className={styles.header} style={{ background: '#9c27b0' }}>
        BRANCH
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Condition</label>
          {d.condition || '...'}
        </div>
      </div>
      <Handle type="target" position={Position.Top} id="in" />
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%' }} />
    </div>
  );
}
