import { Handle, Position, type NodeProps } from '@xyflow/react';
import { StoryNodeType, type ValueType } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { valueTypeColor } from '../../graph/valueTypeColors';
import styles from './Node.module.css';

const labels: Record<string, string> = {
  [StoryNodeType.StartStory]: 'Start Story',
  [StoryNodeType.SwitchStory]: 'Switch Story',
  [StoryNodeType.ResumeStory]: 'Resume Story',
  [StoryNodeType.EndStoryInstance]: 'End Story Instance',
};

export function StoryControlNode({ type, data }: NodeProps) {
  const control = data as unknown as {
    storyId?: string;
    instanceId?: { source: string };
    waitForCompletion?: boolean;
    arguments?: Record<string, unknown>;
  };
  const { stories } = useStoryGraphStore();
  const hasOutput = true;
  const storyId = 'storyId' in control ? control.storyId : undefined;
  const instanceId = control.instanceId?.source;
  const title = labels[type] ?? 'Story Control';

  const argumentsRecord =
    'arguments' in control && typeof control.arguments === 'object' && control.arguments
      ? (control.arguments as Record<string, unknown>)
      : {};
  const isStartOrSwitch = type === StoryNodeType.StartStory || type === StoryNodeType.SwitchStory;

  const targetStory = stories.find((s) => s.document.id === storyId);
  const targetVariables = targetStory?.variables ?? [];
  const argumentInputTypes =
    'argumentInputTypes' in control &&
    typeof control.argumentInputTypes === 'object' &&
    control.argumentInputTypes
      ? (control.argumentInputTypes as Record<string, ValueType>)
      : undefined;

  const parameterItems: Array<{ id: string; label: string; valueType: ValueType }> =
    isStartOrSwitch
      ? Object.keys(argumentsRecord).map((k) => {
          const matchedVar = targetVariables.find((v: { id: string; name: string }) => v.id === k || v.name === k);
          const valueType =
            argumentInputTypes?.[k] ?? matchedVar?.valueType ?? ({ kind: 'any' } as ValueType);
          return {
            id: k,
            label: matchedVar?.name ?? k,
            valueType,
          };
        })
      : [];

  return (
    <div
      className={`${styles.node} ${parameterItems.length > 0 ? styles.functionNode : ''}`}
      style={
        {
          '--node-accent': type === StoryNodeType.EndStoryInstance ? '#c75f5f' : '#3f9a80',
          '--node-accent-soft':
            type === StoryNodeType.EndStoryInstance
              ? 'rgb(199 95 95 / 14%)'
              : 'rgb(63 154 128 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.typeIcon}>↔</span>
      </div>
      <div className={styles.terminalBody}>
        <strong>
          {storyId ?? (instanceId ? `Instance: ${instanceId}` : 'Configure in Inspector')}
        </strong>
        {'waitForCompletion' in control && control.waitForCompletion && (
          <small>Wait for completion</small>
        )}
      </div>
      {parameterItems.length > 0 && (
        <div className={styles.functionBody}>
          <div className={styles.functionPorts}>
            <section className={styles.functionPortColumn} aria-label="Story arguments">
              {parameterItems.map((param) => (
                <div className={styles.functionPortRow} key={param.id}>
                  <Handle
                    className={`${styles.dataHandle} ${styles.dataHandleInput}`}
                    type="target"
                    position={Position.Left}
                    id={`argument:${param.id}`}
                    style={
                      { '--data-pin-color': valueTypeColor(param.valueType) } as CSSProperties
                    }
                  />
                  <span>{param.label}</span>
                  <em>{param.valueType.kind}</em>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      {hasOutput && (
        <Handle
          className={`${styles.handle} ${styles.handleOutput}`}
          type="source"
          position={Position.Right}
          id="out"
        />
      )}
    </div>
  );
}
