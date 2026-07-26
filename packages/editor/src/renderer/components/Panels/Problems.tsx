import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import styles from './Problems.module.css';

export function Problems() {
  const { workspace, problems, lastBuildPath, buildProject, focusProblem } = useStoryGraphStore();
  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.length - errors;
  const copyText = problems
    .map((problem) =>
      [
        `[${problem.severity.toUpperCase()}] ${problem.code}: ${problem.message}`,
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
        <span className={styles.summary}>
          {errors} errors · {warnings} warnings
        </span>
        {problems.length > 0 && <CopyButton text={copyText} label="Copy All" />}
        {lastBuildPath && (
          <span className={styles.buildPath} title={lastBuildPath}>
            {lastBuildPath}
          </span>
        )}
      </header>
      <div className={styles.list}>
        {problems.length === 0 && (
          <div className={styles.empty}>Build the project to validate every Story.</div>
        )}
        {problems.map((problem, index) => {
          const canFocus = Boolean(problem.storyId);
          const content = (
            <>
              <span className={styles.icon}>{problem.severity === 'error' ? '●' : '▲'}</span>
              <span className={styles.message}>
                {problem.message}
                <small>{[problem.storyName, problem.storyPath].filter(Boolean).join(' — ')}</small>
              </span>
              <span className={styles.code}>{problem.code}</span>
            </>
          );
          return canFocus ? (
            <button
              type="button"
              className={styles.problem}
              data-severity={problem.severity}
              key={`${problem.code}-${problem.storyId}-${problem.sourceNodeId ?? index}`}
              onClick={() => void focusProblem(problem)}
            >
              {content}
            </button>
          ) : (
            <div
              className={styles.problem}
              data-severity={problem.severity}
              key={`${problem.code}-${index}`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
