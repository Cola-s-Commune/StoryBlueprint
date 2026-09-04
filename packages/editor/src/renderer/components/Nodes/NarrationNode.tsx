import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { NarrationNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function NarrationNode({ data }: NodeProps) {
  const narration = data as unknown as NarrationNodeData;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#97a9cf',
          '--node-accent-soft': 'rgb(151 169 207 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Narration</span>
      </div>
      <div className={styles.body}>
        <div className={styles.dialogueText}>
          {narration.text.source || 'No narration text yet...'}
        </div>
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
