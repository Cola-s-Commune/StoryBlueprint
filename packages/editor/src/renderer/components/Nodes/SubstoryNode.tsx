import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { CallSubstoryNodeData, ReturnNodeData } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { valueTypeColor } from '../../graph/valueTypeColors';
import styles from './Node.module.css';

export function CallSubstoryNode({ data }: NodeProps) {
  const d = data as unknown as CallSubstoryNodeData;
  const { chapters } = useStoryGraphStore();
  const chapter = chapters.find((candidate) => candidate.id === d.chapterId);
  return (
    <div
      className={`${styles.node} ${styles.functionNode}`}
      style={
        {
          '--node-accent': '#6d96df',
          '--node-accent-soft': 'rgb(109 150 223 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.functionHeaderText}>
          <span className={styles.functionKicker}>Call Substory</span>
          <strong className={styles.functionName}>
            {chapter?.displayName ?? (d.chapterId ? 'Missing Substory' : 'Select Substory')}
          </strong>
        </div>
        <span className={styles.typeIcon}>↗</span>
      </div>
      <div className={styles.functionBody}>
        <div className={styles.functionPorts}>
          <section className={styles.functionPortColumn} aria-label="Substory parameters">
            {chapter && chapter.parameters.length > 0 ? (
              chapter.parameters.map((parameter) => (
                <div className={styles.functionPortRow} key={parameter.variable.id}>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleInput}`}
                    type="target"
                    position={Position.Left}
                    id={`argument:${parameter.variable.id}`}
                    style={
                      {
                        '--data-pin-color': valueTypeColor(parameter.variable.valueType),
                      } as CSSProperties
                    }
                  />
                  <span>{parameter.variable.displayName}</span>
                  <em>{parameter.variable.valueType.kind}</em>
                </div>
              ))
            ) : (
              <span className={styles.functionPortEmpty}>No parameters</span>
            )}
          </section>
          <section className={styles.functionPortColumn} aria-label="Substory results">
            {chapter && chapter.outputs.length > 0 ? (
              chapter.outputs.map((output) => (
                <div className={styles.functionPortRow} key={output.variable.id}>
                  <span>{output.variable.displayName}</span>
                  <em>{output.variable.valueType.kind}</em>
                  <Handle
                    className={`${styles.dataHandle} ${styles.functionReturnValueHandle}`}
                    type="source"
                    position={Position.Right}
                    id={`output:${output.variable.id}`}
                    style={
                      {
                        '--data-pin-color': valueTypeColor(output.variable.valueType),
                      } as CSSProperties
                    }
                  />
                </div>
              ))
            ) : (
              <span className={`${styles.functionPortEmpty} ${styles.functionPortEmptyOutput}`}>
                No return values
              </span>
            )}
          </section>
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput} ${styles.functionExecHandle}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      <Handle
        className={`${styles.handle} ${styles.handleOutput} ${styles.functionExecHandle}`}
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
      className={`${styles.node} ${styles.functionNode}`}
      style={
        {
          '--node-accent': '#bd7cdb',
          '--node-accent-soft': 'rgb(189 124 219 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.functionHeaderText}>
          <span className={styles.functionKicker}>Return</span>
          <strong className={styles.functionName}>To caller</strong>
        </div>
        <span className={styles.typeIcon}>↩</span>
      </div>
      <div className={styles.functionBody}>
        <div className={`${styles.functionPorts} ${styles.functionReturnPorts}`}>
          <section className={styles.functionPortColumn} aria-label="Return values">
            {chapter && chapter.outputs.length > 0 ? (
              chapter.outputs.map((output) => (
                <div className={styles.functionPortRow} key={output.variable.id}>
                  <span className={styles.functionPortLabel}>
                    <strong>{output.variable.displayName}</strong>
                    <small>{d.values?.[output.variable.id]?.source || 'value'}</small>
                  </span>
                  <em>{output.variable.valueType.kind}</em>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleInput}`}
                    type="target"
                    position={Position.Left}
                    id={`value:${output.variable.id}`}
                    style={
                      {
                        '--data-pin-color': valueTypeColor(output.variable.valueType),
                      } as CSSProperties
                    }
                  />
                </div>
              ))
            ) : (
              <span className={styles.functionPortEmpty}>No return values</span>
            )}
          </section>
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput} ${styles.functionExecHandle}`}
        type="target"
        position={Position.Left}
        id="in"
      />
    </div>
  );
}
