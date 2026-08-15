import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StartNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './Node.module.css';

export function StartNode({ data }: NodeProps) {
  const d = data as unknown as StartNodeData;
  const { chapters, activeGraphId } = useStoryGraphStore();
  const chapter = chapters.find((candidate) => candidate.id === activeGraphId);
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
        <span className={styles.title}>{chapter ? 'Substory Entry' : 'Story Entry'}</span>
        <span className={styles.typeIcon}>▶</span>
      </div>
      <div className={styles.terminalBody}>
        <strong>{chapter?.displayName ?? d.title ?? 'Untitled'}</strong>
        {chapter && (
          <div className={styles.interfaceRows}>
            {chapter.parameters.map((parameter) => (
              <span key={parameter.variable.id}>
                <b>IN</b> {parameter.variable.displayName}
                <em>{parameter.variable.valueType.kind}</em>
              </span>
            ))}
            {chapter.parameters.length === 0 && (
              <span className={styles.expression}>No inputs</span>
            )}
          </div>
        )}
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
      />
    </div>
  );
}
