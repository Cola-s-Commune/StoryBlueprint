import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ChoiceNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

export function ChoiceNode({ data }: NodeProps) {
  const d = data as unknown as ChoiceNodeData;
  return (
    <div className={styles.node} style={{ borderColor: '#ff9800' }}>
      <div className={styles.header} style={{ background: '#ff9800' }}>
        CHOICE
      </div>
      <div className={styles.body}>
        <div className={styles.field}>
          <label>Prompt</label>
          {d.prompt || 'Choose...'}
        </div>
        <div className={styles.choices}>
          {d.options?.map((opt) => (
            <div key={opt.id} className={styles.choice}>
              {opt.label}
            </div>
          ))}
        </div>
      </div>
      <Handle type="target" position={Position.Top} id="in" />
      {d.options?.map((opt, i) => (
        <Handle
          key={opt.id}
          type="source"
          position={Position.Bottom}
          id={opt.id}
          style={{ left: `${((i + 1) / (d.options.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}
