import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BranchNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import styles from './Node.module.css';

export function BranchNode({ data }: NodeProps) {
  const d = data as unknown as BranchNodeData;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#b36bd4',
          '--node-accent-soft': 'rgb(179 107 212 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Branch</span>
        <span className={styles.typeIcon}>?</span>
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Condition</label>
          <span className={styles.expression}>{d.condition.source || 'true'}</span>
        </div>
        <div className={styles.branchOutputs}>
          <div className={styles.branchOutput}>
            <span className={styles.branchBadge}>True</span>
            <span className={styles.portHint}>then</span>
            <Handle
              className={`${styles.handle} ${styles.handleOutput} ${styles.rowHandle}`}
              type="source"
              position={Position.Right}
              id="true"
            />
          </div>
          <div className={styles.branchOutput}>
            <span className={styles.branchBadge}>False</span>
            <span className={styles.portHint}>else</span>
            <Handle
              className={`${styles.handle} ${styles.handleOutput} ${styles.rowHandle}`}
              type="source"
              position={Position.Right}
              id="false"
            />
          </div>
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      <Handle
        className={`${styles.handle} ${styles.dataHandle} ${styles.dataHandleInput}`}
        type="target"
        position={Position.Left}
        id="condition"
        style={{ top: 62 }}
      />
    </div>
  );
}
