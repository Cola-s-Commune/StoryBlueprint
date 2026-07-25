import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DialogueNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import styles from './Node.module.css';

export function DialogueNode({ data }: NodeProps) {
  const d = data as unknown as DialogueNodeData;
  const speaker = d.speaker || 'Character';
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#42a5f5',
          '--node-accent-soft': 'rgb(66 165 245 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Dialogue</span>
        <span className={styles.typeIcon}>“</span>
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Speaker</label>
          <div className={styles.speaker}>
            <span className={styles.avatar}>{speaker.slice(0, 1)}</span>
            {speaker}
          </div>
        </div>
        <div className={styles.field}>
          <label>Line</label>
          <div className={styles.dialogueText}>{d.text || 'No dialogue text yet…'}</div>
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
