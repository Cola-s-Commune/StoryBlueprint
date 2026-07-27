import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DialogueNodeData } from '@story-blueprint/common';
import type { CSSProperties } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './Node.module.css';

export function DialogueNode({ data }: NodeProps) {
  const d = data as unknown as DialogueNodeData;
  const { characters } = useStoryGraphStore();
  const visibleLines = d.lines.slice(0, 3);
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#42a5f5',
          '--node-accent-soft': 'rgb(66 165 245 / 14%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Dialogue</span>
        <span className={styles.typeIcon}>{d.lines.length}</span>
      </div>
      <div className={styles.dialogueLines}>
        {visibleLines.map((line, index) => {
          const speakerId = line.speakerId ?? d.speakerId;
          const speaker =
            characters.find((candidate) => candidate.id === speakerId)?.displayName || 'Narrator';
          return (
            <div key={line.id} className={styles.dialogueLine}>
              <div className={styles.dialogueLineMeta}>
                <span>{index + 1}</span>
                <strong>{speaker}</strong>
              </div>
              <div className={styles.dialogueText}>
                {line.text.source || 'No dialogue text yet…'}
              </div>
            </div>
          );
        })}
        {d.lines.length > visibleLines.length && (
          <div className={styles.moreLines}>+{d.lines.length - visibleLines.length} more lines</div>
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
