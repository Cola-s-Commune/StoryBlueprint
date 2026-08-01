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
  type SourceEdge,
  type SourceGraph,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import {
  applyMergedStory,
  autoLayoutStoryAddedNodeOverlaps,
  autoLayoutStoryConflictNeighborhoods,
  diffThreeWayOptionalValues,
  diffThreeWayStoryDocuments,
  diffStoryDocuments,
  mergeableStory,
  mergeStoryDocuments,
  mergeThreeWayStoryDocuments,
  mergeThreeWayOptionalValues,
  type CoordinateLayoutOrder,
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

function coordinateConflictNodeId(conflict: StoryMergeConflict): string | undefined {
  const segments = conflict.id.split('/').map(decodeURIComponent);
  if (segments.at(-1) !== 'position') return undefined;
  return segments.find((segment) => segment.startsWith('@id:n_'))?.slice(4);
}

function summarizeGraphChanges(
  local: MergeableStoryDocument | undefined,
  merged: MergeableStoryDocument | undefined,
) {
  const summary = {
    addedNodes: 0,
    changedNodes: 0,
    removedNodes: 0,
    addedEdges: 0,
    removedEdges: 0,
  };
  if (!local || !merged) return summary;
  const localGraphs = new Map([
    ['root', local.root] as const,
    ...local.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  ]);
  const mergedGraphs = new Map([
    ['root', merged.root] as const,
    ...merged.chapters.map((chapter) => [chapter.id, chapter.graph] as const),
  ]);
  const graphIds = [...localGraphs.keys(), ...mergedGraphs.keys()].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  const edgeKey = (edge: SourceEdge) =>
    `${edge.from.nodeId}:${edge.from.portId}>${edge.to.nodeId}:${edge.to.portId}`;
  const sameNodeContent = (
    left: SourceGraph['nodes'][number],
    right: SourceGraph['nodes'][number],
  ) => {
    const { position: _leftPosition, ...leftContent } = left;
    const { position: _rightPosition, ...rightContent } = right;
    return JSON.stringify(leftContent) === JSON.stringify(rightContent);
  };
  for (const graphId of graphIds) {
    const before = localGraphs.get(graphId) ?? { nodes: [], edges: [] };
    const after = mergedGraphs.get(graphId) ?? { nodes: [], edges: [] };
    const beforeNodes = new Map(before.nodes.map((node) => [node.id, node] as const));
    const afterNodes = new Map(after.nodes.map((node) => [node.id, node] as const));
    summary.addedNodes += after.nodes.filter((node) => !beforeNodes.has(node.id)).length;
    summary.removedNodes += before.nodes.filter((node) => !afterNodes.has(node.id)).length;
    summary.changedNodes += after.nodes.filter((node) => {
      const previous = beforeNodes.get(node.id);
      return previous !== undefined && !sameNodeContent(previous, node);
    }).length;
    const beforeEdges = new Set(before.edges.map(edgeKey));
    const afterEdges = new Set(after.edges.map(edgeKey));
    summary.addedEdges += [...afterEdges].filter((key) => !beforeEdges.has(key)).length;
    summary.removedEdges += [...beforeEdges].filter((key) => !afterEdges.has(key)).length;
  }
  return summary;
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
  const { workspace, validateWorkspaceMerge, applyWorkspaceMerge } = useStoryGraphStore();
  const [files, setFiles] = useState<ProjectMergeFile[]>([]);
  const [decisions, setDecisions] = useState<Record<string, StoryMergeChoice>>({});
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validatedKey, setValidatedKey] = useState('');
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
  const unresolvedCount = conflicts.filter(
    (conflict) => decisions[conflict.id] === undefined,
  ).length;
  const resolvedCount = conflicts.length - unresolvedCount;
  const mergedFiles = useMemo(
    () =>
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
          conflictRevision: file.stages.revision,
          ...(merged
            ? { content: serializeProjectMergeValue(file.stages.kind, merged) }
            : { delete: true }),
        };
      }),
    [decisions, files],
  );
  const reviewKey = useMemo(() => JSON.stringify(mergedFiles), [mergedFiles]);
  const validated = Boolean(validatedKey && validatedKey === reviewKey);

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
      setValidatedKey('');
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
    setDecisions((current) =>
      Object.fromEntries(
        conflicts.map((conflict) => [conflict.id, current[conflict.id] ?? choice]),
      ),
    );
    setError(undefined);
    setStatus(undefined);
  };

  const validate = async () => {
    if (files.length === 0 || unresolvedCount > 0) return;
    setValidating(true);
    setError(undefined);
    try {
      const result = await validateWorkspaceMerge(mergedFiles);
      if (!result.ok) {
        setValidatedKey('');
        setError(result.message);
        return;
      }
      setValidatedKey(reviewKey);
      setStatus('Project resource merge is valid and ready to apply.');
    } finally {
      setValidating(false);
    }
  };

  const apply = async () => {
    if (files.length === 0 || unresolvedCount > 0 || !validated) return;
    setApplying(true);
    try {
      const result = await applyWorkspaceMerge(mergedFiles);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setFiles([]);
      setDecisions({});
      setValidatedKey('');
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
              <strong>
                {resolvedCount}/{conflicts.length}
              </strong>
              <span>resolved</span>
            </div>
            <div>
              <strong>{autoChangeCount}</strong>
              <span>auto merged</span>
            </div>
            <button type="button" onClick={() => chooseAll('local')}>
              Resolve Remaining Local
            </button>
            <button type="button" onClick={() => chooseAll('remote')}>
              Resolve Remaining Remote
            </button>
            <button
              type="button"
              disabled={unresolvedCount > 0 || validating || validated}
              onClick={() => void validate()}
            >
              {validating ? 'Validating…' : validated ? 'Validated' : 'Validate & Review'}
            </button>
            <button
              type="button"
              className={styles.applyButton}
              disabled={applying || unresolvedCount > 0 || !validated}
              onClick={() => void apply()}
            >
              {applying ? 'Saving…' : 'Apply Project Merge'}
            </button>
          </div>
          <div className={styles.review}>
            <strong>Project merge review</strong>
            <span>
              Files: {mergedFiles.filter((file) => !('delete' in file && file.delete)).length} write
              · {mergedFiles.filter((file) => 'delete' in file && file.delete).length} delete
            </span>
            <span>
              Conflicts: {resolvedCount} resolved · {unresolvedCount} unresolved
            </span>
            <span>Automatic change groups: {autoChangeCount}</span>
            <span>Validation: {validated ? 'passed' : 'required before Apply'}</span>
          </div>
          {conflicts.length === 0 ? (
            <div className={styles.empty}>
              All project resource changes can be merged automatically. Review and apply when ready.
            </div>
          ) : (
            <div className={styles.conflicts}>
              {conflicts.map((conflict) => {
                const choice = decisions[conflict.id];
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
    validateStoryMerge,
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
  const [validating, setValidating] = useState(false);
  const [validatedKey, setValidatedKey] = useState('');
  const [gitConflictRevision, setGitConflictRevision] = useState('');
  const [coordinateLayoutOrder, setCoordinateLayoutOrder] =
    useState<CoordinateLayoutOrder>();
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
  const coordinateConflicts = useMemo(
    () => conflicts.filter((conflict) => coordinateConflictNodeId(conflict) !== undefined),
    [conflicts],
  );
  const coordinateConflictIds = useMemo(
    () => new Set(coordinateConflicts.map((conflict) => conflict.id)),
    [coordinateConflicts],
  );
  const coordinateNodeIds = useMemo(
    () =>
      new Set(
        coordinateConflicts
          .map(coordinateConflictNodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId)),
      ),
    [coordinateConflicts],
  );
  const rawMergedProjection = useMemo(
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
  const mergedProjection = useMemo(
    () => {
      if (!rawMergedProjection || !localBase) return rawMergedProjection;
      let overlapFree = autoLayoutStoryAddedNodeOverlaps(localBase, rawMergedProjection);
      if (remoteMergeable) {
        for (const conflict of conflicts) {
          const choice = decisions[conflict.id];
          const insertion = conflict.resolution;
          if (
            insertion?.kind !== 'concurrent-insertion' ||
            (choice !== 'local-first' && choice !== 'remote-first')
          ) {
            continue;
          }
          overlapFree = autoLayoutStoryConflictNeighborhoods(
            overlapFree,
            localBase,
            remoteMergeable,
            new Set([...insertion.localNodeIds, ...insertion.remoteNodeIds]),
            choice,
          );
        }
      }
      return coordinateLayoutOrder && remoteMergeable
        ? autoLayoutStoryConflictNeighborhoods(
            overlapFree,
            localBase,
            remoteMergeable,
            coordinateNodeIds,
            coordinateLayoutOrder,
          )
        : overlapFree;
    },
    [
      conflicts,
      coordinateLayoutOrder,
      coordinateNodeIds,
      decisions,
      localBase,
      rawMergedProjection,
      remoteMergeable,
    ],
  );
  const remoteChoiceCount = conflicts.filter(
    (conflict) =>
      !(coordinateLayoutOrder && coordinateConflictIds.has(conflict.id)) &&
      decisions[conflict.id] === 'remote',
  ).length;
  const localChoiceCount = conflicts.filter(
    (conflict) =>
      !(coordinateLayoutOrder && coordinateConflictIds.has(conflict.id)) &&
      decisions[conflict.id] === 'local',
  ).length;
  const orderedChoiceCount = conflicts.filter(
    (conflict) =>
      decisions[conflict.id] === 'local-first' || decisions[conflict.id] === 'remote-first',
  ).length;
  const autoCoordinateCount = coordinateLayoutOrder ? coordinateConflicts.length : 0;
  const unresolvedCount = conflicts.filter(
    (conflict) => decisions[conflict.id] === undefined,
  ).length;
  const resolvedCount = conflicts.length - unresolvedCount;
  const stale = Boolean(baseRevision && baseRevision !== semanticSnapshot.revision);
  const hasMergedChanges = Boolean(
    localBase && mergedProjection && JSON.stringify(localBase) !== JSON.stringify(mergedProjection),
  );

  const mergedStory = useMemo(
    () => (mergedProjection ? applyMergedStory(source, mergedProjection) : undefined),
    [mergedProjection, source],
  );
  const reviewKey = useMemo(
    () =>
      mergedStory
        ? JSON.stringify({
            baseRevision,
            gitConflictRevision,
            decisions,
            mergedStory,
          })
        : '',
    [baseRevision, decisions, gitConflictRevision, mergedStory],
  );
  const validated = Boolean(validatedKey && validatedKey === reviewKey);
  const graphReview = useMemo(
    () => summarizeGraphChanges(localBase, mergedProjection),
    [localBase, mergedProjection],
  );

  useEffect(() => {
    if (!mergedStory || !localBase || aiProposal) {
      clearStoryMergePreview();
      return;
    }
    try {
      showStoryMergePreview(mergedStory, conflicts, decisions, remote);
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
    remote,
    showStoryMergePreview,
  ]);

  useEffect(() => {
    if (!storyMergeDecisionRequest) return;
    if (coordinateConflictIds.has(storyMergeDecisionRequest.id)) {
      setCoordinateLayoutOrder(undefined);
    }
    setDecisions((current) => ({
      ...current,
      [storyMergeDecisionRequest.id]: storyMergeDecisionRequest.choice,
    }));
    setError(undefined);
    setStatus(undefined);
  }, [coordinateConflictIds, storyMergeDecisionRequest]);

  const previewConflict = (conflict: StoryMergeConflict) => {
    const resolutionNodeId =
      conflict.resolution?.kind === 'concurrent-insertion'
        ? conflict.resolution.localNodeId
        : conflict.resolution?.kind === 'connection-competition' ||
            conflict.resolution?.kind === 'entry-nodes'
          ? conflict.resolution.localNodeIds[0] ?? conflict.resolution.remoteNodeIds[0]
          : undefined;
    const nodeId = (resolutionNodeId ??
      conflict.id
        .split('/')
        .map(decodeURIComponent)
        .find((segment) => segment.startsWith('@id:n_'))
        ?.slice(4)) as Parameters<typeof focusStoryMergePreviewNode>[1] | undefined;
    if (!nodeId) return;
    const graph = storyMergePreview?.graphs.find((candidate) =>
      candidate.graph.nodes.some((node) => node.id === nodeId),
    );
    if (graph) focusStoryMergePreviewNode(graph.id, nodeId);
  };

  const choose = (id: string, choice: StoryMergeChoice) => {
    if (coordinateConflictIds.has(id)) setCoordinateLayoutOrder(undefined);
    setDecisions((current) => ({ ...current, [id]: choice }));
    setError(undefined);
    setStatus(undefined);
  };

  const chooseAll = (choice: StoryMergeChoice) => {
    setCoordinateLayoutOrder(undefined);
    setDecisions((current) =>
      Object.fromEntries(
        conflicts.map((conflict) => [
          conflict.id,
          coordinateLayoutOrder && coordinateConflictIds.has(conflict.id)
            ? choice
            : (current[conflict.id] ?? choice),
        ]),
      ),
    );
    setError(undefined);
    setStatus(undefined);
  };

  const resolveCoordinateConflicts = (choice: StoryMergeChoice) => {
    setCoordinateLayoutOrder(undefined);
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(coordinateConflicts.map((conflict) => [conflict.id, choice])),
    }));
    setValidatedKey('');
    setError(undefined);
    setStatus(
      choice === 'local'
        ? 'All coordinate conflicts now keep Local positions.'
        : 'All coordinate conflicts now keep Remote positions.',
    );
  };

  const autoArrangeCoordinateConflicts = (order: CoordinateLayoutOrder) => {
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(coordinateConflicts.map((conflict) => [conflict.id, 'local'])),
    }));
    setCoordinateLayoutOrder(order);
    setValidatedKey('');
    setError(undefined);
    setStatus(
      `Auto-arranged ${coordinateConflicts.length} coordinate conflict(s) with ${order === 'local-first' ? 'Local' : 'Remote'} ordering first.`,
    );
  };

  const ensureGitComparisonFresh = async () => {
    if (mode !== 'git-three-way') return true;
    if (!window.electronAPI || !document.filePath || !document.fileToken) return false;
    const current = await window.electronAPI.readStoryGitConflict(
      document.filePath,
      document.fileToken,
    );
    if (!current || current.revision !== gitConflictRevision) {
      setValidatedKey('');
      setError('Git conflict stages changed. Reload Story Merge before continuing.');
      return false;
    }
    return true;
  };

  const validate = async () => {
    if (!mergedStory || stale || unresolvedCount > 0) return;
    setValidating(true);
    setError(undefined);
    try {
      if (!(await ensureGitComparisonFresh())) return;
      const result = validateStoryMerge(mergedStory);
      if (!result.ok) {
        setValidatedKey('');
        setError(result.message);
        return;
      }
      setValidatedKey(reviewKey);
      setStatus('Merge compiles successfully and is ready to apply.');
    } finally {
      setValidating(false);
    }
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
        const localDifferences = diffStoryDocuments(mergeableStory(source), localStage);
        if (localDifferences.length > 0) {
          const paths = localDifferences
            .slice(0, 5)
            .map((difference) => difference.path)
            .join(', ');
          setError(
            `The in-memory Story no longer matches Git Local. Save or discard editor changes before resolving this conflict. Differences: ${paths}${localDifferences.length > 5 ? ` (+${localDifferences.length - 5} more)` : ''}`,
          );
          return;
        }
        setBase(mergeableStory(parsedBase));
        setLocalBase(localStage);
        setRemote(parsedRemote);
        setRemotePath(`${stages.repositoryRoot} · ${stages.relativePath}`);
        setBaseRevision(semanticSnapshot.revision);
        setDecisions({});
        setCoordinateLayoutOrder(undefined);
        setMode('git-three-way');
        setGitConflictRevision(stages.revision);
        setValidatedKey('');
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
      setCoordinateLayoutOrder(undefined);
      setMode('two-way');
      setGitConflictRevision('');
      setValidatedKey('');
      setStatus(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const apply = async () => {
    if (!mergedProjection || !localBase || stale || unresolvedCount > 0 || !validated) return;
    setApplying(true);
    try {
      if (!(await ensureGitComparisonFresh())) return;
      const result = await applyStoryMerge(
        mergedStory!,
        mode === 'git-three-way' ? gitConflictRevision : undefined,
      );
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
      setCoordinateLayoutOrder(undefined);
      setValidatedKey('');
      setGitConflictRevision('');
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
                <strong>
                  {resolvedCount}/{conflicts.length}
                </strong>
                <span>resolved</span>
              </div>
              <div>
                <strong>
                  {localChoiceCount}/{remoteChoiceCount}
                </strong>
                <span>Local / Remote</span>
              </div>
              {orderedChoiceCount > 0 && (
                <div>
                  <strong>{orderedChoiceCount}</strong>
                  <span>ordered</span>
                </div>
              )}
              {threeWayDiff && (
                <div>
                  <strong>{threeWayDiff.autoChangeCount}</strong>
                  <span>auto merged</span>
                </div>
              )}
              <code title={remotePath}>{remotePath}</code>
              <button type="button" onClick={() => chooseAll('local')}>
                Resolve Remaining Local
              </button>
              <button type="button" onClick={() => chooseAll('remote')}>
                Resolve Remaining Remote
              </button>
              {coordinateConflicts.length > 0 && (
                <>
                  <button
                    type="button"
                    title="Auto-layout each conflict node and its directly connected non-Rerouter neighbors, using Local order first"
                    onClick={() => autoArrangeCoordinateConflicts('local-first')}
                  >
                    Local Before Remote
                  </button>
                  <button
                    type="button"
                    title="Auto-layout each conflict node and its directly connected non-Rerouter neighbors, using Remote order first"
                    onClick={() => autoArrangeCoordinateConflicts('remote-first')}
                  >
                    Remote Before Local
                  </button>
                  <button
                    type="button"
                    title="Ignore coordinate conflicts and keep the current Local layout"
                    onClick={() => resolveCoordinateConflicts('local')}
                  >
                    Keep Local Positions
                  </button>
                  <button
                    type="button"
                    title="Use all positions from the incoming branch"
                    onClick={() => resolveCoordinateConflicts('remote')}
                  >
                    Keep Remote Positions
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={!mergedStory || Boolean(aiProposal)}
                onClick={() =>
                  mergedStory && showStoryMergePreview(mergedStory, conflicts, decisions, remote)
                }
              >
                {storyMergePreview ? 'Refresh Preview' : 'Preview Graph'}
              </button>
              <button
                type="button"
                disabled={
                  stale ||
                  unresolvedCount > 0 ||
                  validating ||
                  validated ||
                  (!hasMergedChanges && mode !== 'git-three-way')
                }
                onClick={() => void validate()}
              >
                {validating ? 'Validating…' : validated ? 'Validated' : 'Validate & Review'}
              </button>
              <button
                type="button"
                className={styles.applyButton}
                disabled={
                  stale ||
                  unresolvedCount > 0 ||
                  !validated ||
                  (!hasMergedChanges && mode !== 'git-three-way') ||
                  applying
                }
                onClick={() => void apply()}
              >
                {applying ? 'Saving…' : 'Apply & Save'}
              </button>
            </div>
            <div className={styles.review}>
              <strong>Final review</strong>
              <span>
                Manual: {localChoiceCount} Local · {remoteChoiceCount} Remote · {unresolvedCount}{' '}
                unresolved
              </span>
              {orderedChoiceCount > 0 && (
                <span>Concurrent insertions: {orderedChoiceCount} ordered</span>
              )}
              {autoCoordinateCount > 0 && (
                <span>
                  Coordinates: {autoCoordinateCount} auto-arranged ·{' '}
                  {coordinateLayoutOrder === 'local-first' ? 'Local before Remote' : 'Remote before Local'}
                </span>
              )}
              <span>
                Nodes: +{graphReview.addedNodes} · ~{graphReview.changedNodes} · −
                {graphReview.removedNodes}
              </span>
              <span>
                Connections: +{graphReview.addedEdges} · −{graphReview.removedEdges}
              </span>
              <span>Validation: {validated ? 'passed' : 'required before Apply'}</span>
            </div>
            {conflicts.length === 0 ? (
              <div className={styles.empty}>The two Story files are semantically identical.</div>
            ) : (
              <div className={styles.conflicts}>
                {conflicts.map((conflict) => {
                  const coordinateConflict = coordinateConflictIds.has(conflict.id);
                  const choice =
                    coordinateLayoutOrder && coordinateConflict
                      ? undefined
                      : decisions[conflict.id];
                  const localText = valueText(conflict.localValue, conflict.kind !== 'remote-only');
                  const remoteText = valueText(
                    conflict.remoteValue,
                    conflict.kind !== 'local-only',
                  );
                  const insertion =
                    conflict.resolution?.kind === 'concurrent-insertion'
                      ? conflict.resolution
                      : undefined;
                  const connection =
                    conflict.resolution?.kind === 'connection-competition'
                      ? conflict.resolution
                      : undefined;
                  const entry =
                    conflict.resolution?.kind === 'entry-nodes'
                      ? conflict.resolution
                      : undefined;
                  const orderConflict =
                    decodeURIComponent(conflict.id.split('/').at(-1) ?? '') === '@order';
                  return (
                    <article className={styles.conflict} key={conflict.id}>
                      <header>
                        <span>{conflict.kind}</span>
                        {coordinateLayoutOrder && coordinateConflict && (
                          <span>
                            {coordinateLayoutOrder === 'local-first'
                              ? 'local-before-remote'
                              : 'remote-before-local'}
                          </span>
                        )}
                        <code>{conflict.path}</code>
                        {(conflict.resolution ||
                          conflict.id
                            .split('/')
                            .map(decodeURIComponent)
                            .some((segment) => segment.startsWith('@id:n_'))) && (
                          <button type="button" onClick={() => previewConflict(conflict)}>
                            Show on Graph
                          </button>
                        )}
                      </header>
                      <div className={styles.choices}>
                        {insertion ? (
                          <>
                            <button
                              type="button"
                              className={
                                choice === 'local-first' ? styles.selectedChoice : undefined
                              }
                              onClick={() => choose(conflict.id, 'local-first')}
                            >
                              <strong>
                                {insertion.localLabel} → {insertion.remoteLabel}
                              </strong>
                              <span>Place the Local insertion before the Remote insertion.</span>
                            </button>
                            <button
                              type="button"
                              className={
                                choice === 'remote-first' ? styles.selectedChoice : undefined
                              }
                              onClick={() => choose(conflict.id, 'remote-first')}
                            >
                              <strong>
                                {insertion.remoteLabel} → {insertion.localLabel}
                              </strong>
                              <span>Place the Remote insertion before the Local insertion.</span>
                            </button>
                            <button
                              type="button"
                              className={choice === 'local' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'local')}
                            >
                              <strong>Keep {insertion.localLabel}</strong>
                              <span>
                                Remove {insertion.remoteLabel} and keep only the Local insertion.
                              </span>
                            </button>
                            <button
                              type="button"
                              className={choice === 'remote' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'remote')}
                            >
                              <strong>Keep {insertion.remoteLabel}</strong>
                              <span>
                                Remove {insertion.localLabel} and keep only the Remote insertion.
                              </span>
                            </button>
                          </>
                        ) : connection ? (
                          <>
                            <button
                              type="button"
                              className={choice === 'local' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'local')}
                            >
                              <strong>Use {connection.localLabel || 'Local source'}</strong>
                              <span>Connect the input from the Local source.</span>
                            </button>
                            <button
                              type="button"
                              className={choice === 'remote' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'remote')}
                            >
                              <strong>Use {connection.remoteLabel || 'Remote source'}</strong>
                              <span>Connect the input from the Remote source.</span>
                            </button>
                          </>
                        ) : entry ? (
                          <>
                            <button
                              type="button"
                              className={choice === 'local' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'local')}
                            >
                              <strong>Keep Local Entry</strong>
                              <span>Remove the competing Remote Start node.</span>
                            </button>
                            <button
                              type="button"
                              className={choice === 'remote' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'remote')}
                            >
                              <strong>Keep Remote Entry</strong>
                              <span>Remove the competing Local Start node.</span>
                            </button>
                          </>
                        ) : orderConflict ? (
                          <>
                            <button
                              type="button"
                              className={choice === 'local' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'local')}
                            >
                              <strong>Local Additions First</strong>
                              <span>Keep both sides and place Local additions before Remote.</span>
                            </button>
                            <button
                              type="button"
                              className={choice === 'remote' ? styles.selectedChoice : undefined}
                              onClick={() => choose(conflict.id, 'remote')}
                            >
                              <strong>Remote Additions First</strong>
                              <span>Keep both sides and place Remote additions before Local.</span>
                            </button>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
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
