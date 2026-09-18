import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { InkBlockNodeData } from '@story-blueprint/common';
import styles from './Node.module.css';

const previewLineLimit = 4;
const previewCharacterLimit = 88;

function previewLines(source: string): { lines: string[]; remaining: number } {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => (line.length > previewCharacterLimit ? `${line.slice(0, previewCharacterLimit - 1)}…` : line));
  if (lines.length === 0) return { lines: ['No Ink source yet…'], remaining: 0 };
  return {
    lines: lines.slice(0, previewLineLimit),
    remaining: Math.max(0, lines.length - previewLineLimit),
  };
}

export function InkBlockNode({ data }: NodeProps) {
  const ink = data as unknown as InkBlockNodeData;
  const lineCount =
    ink.sourceMode === 'embedded' && ink.source ? ink.source.split(/\r?\n/).length : '↗';
  const preview = ink.sourceMode === 'embedded' ? previewLines(ink.source) : undefined;
  return (
    <div
      className={styles.node}
      style={
        {
          '--node-accent': '#9c89eb',
          '--node-accent-soft': 'rgb(156 137 235 / 15%)',
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>Ink Block</span>
        <span className={styles.typeIcon}>{lineCount}</span>
      </div>
      <div className={styles.body}>
        {ink.entryKnot && <label>Entry: {ink.entryKnot}</label>}
        {preview ? (
          <div className={styles.inkPreview}>
            {preview.lines.map((line, index) => (
              <div className={styles.inkPreviewLine} key={`${index}-${line}`}>
                {line}
              </div>
            ))}
            {preview.remaining > 0 && (
              <div className={styles.inkPreviewMore}>+{preview.remaining} lines</div>
            )}
          </div>
        ) : (
          <div className={styles.field}>
            {ink.sourceMode === 'linked' ? ink.path : 'No Ink source yet…'}
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
