import { useCallback, useState } from 'react';
import { NodeResizer, type NodeProps, type ResizeParams } from '@xyflow/react';
import { StoryNodeType, type CommentNodeData, type NodeId } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './CommentNode.module.css';

const PRESET_COLORS = [
  { label: 'Slate', color: '#2a3b4c' },
  { label: 'Navy', color: '#1b3a5c' },
  { label: 'Forest', color: '#1d4a38' },
  { label: 'Wine', color: '#5c242e' },
  { label: 'Purple', color: '#442656' },
  { label: 'Amber', color: '#523e20' },
  { label: 'Charcoal', color: '#252830' },
];

export function CommentNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as CommentNodeData;
  const { updateNodeData } = useStoryGraphStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(d.title ?? 'Comment');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const currentColor = d.color ?? '#2a3b4c';
  const width = d.width ?? 400;
  const height = d.height ?? 240;

  const handleResizeEnd = useCallback(
    (_event: unknown, params: ResizeParams) => {
      updateNodeData(id as NodeId, StoryNodeType.Comment, {
        width: Math.round(params.width),
        height: Math.round(params.height),
      });
    },
    [id, updateNodeData],
  );

  const saveTitle = useCallback(() => {
    setEditingTitle(false);
    if (titleText.trim() && titleText !== d.title) {
      updateNodeData(id as NodeId, StoryNodeType.Comment, { title: titleText.trim() });
    }
  }, [d.title, id, titleText, updateNodeData]);

  const selectColor = useCallback(
    (color: string) => {
      updateNodeData(id as NodeId, StoryNodeType.Comment, { color });
      setShowColorPicker(false);
    },
    [id, updateNodeData],
  );

  return (
    <div
      className={styles.commentBox}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderColor: currentColor,
        backgroundColor: `${currentColor}2b`,
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={Boolean(selected)}
        lineClassName={styles.resizerLine}
        handleClassName={styles.resizerHandle}
        onResizeEnd={handleResizeEnd}
      />
      <div
        className={styles.header}
        style={{
          backgroundColor: currentColor,
        }}
      >
        <div className={styles.headerTitleArea}>
          {editingTitle ? (
            <input
              type="text"
              className={styles.titleInput}
              value={titleText}
              autoFocus
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') {
                  setTitleText(d.title ?? 'Comment');
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <span
              className={styles.title}
              onDoubleClick={() => {
                setTitleText(d.title || 'Comment');
                setEditingTitle(true);
              }}
              title="Double-click to edit group title"
            >
              {d.title || 'Comment'}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.colorButton}
            style={{ backgroundColor: currentColor }}
            title="Choose comment theme color"
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker((curr) => !curr);
            }}
          />
          {showColorPicker && (
            <div className={styles.colorPalette} onClick={(e) => e.stopPropagation()}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  className={styles.colorOption}
                  style={{ backgroundColor: c.color }}
                  title={c.label}
                  onClick={() => selectColor(c.color)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.body}>
        {d.comment && <div className={styles.commentText}>{d.comment}</div>}
      </div>
    </div>
  );
}
