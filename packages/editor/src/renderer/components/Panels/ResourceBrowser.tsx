import { useEffect, useMemo, useState } from 'react';
import { StoryNodeType, type ChapterId, type StoryId } from '@story-blueprint/common';
import type { WorkspaceEntry } from '../../../shared/electronApi';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import panelStyles from './Panel.module.css';
import styles from './ResourceBrowser.module.css';

interface WorkspaceTreeProps {
  entries: WorkspaceEntry[];
  depth: number;
  expanded: Set<string>;
  selectedDirectory: string;
  activeFilePath?: string;
  loadedFilePaths: Set<string>;
  resolveFilePath: (relativePath: string) => string;
  onToggleDirectory: (relativePath: string) => void;
  onSelectDirectory: (relativePath: string) => void;
  onOpenStory: (relativePath: string) => void;
}

function WorkspaceTree({
  entries,
  depth,
  expanded,
  selectedDirectory,
  activeFilePath,
  loadedFilePaths,
  resolveFilePath,
  onToggleDirectory,
  onSelectDirectory,
  onOpenStory,
}: WorkspaceTreeProps) {
  return entries.map((entry) => {
    const filePath = resolveFilePath(entry.relativePath);
    if (entry.kind === 'directory') {
      const isExpanded = expanded.has(entry.relativePath);
      return (
        <div key={entry.relativePath}>
          <div
            className={`${styles.fileRow} ${
              selectedDirectory === entry.relativePath ? styles.selectedFile : ''
            }`}
            style={{ paddingLeft: 6 + depth * 13 }}
          >
            <button
              type="button"
              className={styles.fileDisclosure}
              aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
              onClick={() => onToggleDirectory(entry.relativePath)}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
            <button
              type="button"
              className={styles.fileSelect}
              onClick={() => onSelectDirectory(entry.relativePath)}
              onDoubleClick={() => onToggleDirectory(entry.relativePath)}
            >
              <span className={styles.folderIcon}>{isExpanded ? '▾' : '▸'}</span>
              <span>{entry.name}</span>
            </button>
          </div>
          {isExpanded && entry.children && (
            <WorkspaceTree
              entries={entry.children}
              depth={depth + 1}
              expanded={expanded}
              selectedDirectory={selectedDirectory}
              activeFilePath={activeFilePath}
              loadedFilePaths={loadedFilePaths}
              resolveFilePath={resolveFilePath}
              onToggleDirectory={onToggleDirectory}
              onSelectDirectory={onSelectDirectory}
              onOpenStory={onOpenStory}
            />
          )}
        </div>
      );
    }

    if (entry.kind === 'project') {
      return (
        <div
          key={entry.relativePath}
          className={styles.fileRow}
          style={{ paddingLeft: 26 + depth * 13 }}
          title="Story Blueprint project index"
        >
          <span className={styles.projectFileIcon}>P</span>
          <span className={styles.fileName}>{entry.name}</span>
        </div>
      );
    }

    const isActive = filePath === activeFilePath;
    return (
      <button
        key={entry.relativePath}
        type="button"
        className={`${styles.fileRow} ${isActive ? styles.activeFile : ''}`}
        style={{ paddingLeft: 26 + depth * 13 }}
        onClick={() => onOpenStory(entry.relativePath)}
      >
        <span className={styles.storyFileIcon}>S</span>
        <span className={styles.fileName}>{entry.name}</span>
        {loadedFilePaths.has(filePath) && <span className={styles.openMarker}>●</span>}
      </button>
    );
  });
}

