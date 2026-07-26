import { useCallback, useEffect, useMemo, useState } from 'react';
import { compileStory, type CompilerDiagnostic } from '@story-blueprint/compiler';
import {
  createRuntimeFromCompiledProject,
  parseCompiledStoryProject,
  StoryRuntime,
  type RuntimeInteraction,
  type RuntimeRunResult,
} from '@story-blueprint/runtime';
import type {
  CharacterSource,
  OptionId,
  RuntimeValue,
  VariableDefinition,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './RuntimePreview.module.css';

type HistoryItem =
  | { kind: 'dialogue'; speaker?: string; emotion?: string; text: string }
  | { kind: 'choice'; text: string };

interface PreviewSession {
  runtime: StoryRuntime;
  result: RuntimeRunResult;
  characters: readonly CharacterSource[];
  variables: readonly VariableDefinition[];
}

function valueLabel(value: RuntimeValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function RuntimePreview() {
  const { hasActiveStory, source, characters, variables } = useStoryGraphStore();
  const [session, setSession] = useState<PreviewSession>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<readonly CompilerDiagnostic[]>([]);

  useEffect(() => {
    setSession(undefined);
    setHistory([]);
    setDiagnostics([]);
  }, [source]);

  const characterNames = useMemo(
    () =>
      new Map(
        (session?.characters ?? characters).map((character) => [
          character.id,
          character.displayName,
        ]),
      ),
    [characters, session?.characters],
  );

  const appendDialogue = useCallback(
    (interaction: RuntimeInteraction | undefined) => {
      if (!interaction || interaction.kind !== 'dialogue') return;
      setHistory((current) => [
        ...current,
        {
          kind: 'dialogue',
          speaker: interaction.request.speakerId
            ? characterNames.get(interaction.request.speakerId)
            : undefined,
          emotion: interaction.request.emotion,
          text: interaction.request.defaultText,
        },
      ]);
    },
    [characterNames],
  );

  const acceptResult = useCallback((runtime: StoryRuntime, result: RuntimeRunResult) => {
    setSession((current) => ({
      runtime,
      result,
      characters: current?.runtime === runtime ? current.characters : characters,
      variables: current?.runtime === runtime ? current.variables : variables,
    }));
  }, [characters, variables]);

  const start = useCallback(() => {
    const compiled = compileStory(source, { contentVersion: 'editor-preview' });
    setHistory([]);
    setDiagnostics(compiled.diagnostics);
    if (!compiled.ok) {
      setSession(undefined);
      return;
    }
    const runtime = new StoryRuntime(compiled.program);
    setSession({
      runtime,
      result: runtime.runUntilPause(),
      characters,
      variables,
    });
  }, [characters, source, variables]);

  const openCompiled = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const opened = await window.electronAPI.openCompiledProject();
      if (opened.canceled) return;
      const project = parseCompiledStoryProject(opened.content);
      const entry = project.stories[project.entryStoryId];
      const runtime = createRuntimeFromCompiledProject(project);
      setHistory([]);
      setDiagnostics([]);
      setSession({
        runtime,
        result: runtime.runUntilPause(),
        characters: entry.characters,
        variables: entry.program.variables,
      });
    } catch (error) {
      setSession(undefined);
      setDiagnostics([
        {
          code: 'PROJECT_ERROR',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }, []);

  const continueDialogue = useCallback(() => {
    if (!session) return;
    appendDialogue(session.result.kind === 'waiting' ? session.result.interaction : undefined);
    acceptResult(session.runtime, session.runtime.continueDialogue());
  }, [acceptResult, appendDialogue, session]);

  const choose = useCallback(
    (optionId: OptionId, text: string) => {
      if (!session) return;
      setHistory((current) => [...current, { kind: 'choice', text }]);
      acceptResult(session.runtime, session.runtime.choose(optionId));
    },
    [acceptResult, session],
  );

  const result = session?.result;
  const state = result?.state;
  const interaction = result?.kind === 'waiting' ? result.interaction : undefined;

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!hasActiveStory}
          onClick={start}
        >
          {session ? 'Restart' : 'Run Current Story'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void openCompiled()}>
          Run .storyc.json…
        </button>
        {session && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              session.runtime.abort();
              setSession(undefined);
              setHistory([]);
            }}
          >
            Stop
          </button>
        )}
        <span className={styles.status} data-status={state?.status ?? 'idle'}>
          {state?.status ?? 'idle'}
        </span>
      </header>

      <div className={styles.content}>
        <section className={styles.stage}>
          {!session && diagnostics.length === 0 && (
            <div className={styles.empty}>
              {hasActiveStory
                ? '运行当前蓝图，在这里预览对话、选项和变量变化。'
                : '打开一个 Story 后可以在这里运行预览。'}
            </div>
          )}

          {history.length > 0 && (
            <div className={styles.history}>
              {history.map((item, index) =>
                item.kind === 'dialogue' ? (
                  <article key={index} className={styles.historyDialogue}>
                    <div className={styles.speaker}>
                      {item.speaker ?? 'Narrator'}
                      {item.emotion && <span>{item.emotion}</span>}
                    </div>
                    <div>{item.text}</div>
                  </article>
                ) : (
                  <div key={index} className={styles.historyChoice}>
                    › {item.text}
                  </div>
                ),
              )}
            </div>
          )}

          {interaction?.kind === 'dialogue' && (
            <div className={styles.currentCard}>
              <div className={styles.speaker}>
                {interaction.request.speakerId
                  ? (characterNames.get(interaction.request.speakerId) ??
                    interaction.request.speakerId)
                  : 'Narrator'}
                {interaction.request.emotion && <span>{interaction.request.emotion}</span>}
              </div>
              <div className={styles.dialogueText}>{interaction.request.defaultText}</div>
              <button type="button" className={styles.continueButton} onClick={continueDialogue}>
                Continue
              </button>
            </div>
          )}

          {interaction?.kind === 'choice' && (
            <div className={styles.currentCard}>
              {interaction.request.defaultPrompt && (
                <div className={styles.prompt}>{interaction.request.defaultPrompt}</div>
              )}
              <div className={styles.options}>
                {interaction.request.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.enabled}
                    onClick={() => choose(option.id, option.defaultText)}
                  >
                    {option.defaultText}
                  </button>
                ))}
              </div>
            </div>
          )}

          {result?.kind === 'completed' && <div className={styles.completed}>Story completed.</div>}
          {result?.kind === 'failed' && (
            <div className={styles.error}>
              <strong>{result.diagnostic.code}</strong>
              <span>{result.diagnostic.message}</span>
            </div>
          )}
          {diagnostics.length > 0 && (
            <div className={styles.diagnostics}>
              {diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.code}-${index}`} data-severity={diagnostic.severity}>
                  <strong>{diagnostic.code}</strong> {diagnostic.message}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className={styles.variables}>
          <div className={styles.asideTitle}>Runtime Variables</div>
          {(session?.variables ?? variables).length === 0 && (
            <div className={styles.muted}>No variables</div>
          )}
          {(session?.variables ?? variables).map((variable) => (
            <div key={variable.id} className={styles.variableRow}>
              <span>{variable.displayName}</span>
              <code>{valueLabel(state?.storyVariables[variable.id] ?? variable.defaultValue)}</code>
            </div>
          ))}
          {state && (
            <div className={styles.location}>
              <span>Location</span>
              <code>
                {state.blockId}:{state.instructionIndex}
              </code>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
