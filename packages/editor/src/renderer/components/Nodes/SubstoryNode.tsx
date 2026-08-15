import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { CallSubstoryNodeData, ReturnNodeData } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './Node.module.css';

export function CallSubstoryNode({ data }: NodeProps) {
  const d = data as unknown as CallSubstoryNodeData;
  const { chapters } = useStoryGraphStore();
  const chapter = chapters.find((candidate) => candidate.id === d.chapterId);
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#6d96df',
          '--node-accent-soft': 'rgb(109 150 223 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Call Substory</span>
        <span className={styles.typeIcon}>↗</span>
      </div>
      <div className={styles.terminalBody}>
        <strong>
          {chapter?.displayName ?? (d.chapterId ? 'Missing Substory' : 'Select Substory')}
        </strong>
        {chapter && (
          <div className={styles.interfaceRows}>
            {chapter.parameters.map((parameter) => (
              <span key={parameter.variable.id}>
                <b>IN</b> {parameter.variable.displayName}
                <em>{parameter.variable.valueType.kind}</em>
              </span>
            ))}
            {chapter.outputs.map((output) => (
              <span key={output.variable.id}>
                <b>OUT</b> {output.variable.displayName}
                <em>{output.variable.valueType.kind}</em>
              </span>
            ))}
            {chapter.parameters.length === 0 && chapter.outputs.length === 0 && (
              <span className={styles.expression}>No parameters</span>
            )}
          </div>
        )}
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

export function ReturnNode({ data }: NodeProps) {
  const d = data as unknown as ReturnNodeData;
  const { chapters, activeGraphId } = useStoryGraphStore();
  const chapter = chapters.find((candidate) => candidate.id === activeGraphId);
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#bd7cdb',
          '--node-accent-soft': 'rgb(189 124 219 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Return</span>
        <span className={styles.typeIcon}>↩</span>
      </div>
      <div className={styles.terminalBody}>
        <strong>Return to caller</strong>
        {chapter && (
          <div className={styles.interfaceRows}>
            {chapter.outputs.map((output) => (
              <span key={output.variable.id}>
                <b>OUT</b> {output.variable.displayName}
                <em>
                  {output.variable.valueType.kind} ·
                  {d.values?.[output.variable.id]?.source || ' value'}
                </em>
              </span>
            ))}
            {chapter.outputs.length === 0 && <span className={styles.expression}>No outputs</span>}
          </div>
        )}
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
