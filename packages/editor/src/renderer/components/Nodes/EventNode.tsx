import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { CallEventNodeData, WaitSignalNodeData } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { valueTypeColor } from '../../graph/valueTypeColors';
import styles from './Node.module.css';

export function CallEventNode({ data }: NodeProps) {
  const call = data as unknown as CallEventNodeData;
  const { events } = useStoryGraphStore();
  const event = events.find((candidate) => candidate.id === call.eventId);
  const outputPorts =
    (event?.outputs && event.outputs.length > 0)
      ? event.outputs.map((output) => ({
          id: output.id,
          label: output.displayName,
          valueType: output.valueType,
        }))
      : (call.outputPorts && call.outputPorts.length > 0)
        ? call.outputPorts
        : [];
  return (
    <div
      className={`${styles.node} ${styles.functionNode}`}
      style={
        {
          '--node-accent': '#d979b5',
          '--node-accent-soft': 'rgb(217 121 181 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.functionHeaderText}>
          <span className={styles.functionKicker}>Call External Function</span>
          <strong className={styles.functionName}>
            {event?.displayName ??
              (call.eventId ? 'Missing External Function' : 'Select External Function')}
          </strong>
        </div>
        <span className={styles.typeIcon}>⚡</span>
      </div>
      <div className={styles.functionBody}>
        <div className={styles.functionPorts}>
          <section className={styles.functionPortColumn} aria-label="Function parameters">
            {(event?.parameters.length ?? 0) > 0 ? (
              event!.parameters.map((parameter) => (
                <div className={styles.functionPortRow} key={parameter.name}>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleInput}`}
                    type="target"
                    position={Position.Left}
                    id={`argument:${parameter.name}`}
                    style={
                      { '--data-pin-color': valueTypeColor(parameter.valueType) } as CSSProperties
                    }
                  />
                  <span>{parameter.name}</span>
                  <em>{parameter.valueType.kind}</em>
                </div>
              ))
            ) : (
              <span className={styles.functionPortEmpty}>No parameters</span>
            )}
          </section>
          <section className={styles.functionPortColumn} aria-label="Function results">
            {outputPorts.length > 0 ? (
              outputPorts.map((output) => (
                <div
                  className={`${styles.functionPortRow} ${styles.functionPortRowOutput}`}
                  key={output.id}
                >
                  <span>{output.label}</span>
                  <em>{output.valueType.kind}</em>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleOutput}`}
                    type="source"
                    position={Position.Right}
                    id={`output:${output.id}`}
                    style={
                      { '--data-pin-color': valueTypeColor(output.valueType) } as CSSProperties
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

export function WaitSignalNode({ data }: NodeProps) {
  const wait = data as unknown as WaitSignalNodeData;
  const { signals } = useStoryGraphStore();
  const signal = signals.find((candidate) => candidate.id === wait.signalId);
  const parameters = signal?.parameters ?? [];
  const outputPorts =
    parameters.length > 0
      ? parameters.map((parameter) => ({
          id: parameter.name,
          label: parameter.name,
          valueType: parameter.valueType,
        }))
      : (wait.outputPorts && wait.outputPorts.length > 0)
        ? wait.outputPorts
        : [];

  return (
    <div
      className={`${styles.node} ${styles.functionNode}`}
      style={
        {
          '--node-accent': '#8c6ed8',
          '--node-accent-soft': 'rgb(140 110 216 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.functionHeaderText}>
          <span className={styles.functionKicker}>Wait for Signal</span>
          <strong className={styles.functionName}>
            {signal?.displayName ?? (wait.signalId ? 'Missing Signal' : 'Select Signal')}
          </strong>
        </div>
        <span className={styles.typeIcon}>◉</span>
      </div>

      <div className={styles.functionBody}>
        <div className={`${styles.functionPorts} ${styles.functionReturnPorts}`}>
          <section className={styles.functionPortColumn} aria-label="Signal parameters">
            {outputPorts.length > 0 ? (
              outputPorts.map((output) => (
                <div
                  className={`${styles.functionPortRow} ${styles.functionPortRowOutput}`}
                  key={output.id}
                >
                  <span>{output.label}</span>
                  <em>{output.valueType.kind}</em>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleOutput}`}
                    type="source"
                    position={Position.Right}
                    id={`payload:${output.id}`}
                    style={
                      { '--data-pin-color': valueTypeColor(output.valueType) } as CSSProperties
                    }
                  />
                </div>
              ))
            ) : (
              <span className={`${styles.functionPortEmpty} ${styles.functionPortEmptyOutput}`}>
                {signal ? 'No parameters' : 'Select a signal'}
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
