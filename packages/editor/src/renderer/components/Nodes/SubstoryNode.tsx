import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { CallSubstoryNodeData } from '@story-blueprint/common';
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
        {chapter?.displayName ?? (d.chapterId ? 'Missing Substory' : 'Select Substory')}
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

export function ReturnNode() {
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
      <div className={styles.terminalBody}>Return to caller</div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
    </div>
  );
}
