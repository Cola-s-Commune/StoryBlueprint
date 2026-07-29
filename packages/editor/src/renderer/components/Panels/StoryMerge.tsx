import { useEffect, useMemo, useState } from 'react';
import {
  parseAssetResource,
  parseCharacterResource,
  parseStoryProject,
  parseStorySource,
  serializeAssetResource,
  serializeCharacterResource,
  serializeStoryProject,
  type AssetSource,
  type CharacterSource,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import {
  applyMergedStory,
  diffThreeWayOptionalValues,
  diffThreeWayStoryDocuments,
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
  mergeThreeWayStoryDocuments,
  mergeThreeWayOptionalValues,
  type MergeableStoryDocument,
  type StoryMergeChoice,
  type StoryMergeConflict,
  type StoryMergeDecisions,
} from '../../graph/storyMerge';
import type {
  WorkspaceGitConflictStages,
  WorkspaceMergeResourceKind,
} from '../../../shared/electronApi';
import { CopyButton } from './CopyButton';
import panelStyles from './Panel.module.css';
import styles from './StoryMerge.module.css';

function valueText(value: unknown, present: boolean): string {
  if (!present) return '(not present)';
  if (typeof value === 'string') return value || '(empty string)';
  if (value === undefined) return '(undefined)';
  return JSON.stringify(value, null, 2);
}

type ProjectMergeValue = StoryProjectDocument | CharacterSource | AssetSource;

interface ProjectMergeFile {
  stages: WorkspaceGitConflictStages;
  base?: ProjectMergeValue;
  local?: ProjectMergeValue;
  remote?: ProjectMergeValue;
  atomic: boolean;
}

function parseProjectMergeValue(kind: WorkspaceMergeResourceKind, content: string) {
  if (kind === 'project') return parseStoryProject(content);
  if (kind === 'character') return parseCharacterResource(content);
  return parseAssetResource(content);
}

function serializeProjectMergeValue(kind: WorkspaceMergeResourceKind, value: ProjectMergeValue) {
  if (kind === 'project') return serializeStoryProject(value as StoryProjectDocument);
  if (kind === 'character') return serializeCharacterResource(value as CharacterSource);
  return serializeAssetResource(value as AssetSource);
}

function projectMergeRoot(file: ProjectMergeFile) {
  return `${file.stages.kind}:${file.stages.relativePath}`;
}

function compareProjectMergeFile(file: ProjectMergeFile) {
  const root = projectMergeRoot(file);
  if (file.atomic) {
    const conflict: StoryMergeConflict = {
      id: root,
      path: root,
      kind: !file.local ? 'remote-only' : !file.remote ? 'local-only' : 'changed',
      ...(file.local ? { localValue: file.local } : {}),
      ...(file.remote ? { remoteValue: file.remote } : {}),
    };
    return { conflicts: [conflict], autoMerged: file.local, autoChangeCount: 0 };
  }
  return diffThreeWayOptionalValues(file.base, file.local, file.remote, root);
}

function ProjectResourceMerge() {
  const { workspace, applyWorkspaceMerge } = useStoryGraphStore();
  const [files, setFiles] = useState<ProjectMergeFile[]>([]);
  const [decisions, setDecisions] = useState<Record<string, StoryMergeChoice>>({});
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [applying, setApplying] = useState(false);
  const comparisons = useMemo(
    () =>
      files.map((file) => ({
        file,
        diff: compareProjectMergeFile(file),
      })),
    [files],
  );
  const conflicts = comparisons.flatMap(({ diff }) => diff.conflicts);
  const autoChangeCount = comparisons.reduce((count, { diff }) => count + diff.autoChangeCount, 0);

  const load = async () => {
    if (!window.electronAPI) return;
    setError(undefined);
    setStatus(undefined);
    try {
      const stages = await window.electronAPI.readWorkspaceGitConflicts();
      const next = stages.map((item) => {
        const base = item.base ? parseProjectMergeValue(item.kind, item.base) : undefined;
        const local = item.local ? parseProjectMergeValue(item.kind, item.local) : undefined;
        const remote = item.remote ? parseProjectMergeValue(item.kind, item.remote) : undefined;
        const ids = new Set([base?.id, local?.id, remote?.id].filter(Boolean));
        return { stages: item, base, local, remote, atomic: ids.size > 1 };
      });
      setFiles(next);
      setDecisions({});
      if (next.length === 0) setStatus('No supported project resource conflicts were found.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const choose = (id: string, choice: StoryMergeChoice) => {
    setDecisions((current) => ({ ...current, [id]: choice }));
    setError(undefined);
    setStatus(undefined);
  };

  const chooseAll = (choice: StoryMergeChoice) => {
    setDecisions(Object.fromEntries(conflicts.map((conflict) => [conflict.id, choice])));
    setError(undefined);
    setStatus(undefined);
  };

  const apply = async () => {
    if (files.length === 0) return;
    setApplying(true);
    try {
      const result = await applyWorkspaceMerge(
        files.map((file) => {
          const root = projectMergeRoot(file);
          const merged = file.atomic
            ? decisions[root] === 'remote'
              ? file.remote
              : file.local
            : mergeThreeWayOptionalValues(file.base, file.local, file.remote, decisions, root);
          return {
            relativePath: file.stages.relativePath,
            kind: file.stages.kind,
            ...(merged
              ? { content: serializeProjectMergeValue(file.stages.kind, merged) }
              : { delete: true }),
          };
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setFiles([]);
      setDecisions({});
      setError(undefined);
      setStatus(
        'Project resources were validated and saved. Git staging remains under your control.',
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setApplying(false);
    }
  };

  const reportedCount = workspace?.gitConflicts?.length ?? 0;
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <strong>Project Resource Merge</strong>
          <span>Character · Asset · Event · Signal · Project index</span>
        </div>
        <button type="button" onClick={() => void load()} disabled={!workspace?.project}>
          Load Project Conflicts{reportedCount > 0 ? ` (${reportedCount})` : ''}
        </button>
      </header>
      {error && (
        <div className={styles.error}>
          <span>{error}</span>
          <CopyButton text={error} />
        </div>
      )}
      {status && <div className={styles.status}>{status}</div>}
      {files.length === 0 ? (
        <div className={styles.empty}>
          Load Git conflicts for the current project, including add/add and modify/delete cases.
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <div>
              <strong>{files.length}</strong>
              <span>files</span>
            </div>
            <div>
              <strong>{conflicts.length}</strong>
              <span>true conflicts</span>
            </div>
            <div>
              <strong>{autoChangeCount}</strong>
              <span>auto merged</span>
            </div>
            <button type="button" onClick={() => chooseAll('local')}>
              All Local
            </button>
            <button type="button" onClick={() => chooseAll('remote')}>
              All Remote
            </button>
            <button
              type="button"
              className={styles.applyButton}
              disabled={applying}
              onClick={() => void apply()}
            >
              {applying ? 'Saving…' : 'Apply Project Merge'}
            </button>
          </div>
          {conflicts.length === 0 ? (
            <div className={styles.empty}>
              All project resource changes can be merged automatically. Review and apply when ready.
            </div>
          ) : (
            <div className={styles.conflicts}>
              {conflicts.map((conflict) => {
                const choice = decisions[conflict.id] ?? 'local';
                const file = files.find((candidate) =>
                  conflict.id.startsWith(projectMergeRoot(candidate)),
                );
                const localLabel = file
                  ? !file.local
                    ? 'Delete'
                    : !file.remote
                      ? 'Local · Keep'
                      : 'Local'
                  : 'Local';
                const remoteLabel = file
                  ? !file.remote
                    ? 'Delete'
                    : !file.local
                      ? 'Remote · Keep'
                      : 'Remote'
                  : 'Remote';
                return (
                  <article className={styles.conflict} key={conflict.id}>
                    <header>
                      <span>{conflict.kind}</span>
                      <code>{conflict.path}</code>
                    </header>
                    <div className={styles.choices}>
                      <button
                        type="button"
                        className={choice === 'local' ? styles.selectedChoice : undefined}
                        onClick={() => choose(conflict.id, 'local')}
                      >
                        <strong>{localLabel}</strong>
                        <pre>{valueText(conflict.localValue, conflict.kind !== 'remote-only')}</pre>
                      </button>
                      <button
                        type="button"
                        className={choice === 'remote' ? styles.selectedChoice : undefined}
                        onClick={() => choose(conflict.id, 'remote')}
                      >
                        <strong>{remoteLabel}</strong>
                        <pre>{valueText(conflict.remoteValue, conflict.kind !== 'local-only')}</pre>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function StoryMerge() {
  const {
    hasActiveStory,
    document,
    source,
    semanticSnapshot,
    applyStoryMerge,
    aiProposal,
    storyMergePreview,
    storyMergeDecisionRequest,
    showStoryMergePreview,
    clearStoryMergePreview,
    focusStoryMergePreviewNode,
  } = useStoryGraphStore();
  const [base, setBase] = useState<MergeableStoryDocument>();
  const [localBase, setLocalBase] = useState<MergeableStoryDocument>();
  const [remote, setRemote] = useState<StorySourceDocument>();
  const [remotePath, setRemotePath] = useState('');
  const [baseRevision, setBaseRevision] = useState('');
  const [decisions, setDecisions] = useState<Record<string, StoryMergeChoice>>({});
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [mode, setMode] = useState<'two-way' | 'git-three-way'>('two-way');
  const [applying, setApplying] = useState(false);
  const remoteMergeable = useMemo(() => (remote ? mergeableStory(remote) : undefined), [remote]);
  const threeWayDiff = useMemo(
    () =>
      base && localBase && remoteMergeable
        ? diffThreeWayStoryDocuments(base, localBase, remoteMergeable)
        : undefined,
    [base, localBase, remoteMergeable],
  );
  const conflicts = useMemo(
    () =>
      threeWayDiff?.conflicts ??
      (localBase && remoteMergeable ? diffStoryDocuments(localBase, remoteMergeable) : []),
    [localBase, remoteMergeable, threeWayDiff],
  );
  const mergedProjection = useMemo(
    () =>
      localBase && remoteMergeable
        ? base
          ? mergeThreeWayStoryDocuments(
              base,
              localBase,
              remoteMergeable,
              decisions as StoryMergeDecisions,
            )
          : mergeStoryDocuments(localBase, remoteMergeable, decisions as StoryMergeDecisions)
        : undefined,
    [base, decisions, localBase, remoteMergeable],
  );
  const remoteChoiceCount = conflicts.filter(
    (conflict) => decisions[conflict.id] === 'remote',
  ).length;
  const stale = Boolean(baseRevision && baseRevision !== semanticSnapshot.revision);
  const hasMergedChanges = Boolean(
    localBase && mergedProjection && JSON.stringify(localBase) !== JSON.stringify(mergedProjection),
  );

  const mergedStory = useMemo(
    () => (mergedProjection ? applyMergedStory(source, mergedProjection) : undefined),
    [mergedProjection, source],
  );

  useEffect(() => {
    if (!mergedStory || !localBase || aiProposal) {
      clearStoryMergePreview();
      return;
    }
    try {
      showStoryMergePreview(mergedStory, conflicts, decisions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    return clearStoryMergePreview;
  }, [
    aiProposal,
    clearStoryMergePreview,
    conflicts,
    decisions,
    localBase,
    mergedStory,
    showStoryMergePreview,
  ]);

  useEffect(() => {
    if (!storyMergeDecisionRequest) return;
    setDecisions((current) => ({
      ...current,
      [storyMergeDecisionRequest.id]: storyMergeDecisionRequest.choice,
    }));
    setError(undefined);
    setStatus(undefined);
  }, [storyMergeDecisionRequest]);

  const previewConflict = (conflict: StoryMergeConflict) => {
    const nodeId = conflict.id
      .split('/')
      .map(decodeURIComponent)
      .find((segment) => segment.startsWith('@id:n_'))
      ?.slice(4) as Parameters<typeof focusStoryMergePreviewNode>[1] | undefined;
    if (!nodeId) return;
    const graph = storyMergePreview?.graphs.find((candidate) =>
      candidate.graph.nodes.some((node) => node.id === nodeId),
    );
    if (graph) focusStoryMergePreviewNode(graph.id, nodeId);
  };

  const choose = (id: string, choice: StoryMergeChoice) => {
    setDecisions((current) => ({ ...current, [id]: choice }));
    setError(undefined);
    setStatus(undefined);
  };

  const chooseAll = (choice: StoryMergeChoice) => {
    setDecisions(Object.fromEntries(conflicts.map((conflict) => [conflict.id, choice])));
    setError(undefined);
    setStatus(undefined);
  };

  const compareStory = async () => {
    if (!window.electronAPI) return;
    if (aiProposal) {
      setError('Apply or discard the AI proposal before opening Story Merge Preview.');
      return;
    }
    setError(undefined);
    setStatus(undefined);
    try {
      let selectedPath: string;
      let selectedToken: string;
      let selectedContent: string | undefined;
      if (document.gitConflict && document.filePath && document.fileToken) {
        selectedPath = document.filePath;
        selectedToken = document.fileToken;
      } else {
        const result = await window.electronAPI.openStory();
        if (result.canceled) return;
        selectedPath = result.filePath;
        selectedToken = result.fileToken;
        selectedContent = result.content;
      }
      const stages = await window.electronAPI.readStoryGitConflict(selectedPath, selectedToken);
      if (stages) {
        if (
          !document.filePath ||
          document.filePath.toLocaleLowerCase() !== selectedPath.toLocaleLowerCase()
        ) {
          setError('Select the conflicted file that belongs to the currently open Story.');
          return;
        }
        const parsedBase = parseStorySource(stages.base);
        const parsedLocal = parseStorySource(stages.local);
        const parsedRemote = parseStorySource(stages.remote);
        if (
          parsedBase.id !== parsedLocal.id ||
          parsedLocal.id !== parsedRemote.id ||
          parsedLocal.id !== source.id
        ) {
          setError('Git Base, Local, Remote, and the active Story must have the same Story ID.');
          return;
        }
        const localStage = mergeableStory(parsedLocal);
        if (JSON.stringify(mergeableStory(source)) !== JSON.stringify(localStage)) {
          setError(
            'The in-memory Story no longer matches Git Local. Save or discard editor changes before resolving this conflict.',
          );
          return;
        }
        setBase(mergeableStory(parsedBase));
        setLocalBase(localStage);
        setRemote(parsedRemote);
        setRemotePath(`${stages.repositoryRoot} · ${stages.relativePath}`);
        setBaseRevision(semanticSnapshot.revision);
        setDecisions({});
        setMode('git-three-way');
        return;
      }
      if (document.gitConflict) {
        setError(
          'Git no longer reports an unresolved conflict for this Story. Reopen it to refresh.',
        );
        return;
      }
      const parsed = parseStorySource(selectedContent!);
      if (parsed.id !== source.id) {
        setError(
          `Selected file is Story ${parsed.id}, but the active Story is ${source.id}. Compare matching Story IDs only.`,
        );
        return;
      }
      setBase(undefined);
      setLocalBase(mergeableStory(source));
      setRemote(parsed);
      setRemotePath(selectedPath);
      setBaseRevision(semanticSnapshot.revision);
      setDecisions({});
      setMode('two-way');
      setStatus(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const apply = async () => {
    if (!mergedProjection || !localBase || stale) return;
    setApplying(true);
    try {
      const result = await applyStoryMerge(mergedStory!);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setBase(undefined);
      setLocalBase(undefined);
      setRemote(undefined);
      setRemotePath('');
      setBaseRevision('');
      setDecisions({});
      setError(undefined);
      setStatus('Merge validated, applied, and saved. Git staging remains under your control.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <header className={styles.header}>
          <div>
            <strong>Story Merge</strong>
            <span>
              {mode === 'git-three-way'
                ? 'Git three-way merge · non-overlapping changes are resolved automatically'
                : 'Semantic two-way comparison · Local is kept unless Remote is selected'}
            </span>
          </div>
          <button type="button" onClick={() => void compareStory()} disabled={!hasActiveStory}>
            {document.gitConflict ? 'Load Git Conflict' : 'Compare Story…'}
          </button>
        </header>

        {error && (
          <div className={styles.error}>
            <span>{error}</span>
            <CopyButton text={error} />
          </div>
        )}
        {status && <div className={styles.status}>{status}</div>}
        {stale && (
          <div className={styles.error}>
            <span>The local Story changed after comparison. Reopen the comparison file.</span>
          </div>
        )}

        {!remote || !localBase ? (
          <div className={styles.empty}>
            Choose another valid <code>.story</code> file to compare with the active Story. Shared
            project resources are intentionally excluded from this first merge phase.
          </div>
        ) : (
          <>
            <div className={styles.summary}>
              <div>
                <strong>{conflicts.length}</strong>
                <span>differences</span>
              </div>
              <div>
                <strong>{remoteChoiceCount}</strong>
                <span>using Remote</span>
              </div>
              {threeWayDiff && (
                <div>
                  <strong>{threeWayDiff.autoChangeCount}</strong>
                  <span>auto merged</span>
                </div>
              )}
              <code title={remotePath}>{remotePath}</code>
              <button type="button" onClick={() => chooseAll('local')}>
                All Local
              </button>
              <button type="button" onClick={() => chooseAll('remote')}>
                All Remote
              </button>
              <button
                type="button"
                disabled={!mergedStory || Boolean(aiProposal)}
                onClick={() =>
                  mergedStory && showStoryMergePreview(mergedStory, conflicts, decisions)
                }
              >
                {storyMergePreview ? 'Refresh Preview' : 'Preview Graph'}
              </button>
              <button
                type="button"
                className={styles.applyButton}
                disabled={stale || (!hasMergedChanges && mode !== 'git-three-way') || applying}
                onClick={() => void apply()}
              >
                {applying ? 'Saving…' : 'Apply & Save'}
              </button>
            </div>
            {conflicts.length === 0 ? (
              <div className={styles.empty}>The two Story files are semantically identical.</div>
            ) : (
              <div className={styles.conflicts}>
                {conflicts.map((conflict) => {
                  const choice = decisions[conflict.id] ?? 'local';
                  const localText = valueText(conflict.localValue, conflict.kind !== 'remote-only');
                  const remoteText = valueText(
                    conflict.remoteValue,
                    conflict.kind !== 'local-only',
                  );
                  return (
                    <article className={styles.conflict} key={conflict.id}>
                      <header>
                        <span>{conflict.kind}</span>
                        <code>{conflict.path}</code>
                        {conflict.id
                          .split('/')
                          .map(decodeURIComponent)
                          .some((segment) => segment.startsWith('@id:n_')) && (
                          <button type="button" onClick={() => previewConflict(conflict)}>
                            Show on Graph
                          </button>
                        )}
                      </header>
                      <div className={styles.choices}>
                        <button
                          type="button"
                          className={choice === 'local' ? styles.selectedChoice : undefined}
                          onClick={() => choose(conflict.id, 'local')}
                        >
                          <strong>Local</strong>
                          <pre>{localText}</pre>
                        </button>
                        <button
                          type="button"
                          className={choice === 'remote' ? styles.selectedChoice : undefined}
                          onClick={() => choose(conflict.id, 'remote')}
                        >
                          <strong>Remote</strong>
                          <pre>{remoteText}</pre>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
        <ProjectResourceMerge />
      </div>
    </div>
  );
}
