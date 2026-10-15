import { useState } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import styles from './Problems.module.css';

export function Problems() {
  const { workspace, problems, lastBuildPath, buildProject, focusProblem } = useStoryGraphStore();

  // Severity visibility toggles
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);

  // Set of indices (into `problems`) the user has individually hidden
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());

  const toggleHidden = (index: number) => {
    setHiddenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Counters (across all items, ignoring individual hide state)
  const totalErrors = problems.filter((p) => p.severity === 'error').length;
  const totalWarnings = problems.length - totalErrors;

  // Assign a per-severity sequential number to every item
  let errorSeq = 0;
  let warningSeq = 0;
  const numberedProblems = problems.map((problem, index) => {
    const seq = problem.severity === 'error' ? ++errorSeq : ++warningSeq;
    return { problem, index, seq };
  });

  // Apply severity filters and individual hide state
  const visibleProblems = numberedProblems.filter(({ problem, index }) => {
    if (problem.severity === 'error' && !showErrors) return false;
    if (problem.severity === 'warning' && !showWarnings) return false;
    if (hiddenIndices.has(index)) return false;
    return true;
  });

  const copyText = visibleProblems
    .map(({ problem }) =>
      [
        `[${problem.severity.toUpperCase()}] ${problem.origin === 'authoring' ? 'DRAFT' : 'BUILD'} ${problem.code}: ${problem.message}`,
        problem.storyName && `Story: ${problem.storyName}`,
        problem.storyPath && `Path: ${problem.storyPath}`,
        problem.sourceChapterId && `Substory: ${problem.sourceChapterId}`,
        problem.sourceNodeId && `Node: ${problem.sourceNodeId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <button type="button" disabled={!workspace?.project} onClick={() => void buildProject()}>
          Build Project
        </button>

        {/* Severity toggles */}
        <button
          type="button"
          className={styles.severityToggle}
          data-active={showErrors}
          data-severity="error"
          onClick={() => setShowErrors((v) => !v)}
          title={showErrors ? 'Hide errors' : 'Show errors'}
        >
          <span className={styles.toggleIcon}>●</span>
          {totalErrors} error{totalErrors !== 1 ? 's' : ''}
        </button>
        <button
          type="button"
          className={styles.severityToggle}
          data-active={showWarnings}
          data-severity="warning"
          onClick={() => setShowWarnings((v) => !v)}
          title={showWarnings ? 'Hide warnings' : 'Show warnings'}
        >
          <span className={styles.toggleIcon}>▲</span>
          {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}
        </button>

        {hiddenIndices.size > 0 && (
          <button
            type="button"
            className={styles.clearHidden}
            onClick={() => setHiddenIndices(new Set())}
            title="Restore all individually hidden items"
          >
            Show all ({hiddenIndices.size} hidden)
          </button>
        )}

        {visibleProblems.length > 0 && <CopyButton text={copyText} label="Copy Visible" />}
        {lastBuildPath && (
          <span className={styles.buildPath} title={lastBuildPath}>
            {lastBuildPath}
          </span>
        )}
      </header>

      <div className={styles.list}>
        {problems.length === 0 && (
          <div className={styles.empty}>No authoring or build problems.</div>
        )}
        {problems.length > 0 && visibleProblems.length === 0 && (
          <div className={styles.empty}>All problems are hidden by the current filters.</div>
        )}

        {visibleProblems.map(({ problem, index, seq }) => {
          const canFocus = Boolean(problem.storyId);
          const itemKey = `${problem.code}-${problem.storyId ?? ''}-${problem.sourceNodeId ?? index}`;

          const badge = (
            <span className={styles.seq} data-severity={problem.severity}>
              #{seq}
            </span>
          );

          const icon = (
            <span className={styles.icon}>{problem.severity === 'error' ? '●' : '▲'}</span>
          );

          const hideBtn = (
            <button
              type="button"
              className={styles.hideBtn}
              title="Hide this item"
              onClick={(e) => {
                e.stopPropagation();
                toggleHidden(index);
              }}
            >
              ✕
            </button>
          );

          const content = (
            <>
              {badge}
              {icon}
              <span className={styles.message}>
                {problem.message}
                <small>{[problem.storyName, problem.storyPath].filter(Boolean).join(' — ')}</small>
              </span>
              <span className={styles.origin}>{problem.origin === 'authoring' ? 'Draft' : 'Build'}</span>
              <span className={styles.code}>{problem.code}</span>
              {hideBtn}
            </>
          );

          return canFocus ? (
            <button
              type="button"
              className={styles.problem}
              data-severity={problem.severity}
              key={itemKey}
              onClick={() => void focusProblem(problem)}
            >
              {content}
            </button>
          ) : (
            <div
              className={styles.problem}
              data-severity={problem.severity}
              key={itemKey}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
