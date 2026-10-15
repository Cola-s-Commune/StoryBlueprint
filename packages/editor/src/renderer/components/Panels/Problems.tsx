import { useState, useMemo } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import styles from './Problems.module.css';

export function Problems() {
  const { workspace, problems, lastBuildPath, buildProject, focusProblem } = useStoryGraphStore();

  // Severity visibility toggles
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);

  // Set of hidden error-type codes and warning-type codes (by code string)
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(new Set());

  const toggleCode = (code: string) => {
    setHiddenCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // ── Build ordered type registries (preserving first-seen order) ─────────────
  // Each unique code gets one entry: { code, severity, typeNum, label }
  const typeRegistry = useMemo(() => {
    let errorTypeSeq = 0;
    let warningTypeSeq = 0;
    const map = new Map<
      string,
      { code: string; severity: 'error' | 'warning'; typeNum: number; label: string }
    >();
    for (const p of problems) {
      if (!map.has(p.code)) {
        if (p.severity === 'error') {
          const n = ++errorTypeSeq;
          map.set(p.code, { code: p.code, severity: 'error', typeNum: n, label: `E${n}` });
        } else {
          const n = ++warningTypeSeq;
          map.set(p.code, { code: p.code, severity: 'warning', typeNum: n, label: `W${n}` });
        }
      }
    }
    return map;
  }, [problems]);

  const totalErrors = problems.filter((p) => p.severity === 'error').length;
  const totalWarnings = problems.length - totalErrors;

  // Distinct error-type and warning-type entries for the filter strip
  const errorTypes = useMemo(
    () => [...typeRegistry.values()].filter((t) => t.severity === 'error'),
    [typeRegistry],
  );
  const warningTypes = useMemo(
    () => [...typeRegistry.values()].filter((t) => t.severity === 'warning'),
    [typeRegistry],
  );

  // ── Visible items ────────────────────────────────────────────────────────────
  const visibleProblems = useMemo(
    () =>
      problems.filter((p) => {
        if (p.severity === 'error' && !showErrors) return false;
        if (p.severity === 'warning' && !showWarnings) return false;
        if (hiddenCodes.has(p.code)) return false;
        return true;
      }),
    [problems, showErrors, showWarnings, hiddenCodes],
  );

  const copyText = visibleProblems
    .map((problem) =>
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

        {/* ── Severity toggles ── */}
        <button
          type="button"
          className={styles.severityToggle}
          data-active={showErrors}
          data-severity="error"
          onClick={() => setShowErrors((v) => !v)}
          title={showErrors ? 'Hide all errors' : 'Show all errors'}
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
          title={showWarnings ? 'Hide all warnings' : 'Show all warnings'}
        >
          <span className={styles.toggleIcon}>▲</span>
          {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}
        </button>

        {visibleProblems.length > 0 && <CopyButton text={copyText} label="Copy Visible" />}
        {lastBuildPath && (
          <span className={styles.buildPath} title={lastBuildPath}>
            {lastBuildPath}
          </span>
        )}
      </header>

      {/* ── Type filter strip ── */}
      {problems.length > 0 && (
        <div className={styles.typeStrip}>
          {errorTypes.length > 0 && (
            <div className={styles.typeGroup} data-severity="error">
              {errorTypes.map((t) => {
                const count = problems.filter((p) => p.code === t.code).length;
                const active = showErrors && !hiddenCodes.has(t.code);
                return (
                  <button
                    key={t.code}
                    type="button"
                    className={styles.typeChip}
                    data-active={active}
                    data-severity="error"
                    onClick={() => toggleCode(t.code)}
                    title={`${t.code} — click to ${active ? 'hide' : 'show'}`}
                  >
                    <span className={styles.chipLabel}>{t.label}</span>
                    <span className={styles.chipCode}>{t.code}</span>
                    <span className={styles.chipCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {warningTypes.length > 0 && (
            <div className={styles.typeGroup} data-severity="warning">
              {warningTypes.map((t) => {
                const count = problems.filter((p) => p.code === t.code).length;
                const active = showWarnings && !hiddenCodes.has(t.code);
                return (
                  <button
                    key={t.code}
                    type="button"
                    className={styles.typeChip}
                    data-active={active}
                    data-severity="warning"
                    onClick={() => toggleCode(t.code)}
                    title={`${t.code} — click to ${active ? 'hide' : 'show'}`}
                  >
                    <span className={styles.chipLabel}>{t.label}</span>
                    <span className={styles.chipCode}>{t.code}</span>
                    <span className={styles.chipCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {hiddenCodes.size > 0 && (
            <button
              type="button"
              className={styles.clearHidden}
              onClick={() => setHiddenCodes(new Set())}
              title="Show all hidden types"
            >
              Reset types
            </button>
          )}
        </div>
      )}

      {/* ── Problem list ── */}
      <div className={styles.list}>
        {problems.length === 0 && (
          <div className={styles.empty}>No authoring or build problems.</div>
        )}
        {problems.length > 0 && visibleProblems.length === 0 && (
          <div className={styles.empty}>All problems are hidden by the current filters.</div>
        )}

        {visibleProblems.map((problem, listIdx) => {
          const typeInfo = typeRegistry.get(problem.code);
          const canFocus = Boolean(problem.storyId);
          const itemKey = `${problem.code}-${problem.storyId ?? ''}-${problem.sourceNodeId ?? listIdx}`;

          const content = (
            <>
              {/* Type badge — e.g. E1, W2 */}
              <span className={styles.typeBadge} data-severity={problem.severity}>
                {typeInfo?.label ?? '?'}
              </span>

              <span className={styles.icon}>{problem.severity === 'error' ? '●' : '▲'}</span>

              <span className={styles.message}>
                {problem.message}
                <small>{[problem.storyName, problem.storyPath].filter(Boolean).join(' — ')}</small>
              </span>
              <span className={styles.origin}>{problem.origin === 'authoring' ? 'Draft' : 'Build'}</span>
              <span className={styles.code}>{problem.code}</span>
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
            <div className={styles.problem} data-severity={problem.severity} key={itemKey}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
