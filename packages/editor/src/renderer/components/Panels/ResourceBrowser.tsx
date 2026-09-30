import { useEffect, useMemo, useRef, useState } from 'react';
import { StoryNodeType, type ChapterId, type StoryId } from '@story-blueprint/common';
import type { WorkspaceEntry } from '../../../shared/electronApi';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import {
  IconBuild,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconFileOpen,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconGitInit,
  IconMainGraph,
  IconNewProject,
  IconOpenProject,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconReveal,
  IconSaveAll,
  IconStory,
  IconSubGraph,
  IconSyncProject,
  IconTrash,
} from './ResourceIcons';
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
  onReveal: (relativePath: string) => void;
  onDelete: (entry: WorkspaceEntry) => void;
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
  onReveal,
  onDelete,
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
              {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
            </button>
            <button
              type="button"
              className={styles.fileSelect}
              onClick={() => onSelectDirectory(entry.relativePath)}
              onDoubleClick={() => onToggleDirectory(entry.relativePath)}
            >
              <span className={styles.folderIcon}>
                {isExpanded ? <IconFolderOpen /> : <IconFolder />}
              </span>
              <span>{entry.name}</span>
            </button>
            <span className={styles.fileActions}>
              <button
                type="button"
                title="Show in File Explorer"
                onClick={() => onReveal(entry.relativePath)}
              >
                <IconReveal />
              </button>
            </span>
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
              onReveal={onReveal}
              onDelete={onDelete}
            />
          )}
        </div>
      );
    }

    if (entry.kind === 'project' || entry.kind === 'localization') {
      const isLocalization = entry.kind === 'localization';
      return (
        <div
          key={entry.relativePath}
          className={styles.fileRow}
          style={{ paddingLeft: 26 + depth * 13 }}
          title={isLocalization ? 'Project localization table' : 'Story Blueprint project index'}
        >
          <span className={styles.projectFileIcon}>{isLocalization ? 'L' : 'P'}</span>
          <span className={styles.fileName}>{entry.name}</span>
          <span className={styles.fileActions}>
            <button
              type="button"
              title="Show in File Explorer"
              onClick={() => onReveal(entry.relativePath)}
            >
              <IconReveal />
            </button>
            {!isLocalization && (
              <button type="button" title="Delete Project File" onClick={() => onDelete(entry)}>
                <IconTrash />
              </button>
            )}
          </span>
        </div>
      );
    }

    if (entry.kind === 'ink') {
      return (
        <div
          key={entry.relativePath}
          className={styles.fileRow}
          style={{ paddingLeft: 26 + depth * 13 }}
          title="Linked Ink source"
        >
          <span className={styles.projectFileIcon}>I</span>
          <span className={styles.fileName}>{entry.name}</span>
          <span className={styles.fileActions}>
            <button
              type="button"
              title="Show in File Explorer"
              onClick={() => onReveal(entry.relativePath)}
            >
              <IconReveal />
            </button>
          </span>
        </div>
      );
    }

    if (
      entry.kind === 'character' ||
      entry.kind === 'character-template' ||
      entry.kind === 'asset'
    ) {
      const isCharacter = entry.kind === 'character';
      const isTemplate = entry.kind === 'character-template';
      return (
        <div
          key={entry.relativePath}
          className={styles.fileRow}
          style={{ paddingLeft: 26 + depth * 13 }}
          title={
            isCharacter
              ? 'Project character resource'
              : isTemplate
                ? 'Character template'
                : 'Project asset resource'
          }
        >
          <span
            className={
              isCharacter
                ? styles.characterFileIcon
                : isTemplate
                  ? styles.templateFileIcon
                  : styles.assetFileIcon
            }
          >
            {isCharacter ? 'C' : isTemplate ? 'T' : 'A'}
          </span>
          <span className={styles.fileName}>{entry.name}</span>
          <span className={styles.fileActions}>
            <button
              type="button"
              title="Show in File Explorer"
              onClick={() => onReveal(entry.relativePath)}
            >
              <IconReveal />
            </button>
            {!isTemplate && (
              <button
                type="button"
                title={`Delete ${isCharacter ? 'Character' : 'Asset'}`}
                onClick={() => onDelete(entry)}
              >
                <IconTrash />
              </button>
            )}
          </span>
        </div>
      );
    }

    const isActive = filePath === activeFilePath;
    return (
      <div
        key={entry.relativePath}
        className={`${styles.fileRow} ${isActive ? styles.activeFile : ''}`}
        style={{ paddingLeft: 26 + depth * 13 }}
      >
        <button
          type="button"
          className={styles.fileOpen}
          onClick={() => onOpenStory(entry.relativePath)}
        >
          <span className={styles.storyFileIcon}>S</span>
          <span className={styles.fileName}>{entry.name}</span>
          {loadedFilePaths.has(filePath) && <span className={styles.openMarker}>●</span>}
        </button>
        <span className={styles.fileActions}>
          <button
            type="button"
            title="Show in File Explorer"
            onClick={() => onReveal(entry.relativePath)}
          >
            <IconReveal />
          </button>
          <button type="button" title="Delete Story File" onClick={() => onDelete(entry)}>
            <IconTrash />
          </button>
        </span>
      </div>
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
    revealStoryFile,
    deleteStoryFile,
    updateStory,
    removeCharacter,
    removeAsset,
    findCharacterReferences,
    findAssetReferences,
    selectStoryData,
    addSubstory,
    updateSubstory,
    removeSubstory,
    extractSelectionToSubstory,
    openWorkspace,
    openProject,
    newProject,
    refreshWorkspace,
    initializeWorkspaceGit,
    revealWorkspaceItem,
    deleteWorkspaceStory,
    deleteWorkspaceProject,
    openWorkspaceStory,
    createWorkspaceDirectory,
    createWorkspaceStory,
    createWorkspaceProject,
    syncWorkspaceProject,
    saveAllStories,
    buildProject,
    updateProjectSettings,
  } = useStoryGraphStore();
  const [expandedStories, setExpandedStories] = useState<Set<StoryId>>(
    () => new Set(activeStoryId ? [activeStoryId] : []),
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [selectedDirectory, setSelectedDirectory] = useState('');
  const [editingStoryId, setEditingStoryId] = useState<StoryId>();
  const [storyNameDraft, setStoryNameDraft] = useState('');
  const cancelStoryRenameRef = useRef(false);
  const [editingChapterId, setEditingChapterId] = useState<ChapterId>();
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const cancelChapterRenameRef = useRef(false);
  const [creation, setCreation] = useState<{
    kind: 'story' | 'directory' | 'project';
    name: string;
  }>();
  const [message, setMessage] = useState<string>();
  const [outputDirectory, setOutputDirectory] = useState('');
  const selectedCount = nodes.filter((node) => node.selected).length;
  const activeStory = stories.find((story) => story.document.id === activeStoryId);
  const hasProjectFile = Boolean(workspace?.project || workspace?.projectError);
  const visibleMessage =
    workspaceError ?? workspace?.projectError ?? workspace?.resourceErrors[0]?.message ?? message;
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

  useEffect(() => {
    setOutputDirectory(workspace?.project?.outputDirectory ?? '');
  }, [workspace?.project?.outputDirectory]);

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

  const deleteWorkspaceEntry = (entry: WorkspaceEntry) => {
    if (entry.kind === 'story') {
      const loadedStoryId = loadedByPath.get(resolveFilePath(entry.relativePath));
      if (loadedStoryId) void deleteStoryFile(loadedStoryId);
      else void deleteWorkspaceStory(entry.relativePath);
      return;
    }
    if (entry.kind === 'project') {
      void deleteWorkspaceProject(entry.relativePath);
      return;
    }
    if (entry.kind === 'character') {
      const resource = workspace?.characterResources.find(
        (candidate) => candidate.relativePath === entry.relativePath,
      );
      if (resource) {
        if (findCharacterReferences(resource.character.id).length > 0) {
          selectStoryData({ kind: 'character', id: resource.character.id });
          setMessage('Choose Delete Character in Inspector to replace or clear its references.');
        } else {
          removeCharacter(resource.character.id);
        }
      } else if (!resource && window.electronAPI) {
        void window.electronAPI
          .deleteProjectCharacter(entry.relativePath)
          .then((result) => (result.canceled ? undefined : refreshWorkspace()))
          .catch((error: unknown) =>
            setMessage(error instanceof Error ? error.message : String(error)),
          );
      }
      return;
    }
    if (entry.kind === 'asset') {
      const resource = workspace?.assetResources.find(
        (candidate) => candidate.relativePath === entry.relativePath,
      );
      if (resource) {
        if (findAssetReferences(resource.asset.id).length > 0) {
          selectStoryData({ kind: 'asset', id: resource.asset.id });
          setMessage('Choose Delete Asset in Inspector to replace or clear its references.');
        } else {
          removeAsset(resource.asset.id);
        }
      } else if (
        !resource &&
        window.confirm(`Delete asset file "${entry.name}"? This cannot be undone.`)
      ) {
        void window.electronAPI
          ?.deleteProjectAsset(entry.relativePath)
          .then(() => refreshWorkspace())
          .catch((error: unknown) =>
            setMessage(error instanceof Error ? error.message : String(error)),
          );
      }
    }
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
              <IconNewProject />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="Open Project"
              onClick={() => void openProject()}
            >
              <IconOpenProject />
            </button>
            {workspace && (
              <button
                type="button"
                className={styles.iconButton}
                title="Refresh Workspace"
                onClick={() => void refreshWorkspace()}
              >
                <IconRefresh />
              </button>
            )}
            <button
              type="button"
              className={styles.iconButton}
              title="Open Folder"
              onClick={() => void openWorkspace()}
            >
              <IconFolderOpen />
            </button>
          </div>
        </div>
        {workspace?.project && (
          <div className={styles.projectBlock}>
            <div className={styles.projectSummary}>
              <span>{workspace.project.stories.length} Stories</span>
              <span>{workspace.project.characters.length} Characters</span>
              <span>{workspace.project.assets.length} Assets</span>
              {workspace.git.initialized && (
                <span
                  className={styles.gitStatus}
                  title={`Repository: ${workspace.git.repositoryRoot ?? workspace.rootPath}`}
                >
                  <IconGitBranch />
                  <span>
                    {workspace.git.branch ??
                      (workspace.git.headRevision
                        ? `detached @ ${workspace.git.headRevision.slice(0, 7)}`
                        : 'unborn')}
                  </span>
                </span>
              )}
              <div className={styles.projectSummaryActions}>
                {!workspace.git.initialized && (
                  <button
                    type="button"
                    className={styles.gitInitializeButton}
                    title={
                      workspace.git.available
                        ? 'Initialize Git repository'
                        : 'Git is not installed or unavailable on PATH'
                    }
                    onClick={() => void initializeWorkspaceGit()}
                  >
                    <IconGitInit />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.buildButton}
                  title="Build Project"
                  onClick={() => void buildProject()}
                >
                  <IconBuild />
                </button>
              </div>
            </div>
            <div className={styles.projectSettings}>
              <label>
                <span>Entry</span>
                <select
                  value={workspace.project.entryStoryId ?? workspace.project.stories[0]?.id ?? ''}
                  onChange={(event) =>
                    void updateProjectSettings({ entryStoryId: event.target.value as StoryId })
                  }
                >
                  {workspace.project.stories.map((story) => (
                    <option value={story.id} key={story.id}>
                      {story.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Output</span>
                <input
                  value={outputDirectory}
                  placeholder="Choose on build"
                  onChange={(event) => setOutputDirectory(event.target.value)}
                  onBlur={() => {
                    if (outputDirectory !== (workspace.project?.outputDirectory ?? '')) {
                      void updateProjectSettings({ outputDirectory });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
            </div>
          </div>
        )}

        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Open Stories</span>
          <span className={styles.sectionActions}>
            <button type="button" title="Save All Stories" onClick={() => void saveAllStories()}>
              <IconSaveAll />
            </button>
            <button type="button" title="Open Story File" onClick={() => void openStory()}>
              <IconFileOpen />
            </button>
            <button type="button" title="New Unsaved Story" onClick={newStory}>
              <IconPlus />
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
                    {expanded ? <IconChevronDown /> : <IconChevronRight />}
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
                    <span className={styles.storyIcon}>
                      <IconStory />
                    </span>
                    {editingStoryId === storyId && isActiveStory ? (
                      <input
                        autoFocus
                        value={storyNameDraft}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setStoryNameDraft(event.target.value)}
                        onBlur={() => {
                          if (!cancelStoryRenameRef.current) {
                            const displayName = storyNameDraft.trim();
                            if (displayName) updateStory({ displayName });
                          }
                          cancelStoryRenameRef.current = false;
                          setEditingStoryId(undefined);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            cancelStoryRenameRef.current = true;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      <span className={styles.resourceText}>
                        <strong>{story.document.displayName}</strong>
                        <small>{story.document.filePath ?? 'Unsaved story'}</small>
                      </span>
                    )}
                    {story.document.gitConflict && (
                      <span
                        className={styles.conflictDot}
                        title="Git conflict · Open Story Merge"
                      />
                    )}
                    {story.document.dirty && <span className={styles.dirtyDot} title="Unsaved" />}
                  </div>
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      title="Rename Story Title"
                      onClick={() => {
                        switchStory(storyId);
                        cancelStoryRenameRef.current = false;
                        setStoryNameDraft(story.document.displayName);
                        setEditingStoryId(storyId);
                      }}
                    >
                      <IconPencil />
                    </button>
                    {isActiveStory && (
                      <button type="button" title="Add Substory" onClick={() => addSubstory()}>
                        <IconPlus />
                      </button>
                    )}
                    {story.document.filePath && story.document.fileToken && (
                      <>
                        <button
                          type="button"
                          title="Show in File Explorer"
                          onClick={() => void revealStoryFile(storyId)}
                        >
                          <IconReveal />
                        </button>
                        <button
                          type="button"
                          title="Delete Story File"
                          onClick={() => void deleteStoryFile(storyId)}
                        >
                          <IconTrash />
                        </button>
                      </>
                    )}
                    <button type="button" title="Close Story" onClick={() => closeStory(storyId)}>
                      <IconClose />
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
                      <span className={styles.graphIcon}>
                        <IconMainGraph />
                      </span>
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
                        <span className={styles.subgraphIcon}>
                          <IconSubGraph />
                        </span>
                        {editingChapterId === chapter.id && isActiveStory ? (
                          <input
                            autoFocus
                            value={chapterNameDraft}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setChapterNameDraft(event.target.value)}
                            onBlur={() => {
                              if (!cancelChapterRenameRef.current) {
                                const displayName = chapterNameDraft.trim();
                                if (displayName) updateSubstory(chapter.id, { displayName });
                              }
                              cancelChapterRenameRef.current = false;
                              setEditingChapterId(undefined);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                              if (event.key === 'Escape') {
                                cancelChapterRenameRef.current = true;
                                event.currentTarget.blur();
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
                              title="Rename Substory Title"
                              onClick={(event) => {
                                event.stopPropagation();
                                cancelChapterRenameRef.current = false;
                                setChapterNameDraft(chapter.displayName);
                                setEditingChapterId(chapter.id);
                              }}
                            >
                              <IconPencil />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                remove(chapter.id);
                              }}
                            >
                              <IconTrash />
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
                  <IconSyncProject />
                </button>
              ) : (
                <button type="button" title="Create Project File" onClick={addWorkspaceProject}>
                  <IconNewProject />
                </button>
              )}
              <button
                type="button"
                title="New Story in Selected Folder"
                onClick={addWorkspaceStory}
              >
                <IconFilePlus />
              </button>
              <button type="button" title="New Folder in Selected Folder" onClick={addFolder}>
                <IconFolderPlus />
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
              {creation.kind === 'story' ? (
                'S'
              ) : creation.kind === 'project' ? (
                'P'
              ) : (
                <IconFolder />
              )}
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
            <button type="submit" disabled={!creation.name.trim()} title="Confirm">
              <IconCheck />
            </button>
            <button type="button" onClick={() => setCreation(undefined)} title="Cancel">
              <IconClose />
            </button>
          </form>
        )}
        {workspace ? (
          <div className={styles.workspaceTree}>
            <div
              className={`${styles.workspaceRoot} ${
                selectedDirectory === '' ? styles.selectedFile : ''
              }`}
            >
              <button
                type="button"
                className={styles.workspaceRootSelect}
                onClick={() => setSelectedDirectory('')}
              >
                <span className={styles.folderIcon}>
                  <IconFolderOpen />
                </span>
                <strong>{workspace.name}</strong>
              </button>
              <span className={styles.fileActions}>
                <button
                  type="button"
                  title="Show Workspace in File Explorer"
                  onClick={() => void revealWorkspaceItem('')}
                >
                  <IconReveal />
                </button>
              </span>
            </div>
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
              onReveal={(relativePath) => void revealWorkspaceItem(relativePath)}
              onDelete={deleteWorkspaceEntry}
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

        {visibleMessage && (
          <div className={styles.message}>
            <span>{visibleMessage}</span>
            <CopyButton text={visibleMessage} />
          </div>
        )}
      </div>
    </div>
  );
}
