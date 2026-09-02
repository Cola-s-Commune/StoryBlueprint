import { Handle, Position, type NodeProps } from '@xyflow/react';
import { StoryNodeType, type StoryNodeDataMap } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
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
  };
  const hasOutput = true;
  const storyId = 'storyId' in control ? control.storyId : undefined;
  const instanceId = control.instanceId?.source;
  const title = labels[type] ?? 'Story Control';
  return (
    <div
      className={styles.node}
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
