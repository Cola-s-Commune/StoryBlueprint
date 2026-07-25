import { useState } from 'react';
import { StoryNodeType, type ChapterId } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import panelStyles from './Panel.module.css';
import styles from './ResourceBrowser.module.css';

export function ResourceBrowser() {
  const {
    document,
    chapters,
    activeGraphId,
    nodes,
    switchGraph,
    addSubstory,
    updateSubstory,
    removeSubstory,
    extractSelectionToSubstory,
  } = useStoryGraphStore();
  const [editingId, setEditingId] = useState<ChapterId>();
  const [message, setMessage] = useState<string>();
  const selectedCount = nodes.filter((node) => node.selected).length;
  const extractableSelection =
    selectedCount > 0 &&
    nodes
      .filter((node) => node.selected)
      .every(
        (node) =>
          node.type !== StoryNodeType.Start &&
          node.type !== StoryNodeType.End &&
          node.type !== StoryNodeType.Return,
      );

  const remove = (id: ChapterId) => {
    const error = removeSubstory(id);
    setMessage(error);
  };

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Story Asset</div>
            <div className={styles.storyName}>{document.displayName}</div>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            title="Add Substory"
            onClick={() => {
              setMessage(undefined);
              addSubstory();
            }}
          >
            +
          </button>
        </div>

        <div className={styles.sectionTitle}>Blueprints</div>
        <button
          type="button"
          className={`${styles.resourceRow} ${activeGraphId === 'root' ? styles.active : ''}`}
          onClick={() => switchGraph('root')}
        >
          <span className={styles.graphIcon}>◆</span>
          <span className={styles.resourceText}>
            <strong>Main Story</strong>
            <small>Root Blueprint</small>
          </span>
        </button>

        {chapters.map((chapter) => (
          <div
            key={chapter.id}
            className={`${styles.resourceRow} ${activeGraphId === chapter.id ? styles.active : ''}`}
            onClick={() => switchGraph(chapter.id)}
          >
            <span className={styles.subgraphIcon}>◇</span>
            {editingId === chapter.id ? (
              <input
                autoFocus
                value={chapter.displayName}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  updateSubstory(chapter.id, { displayName: event.target.value })
                }
                onBlur={() => setEditingId(undefined)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') setEditingId(undefined);
                }}
              />
            ) : (
              <span className={styles.resourceText}>
                <strong>{chapter.displayName}</strong>
                <small>{chapter.name}</small>
              </span>
            )}
            <span className={styles.rowActions}>
              <button
                type="button"
                title="Rename"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingId(chapter.id);
                }}
              >
                ✎
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(chapter.id);
                }}
              >
                ×
              </button>
            </span>
          </div>
        ))}

        <div className={styles.actions}>
          <button
            type="button"
            disabled={!extractableSelection}
            onClick={() => {
              const result = extractSelectionToSubstory();
              setMessage(
                result.ok ? 'Selection extracted. Open it from Blueprints.' : result.message,
              );
            }}
          >
            Extract Selection to Substory
          </button>
          <small>
            {selectedCount} selected node{selectedCount === 1 ? '' : 's'}
          </small>
        </div>

        {message && <div className={styles.message}>{message}</div>}
      </div>
    </div>
  );
}
