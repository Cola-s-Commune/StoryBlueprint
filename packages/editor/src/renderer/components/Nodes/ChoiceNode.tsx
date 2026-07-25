import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ChoiceNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import styles from './Node.module.css';

export function ChoiceNode({ data }: NodeProps) {
  const d = data as unknown as ChoiceNodeData;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#ffa840',
          '--node-accent-soft': 'rgb(255 168 64 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Choice</span>
        <span className={styles.typeIcon}>≡</span>
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Prompt</label>
          {d.prompt || 'Choose...'}
        </div>
        <div className={styles.choices}>
          {d.options?.map((opt, index) => (
            <div key={opt.id} className={styles.choice}>
              <span className={styles.choiceIndex}>{index + 1}</span>
              <span className={styles.choiceText}>{opt.label}</span>
              <Handle
                className={`${styles.handle} ${styles.handleOutput} ${styles.rowHandle}`}
                type="source"
                position={Position.Right}
                id={opt.id}
              />
            </div>
          ))}
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
    </div>
  );
}