function normalizePath(value?: string): string | undefined {
  return value?.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function ResourceBrowser() {
  const {
    stories,
    activeStoryId,
    activeGraphId,
    nodes,
    workspace,
    workspaceError,
    newStory,
    openStory,
    switchStory,
    closeStory,
    updateStory,
    addSubstory,
    updateSubstory,
    removeSubstory,
    extractSelectionToSubstory,
    openWorkspace,
    openProject,
    newProject,
    refreshWorkspace,
    openWorkspaceStory,
    createWorkspaceDirectory,
    createWorkspaceStory,
    createWorkspaceProject,
    syncWorkspaceProject,
    saveAllStories,
  } = useStoryGraphStore();
  const [expandedStories, setExpandedStories] = useState<Set<StoryId>>(
    () => new Set(activeStoryId ? [activeStoryId] : []),
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [selectedDirectory, setSelectedDirectory] = useState('');
  const [editingStoryId, setEditingStoryId] = useState<StoryId>();
  const [editingChapterId, setEditingChapterId] = useState<ChapterId>();
  const [creation, setCreation] = useState<{
    kind: 'story' | 'directory' | 'project';
    name: string;
  }>();
  const [message, setMessage] = useState<string>();
  const selectedCount = nodes.filter((node) => node.selected).length;
  const activeStory = stories.find((story) => story.document.id === activeStoryId);
  const hasProjectFile = Boolean(workspace?.project || workspace?.projectError);
  const activeFilePath = normalizePath(activeStory?.document.filePath);
  const loadedByPath = useMemo(
    () =>
      new Map(
        stories
          .filter((story) => story.document.filePath)
          .map((story) => [normalizePath(story.document.filePath)!, story.document.id]),
      ),
    [stories],
  );
  const loadedFilePaths = useMemo(() => new Set(loadedByPath.keys()), [loadedByPath]);
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
    if (activeStoryId) setExpandedStories((current) => new Set(current).add(activeStoryId));
  }, [activeStoryId]);

  useEffect(() => {
    setSelectedDirectory('');
    setExpandedDirectories(new Set());
  }, [workspace?.rootPath]);

  const resolveFilePath = (relativePath: string) =>
    normalizePath(`${workspace?.rootPath ?? ''}/${relativePath}`) ?? '';

  const toggleStory = (id: StoryId) => {
    setExpandedStories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDirectory = (relativePath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  };

  const openWorkspaceFile = (relativePath: string) => {
    const loadedStoryId = loadedByPath.get(resolveFilePath(relativePath));
    if (loadedStoryId) switchStory(loadedStoryId);
    else void openWorkspaceStory(relativePath);
  };

  const addFolder = () => {
    setCreation({ kind: 'directory', name: '' });
  };

  const addWorkspaceStory = () => {
    setCreation({ kind: 'story', name: '' });
  };

  const addWorkspaceProject = () => {
    setSelectedDirectory('');
    setCreation({ kind: 'project', name: workspace?.name ?? '' });
  };

  const submitCreation = () => {
    if (!creation?.name.trim()) return;
    if (creation.kind === 'project') {
      void createWorkspaceProject(creation.name.trim());
    } else if (creation.kind === 'story') {
      void createWorkspaceStory(selectedDirectory, creation.name.trim());
    } else {
      void createWorkspaceDirectory(selectedDirectory, creation.name.trim());
    }
    if (selectedDirectory) {
      setExpandedDirectories((current) => new Set(current).add(selectedDirectory));
    }
    setCreation(undefined);
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
            <div className={styles.eyebrow}>{hasProjectFile ? 'Story Project' : 'Workspace'}</div>
            <div className={styles.storyName}>
              {workspace?.project?.displayName ?? workspace?.name ?? 'No Folder Open'}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              title="New Project"
              onClick={() => void newProject()}
            >
              P+
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="Open Project"
              onClick={() => void openProject()}
            >
              P
            </button>
            {workspace && (
              <button
                type="button"
                className={styles.iconButton}
                title="Refresh Workspace"
                onClick={() => void refreshWorkspace()}
              >
                ↻
              </button>
            )}
            <button
              type="button"
              className={styles.iconButton}
              title="Open Folder"
              onClick={() => void openWorkspace()}
            >
              ▱
            </button>
          </div>
        </div>
        {workspace?.project && (
          <div className={styles.projectSummary}>
            <span>{workspace.project.stories.length} Stories</span>
            <span>{workspace.project.characters.length} Characters</span>
            <span>{workspace.project.assets.length} Assets</span>
          </div>
        )}

        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Open Stories</span>
          <span className={styles.sectionActions}>
            <button type="button" title="Save All Stories" onClick={() => void saveAllStories()}>
              ⇩
            </button>
            <button type="button" title="Open Story File" onClick={() => void openStory()}>
              ▱
            </button>
            <button type="button" title="New Unsaved Story" onClick={newStory}>
              +
            </button>
          </span>
        </div>
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
                      title="Rename Display Name"
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

        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Explorer</span>
          {workspace && (
            <span className={styles.sectionActions}>
              {hasProjectFile ? (
                <button
                  type="button"
                  title="Synchronize Project Index"
                  onClick={() => void syncWorkspaceProject()}
                >
                  P↻
                </button>
              ) : (
                <button type="button" title="Create Project File" onClick={addWorkspaceProject}>
                  P+
                </button>
              )}
              <button
                type="button"
                title="New Story in Selected Folder"
                onClick={addWorkspaceStory}
              >
                S+
              </button>
              <button type="button" title="New Folder in Selected Folder" onClick={addFolder}>
                ▱+
              </button>
            </span>
          )}
        </div>
        {workspace && creation && (
          <form
            className={styles.creationRow}
            onSubmit={(event) => {
              event.preventDefault();
              submitCreation();
            }}
          >
            <span
              className={
                creation.kind === 'story'
                  ? styles.storyFileIcon
                  : creation.kind === 'project'
                    ? styles.projectFileIcon
                    : styles.folderIcon
              }
            >
              {creation.kind === 'story' ? 'S' : creation.kind === 'project' ? 'P' : '▸'}
            </span>
            <input
              autoFocus
              value={creation.name}
              placeholder={
                creation.kind === 'story'
                  ? 'Story name'
                  : creation.kind === 'project'
                    ? 'Project name'
                    : 'Folder name'
              }
              onChange={(event) => setCreation({ ...creation, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreation(undefined);
              }}
            />
            <button type="submit" disabled={!creation.name.trim()}>
              ✓
            </button>
            <button type="button" onClick={() => setCreation(undefined)}>
              ×
            </button>
          </form>
        )}
        {workspace ? (
          <div className={styles.workspaceTree}>
            <button
              type="button"
              className={`${styles.workspaceRoot} ${
                selectedDirectory === '' ? styles.selectedFile : ''
              }`}
              onClick={() => setSelectedDirectory('')}
            >
              <span className={styles.folderIcon}>▾</span>
              <strong>{workspace.name}</strong>
            </button>
            <WorkspaceTree
              entries={workspace.entries}
              depth={0}
              expanded={expandedDirectories}
              selectedDirectory={selectedDirectory}
              activeFilePath={activeFilePath}
              loadedFilePaths={loadedFilePaths}
              resolveFilePath={resolveFilePath}
              onToggleDirectory={toggleDirectory}
              onSelectDirectory={setSelectedDirectory}
              onOpenStory={openWorkspaceFile}
            />
          </div>
        ) : (
          <button
            type="button"
            className={styles.openFolderCallout}
            onClick={() => void openWorkspace()}
          >
            Open Folder
          </button>
        )}

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

        {(message || workspaceError || workspace?.projectError) && (
          <div className={styles.message}>
            {workspaceError ?? workspace?.projectError ?? message}
          </div>
        )}
      </div>
    </div>
  );
}
