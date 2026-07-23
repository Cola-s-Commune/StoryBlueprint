import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DialogueNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function DialogueNode({ data }: NodeProps) {
  const d = data as unknown as DialogueNodeData;
  return (
    <div className={styles.node} style={{ borderColor: '#2196f3' }}>
      <div className={styles.header} style={{ background: '#2196f3' }}>
        DIALOGUE
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Speaker</label>
          {d.speaker || 'Character'}
        </div>
        <div className={styles.field}>
          <label>Text</label>
          {d.text || '(empty)'}
        </div>
      </div>
      <Handle type="target" position={Position.Top} id="in" />
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
