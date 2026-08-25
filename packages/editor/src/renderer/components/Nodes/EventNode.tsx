import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { CallEventNodeData, WaitSignalNodeData } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './Node.module.css';

export function CallEventNode({ data }: NodeProps) {
  const call = data as unknown as CallEventNodeData;
  const { events } = useStoryGraphStore();
  const event = events.find((candidate) => candidate.id === call.eventId);
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#d979b5',
          '--node-accent-soft': 'rgb(217 121 181 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Call Event</span>
        <span className={styles.typeIcon}>⚡</span>
      </div>
      <div className={styles.terminalBody}>
        <strong>{event?.displayName ?? (call.eventId ? 'Missing Event' : 'Select Event')}</strong>
        {(event?.parameters.length ?? 0) > 0 && (
          <div className={styles.interfaceRows}>
            {event!.parameters.map((parameter) => (
              <span key={parameter.name}>
                <b>IN</b> {parameter.name}
                <em>{parameter.valueType.kind}</em>
                <Handle
                  className={`${styles.handle} ${styles.dataHandle} ${styles.dataHandleInput}`}
                  type="target"
                  position={Position.Left}
                  id={`argument:${parameter.name}`}
                />
              </span>
            ))}
          </div>
        )}
        {(event?.outputs?.length ?? 0) > 0 && (
          <div className={styles.interfaceRows}>
            {event!.outputs!.map((output) => (
              <span key={output.id}>
                <b>OUT</b> {output.displayName}
                <em>
                  {output.valueType.kind}
                  {call.resultVariableIds?.[output.id] ? ' · stored' : ''}
                </em>
              </span>
            ))}
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

export function WaitSignalNode({ data }: NodeProps) {
  const wait = data as unknown as WaitSignalNodeData;
  const { signals } = useStoryGraphStore();
  const signal = signals.find((candidate) => candidate.id === wait.signalId);
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#8c6ed8',
          '--node-accent-soft': 'rgb(140 110 216 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Wait for Signal</span>
        <span className={styles.typeIcon}>◉</span>
      </div>
      <div className={styles.terminalBody}>
        {signal?.displayName ?? (wait.signalId ? 'Missing Signal' : 'Select Signal')}
        {Object.keys(wait.matches ?? {}).length > 0
          ? ` · ${Object.keys(wait.matches).length} filter${Object.keys(wait.matches).length === 1 ? '' : 's'}`
          : ''}
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
