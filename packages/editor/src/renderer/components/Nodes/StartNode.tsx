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
      className={`${styles.node} ${styles.functionNode}`}
      style={
        {
          '--node-accent': '#62c878',
          '--node-accent-soft': 'rgb(98 200 120 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.functionHeaderText}>
          <span className={styles.functionKicker}>
            {chapter ? 'Substory Entry' : 'Story Entry'}
          </span>
          <strong className={styles.functionName}>
            {chapter?.displayName ?? d.title ?? 'Untitled'}
          </strong>
        </div>
        <span className={styles.typeIcon}>▶</span>
      </div>
      <div className={styles.functionBody}>
        <div className={styles.functionPorts}>
          <section className={styles.functionPortColumn} aria-label="Story entry parameters">
            {chapter && chapter.parameters.length > 0 ? (
              chapter.parameters.map((parameter) => (
                <div className={styles.functionPortRow} key={parameter.variable.id}>
                  <span>{parameter.variable.displayName}</span>
                  <em>{parameter.variable.valueType.kind}</em>
                </div>
              ))
            ) : (
              <span className={styles.functionPortEmpty}>No parameters</span>
            )}
          </section>
          <section className={styles.functionPortColumn} aria-label="Story entry results">
            <span className={`${styles.functionPortEmpty} ${styles.functionPortEmptyOutput}`}>
              Entry point
            </span>
          </section>
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleOutput} ${styles.functionExecHandle}`}
        type="source"
        position={Position.Right}
        id="out"
      />
    </div>
  );
}
