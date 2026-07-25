import { useEffect, useState } from 'react';
import { StoryNodeType, type ChapterId, type StoryId } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import panelStyles from './Panel.module.css';
import styles from './ResourceBrowser.module.css';

export function ResourceBrowser() {
  const {
    stories,
    activeStoryId,
    activeGraphId,
    nodes,
    newStory,
    openStory,
    switchStory,
    closeStory,
    updateStory,
    addSubstory,
    updateSubstory,
    removeSubstory,
    extractSelectionToSubstory,
  } = useStoryGraphStore();
  const [expandedStories, setExpandedStories] = useState<Set<StoryId>>(
    () => new Set([activeStoryId]),
  );
  const [editingStoryId, setEditingStoryId] = useState<StoryId>();
  const [editingChapterId, setEditingChapterId] = useState<ChapterId>();
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

  useEffect(() => {
    setExpandedStories((current) => new Set(current).add(activeStoryId));
  }, [activeStoryId]);

  const toggleStory = (id: StoryId) => {
    setExpandedStories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const remove = (id: ChapterId) => {
    const error = removeSubstory(id);
    setMessage(error);
  };

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Project Resources</div>
            <div className={styles.storyName}>{stories.length} Stories</div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              title="Open Story"
              onClick={() => void openStory()}
            >
              ▱
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="New Story"
              onClick={newStory}
            >
              +
            </button>
          </div>
        </div>

        <div className={styles.sectionTitle}>Stories</div>
        <div className={styles.storyTree}>
          {stories.map((story) => {
            const storyId = story.document.id;
            const isActiveStory = storyId === activeStoryId;
            const expanded = expandedStories.has(storyId);
            return (
              <div key={storyId} className={styles.storyGroup}>
                <div className={`${styles.storyRow} ${isActiveStory ? styles.activeStory : ''}`}>
                  <button
                    type="button"
                    className={styles.disclosure}
                    aria-label={expanded ? 'Collapse story' : 'Expand story'}
                    onClick={() => toggleStory(storyId)}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>
                  <div
                    className={styles.storySelect}
                    role="button"
                    tabIndex={0}
                    onClick={() => switchStory(storyId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') switchStory(storyId);
                    }}
                  >
                    <span className={styles.storyIcon}>▰</span>
                    {editingStoryId === storyId && isActiveStory ? (
                      <input
                        autoFocus
                        value={story.document.displayName}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateStory({ displayName: event.target.value })}
                        onBlur={() => setEditingStoryId(undefined)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === 'Escape') {
                            setEditingStoryId(undefined);
                          }
                        }}
                      />
                    ) : (
                      <span className={styles.resourceText}>
                        <strong>{story.document.displayName}</strong>
                        <small>{story.document.filePath ?? 'Unsaved story'}</small>
                      </span>
                    )}
                    {story.document.dirty && <span className={styles.dirtyDot} title="Unsaved" />}
                  </div>
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      title="Rename"
                      onClick={() => {
                        switchStory(storyId);
                        setEditingStoryId(storyId);
                      }}
                    >
                      ✎
                    </button>
                    {isActiveStory && (
                      <button type="button" title="Add Substory" onClick={() => addSubstory()}>
                        +
                      </button>
                    )}
                    <button type="button" title="Close Story" onClick={() => closeStory(storyId)}>
                      ×
                    </button>
                  </span>
                </div>

                {expanded && (
                  <div className={styles.blueprintTree}>
                    <button
                      type="button"
                      className={`${styles.resourceRow} ${
                        isActiveStory && activeGraphId === 'root' ? styles.active : ''
                      }`}
                      onClick={() => switchStory(storyId, 'root')}
                    >
                      <span className={styles.graphIcon}>◆</span>
                      <span className={styles.resourceText}>
                        <strong>Main Story</strong>
                        <small>Root Blueprint</small>
                      </span>
                    </button>

                    {story.chapters.map((chapter) => (
                      <div
                        key={chapter.id}
                        className={`${styles.resourceRow} ${
                          isActiveStory && activeGraphId === chapter.id ? styles.active : ''
                        }`}
                        onClick={() => switchStory(storyId, chapter.id)}
                      >
                        <span className={styles.subgraphIcon}>◇</span>
                        {editingChapterId === chapter.id && isActiveStory ? (
                          <input
                            autoFocus
                            value={chapter.displayName}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              updateSubstory(chapter.id, { displayName: event.target.value })
                            }
                            onBlur={() => setEditingChapterId(undefined)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === 'Escape') {
                                setEditingChapterId(undefined);
                              }
                            }}
                          />
                        ) : (
                          <span className={styles.resourceText}>
                            <strong>{chapter.displayName}</strong>
                            <small>{chapter.name}</small>
                          </span>
                        )}
                        {isActiveStory && (
                          <span className={styles.rowActions}>
                            <button
                              type="button"
                              title="Rename"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingChapterId(chapter.id);
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
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
            {selectedCount} selected node{selectedCount === 1 ? '' : 's'} in active story
          </small>
        </div>

        {message && <div className={styles.message}>{message}</div>}
      </div>
    </div>
  );
}
