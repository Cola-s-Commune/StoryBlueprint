import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileStory, type CompilerDiagnostic } from '@story-blueprint/compiler';
import {
  createRuntimeFromCompiledProject,
  parseCompiledStoryProject,
  StoryRuntime,
  type RuntimeInteraction,
  type RuntimeRunResult,
  type RuntimeState,
} from '@story-blueprint/runtime';
import {
  localizationTranslationsForStory,
  type CharacterSource,
  type EventSource,
  type SignalSource,
  type OptionId,
  type RuntimeValue,
  type RuntimeProgram,
  type ValueType,
  type VariableDefinition,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import styles from './RuntimePreview.module.css';

type HistoryItem =
  | { kind: 'dialogue'; speaker?: string; emotion?: string; text: string }
  | { kind: 'choice'; text: string }
  | { kind: 'event'; name: string; arguments: Readonly<Record<string, RuntimeValue>> }
  | { kind: 'story-control'; action: string; storyId?: string; instanceId?: string };

interface PreviewSession {
  runtime: StoryRuntime;
  program: RuntimeProgram;
  result: RuntimeRunResult;
  characters: readonly CharacterSource[];
  assets: readonly { id: string }[];
  variables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
}

interface PreviewSaveEnvelope {
  format: 'story-blueprint-preview-save';
  version: 1;
  savedAt: string;
  state: RuntimeState;
}

function previewSaveKey(program: RuntimeProgram): string {
  return `story-blueprint.preview-save.${program.id}`;
}

function previewContentVersion(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return `preview-${(hash >>> 0).toString(36)}`;
}

function valueLabel(value: RuntimeValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function previewDefaultValue(
  type: ValueType,
  characters: readonly CharacterSource[],
  assets: readonly { id: string }[],
): RuntimeValue {
  if (type.nullable || type.kind === 'any') return null;
  switch (type.kind) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'character-ref':
      return characters[0]?.id ?? null;
    case 'asset-ref':
      return assets[0]?.id ?? null;
    case 'array':
      return [];
    case 'map':
    case 'json':
    case 'struct':
      return {};
    case 'enum':
      return type.values[0] ?? '';
  }
}

export function RuntimePreview() {
  const {
    hasActiveStory,
    source,
    inkSources,
    characters,
    assets,
    projectVariables,
    events,
    signals,
    workspace,
  } = useStoryGraphStore();
  const [session, setSession] = useState<PreviewSession>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<readonly CompilerDiagnostic[]>([]);
  const [signalPayload, setSignalPayload] = useState<Record<string, RuntimeValue>>({});
  const [savedStateJson, setSavedStateJson] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'loaded' | 'failed'>('idle');
  const [previewLocale, setPreviewLocale] = useState('');
  const dispatchedEventResult = useRef<RuntimeRunResult>();
  const dispatchedStoryControlResult = useRef<RuntimeRunResult>();
  const authoringVariables = useMemo(
    () => [...source.variables, ...projectVariables],
    [projectVariables, source.variables],
  );

  useEffect(() => {
    setSession(undefined);
    setHistory([]);
    setDiagnostics([]);
    setSignalPayload({});
    setSavedStateJson('');
    setSaveStatus('idle');
    dispatchedEventResult.current = undefined;
    dispatchedStoryControlResult.current = undefined;
  }, [projectVariables, source]);

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
    setSession((current) => (current ? { ...current, runtime, result } : current));
  }, []);

  const start = useCallback(() => {
    const compiled = compileStory(
      {
        ...source,
        variables: [...source.variables, ...projectVariables],
        characters,
        assets,
        events,
        signals,
      },
      {
        contentVersion: previewContentVersion({
          source,
          projectVariables,
          characters,
          assets,
          events,
          signals,
          inkSources,
        }),
        translations: localizationTranslationsForStory(
          workspace?.localization?.document,
          source.id,
        ),
        sourceLocale: workspace?.localization?.document.sourceLocale,
        inkSources,
        availableStoryIds: workspace?.project?.stories.map((story) => story.id),
        localeFallbacks: Object.fromEntries(
          (workspace?.localization?.document.locales ?? []).flatMap((locale) =>
            locale.fallback ? [[locale.locale, locale.fallback]] : [],
          ),
        ),
      },
    );
    setHistory([]);
    setDiagnostics(compiled.diagnostics);
    if (!compiled.ok) {
      setSession(undefined);
      return;
    }
    const runtime = new StoryRuntime(compiled.program);
    setPreviewLocale(compiled.program.sourceLocale ?? '');
    const stored = window.localStorage.getItem(previewSaveKey(compiled.program)) ?? '';
    setSavedStateJson(stored);
    setSaveStatus('idle');
    setSession({
      runtime,
      program: compiled.program,
      result: runtime.runUntilPause(),
      characters,
      assets,
      variables: compiled.program.variables,
      events,
      signals,
    });
  }, [
    assets,
    characters,
    events,
    inkSources,
    projectVariables,
    signals,
    source,
    workspace?.localization,
  ]);

  const openCompiled = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const opened = await window.electronAPI.openCompiledProject();
      if (opened.canceled) return;
      const project = parseCompiledStoryProject(opened.content);
      const entry = project.stories[project.entryStoryId];
      const runtime = createRuntimeFromCompiledProject(project);
      setPreviewLocale(entry.program.sourceLocale ?? '');
      const stored = window.localStorage.getItem(previewSaveKey(entry.program)) ?? '';
      setSavedStateJson(stored);
      setSaveStatus('idle');
      setHistory([]);
      setDiagnostics([]);
      setSession({
        runtime,
        program: entry.program,
        result: runtime.runUntilPause(),
        characters: entry.characters,
        assets: entry.assets,
        variables: entry.program.variables,
        events: project.events,
        signals: project.signals,
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

  const saveState = useCallback(() => {
    if (!session) return;
    try {
      const envelope: PreviewSaveEnvelope = {
        format: 'story-blueprint-preview-save',
        version: 1,
        savedAt: new Date().toISOString(),
        state: session.runtime.state,
      };
      const json = JSON.stringify(envelope, null, 2);
      window.localStorage.setItem(previewSaveKey(session.program), json);
      setSavedStateJson(json);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('failed');
      setDiagnostics([
        {
          code: 'PROJECT_ERROR',
          severity: 'error',
          message: `Could not save Runtime State: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }, [session]);

  const loadState = useCallback(() => {
    if (!session || !savedStateJson) return;
    try {
      const envelope = JSON.parse(savedStateJson) as Partial<PreviewSaveEnvelope>;
      if (
        envelope.format !== 'story-blueprint-preview-save' ||
        envelope.version !== 1 ||
        !envelope.state
      ) {
        throw new Error('Unsupported preview save format');
      }
      const runtime = new StoryRuntime(session.program, envelope.state);
      const result = runtime.runUntilPause();
      dispatchedEventResult.current = undefined;
      setHistory([]);
      setDiagnostics([]);
      setSaveStatus('loaded');
      setSession({ ...session, runtime, result });
    } catch (error) {
      setSaveStatus('failed');
      setDiagnostics([
        {
          code: 'PROJECT_ERROR',
          severity: 'error',
          message: `Could not load Runtime State: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }, [savedStateJson, session]);

  useEffect(() => {
    if (saveStatus === 'idle') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 1_500);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

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

  useEffect(() => {
    if (!session || interaction?.kind !== 'signal') return;
    const definition = session.signals.find((signal) => signal.id === interaction.request.signalId);
    setSignalPayload(
      Object.fromEntries(
        (definition?.parameters ?? []).map((parameter) => [
          parameter.name,
          interaction.request.matches[parameter.name] ??
            previewDefaultValue(parameter.valueType, session.characters, session.assets),
        ]),
      ),
    );
  }, [interaction?.kind, interaction?.request.requestId, session?.runtime]);

  useEffect(() => {
    if (!session || interaction?.kind !== 'event') return;
    if (dispatchedEventResult.current === session.result) return;
    dispatchedEventResult.current = session.result;
    const definition = session.events.find((event) => event.id === interaction.request.eventId);
    setHistory((current) => [
      ...current,
      {
        kind: 'event',
        name: definition?.displayName ?? interaction.request.eventId,
        arguments: interaction.request.arguments,
      },
    ]);
    acceptResult(
      session.runtime,
      session.runtime.continueEvent(
        Object.fromEntries(
          interaction.request.outputs.map((output) => [
            output.id,
            previewDefaultValue(output.valueType, session.characters, session.assets),
          ]),
        ),
      ),
    );
  }, [acceptResult, interaction, session]);
  useEffect(() => {
    if (!session || interaction?.kind !== 'story-control') return;
    if (dispatchedStoryControlResult.current === session.result) return;
    dispatchedStoryControlResult.current = session.result;
    setHistory((current) => [
      ...current,
      {
        kind: 'story-control',
        action: interaction.request.action,
        storyId: interaction.request.storyId,
        instanceId: interaction.request.instanceId,
      },
    ]);
    acceptResult(session.runtime, session.runtime.continueStoryControl({}));
  }, [acceptResult, interaction, session]);
  const errorText = [
    result?.kind === 'failed'
      ? `[ERROR] ${result.diagnostic.code}: ${result.diagnostic.message}`
      : undefined,
    ...diagnostics.map(
      (diagnostic) =>
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}: ${diagnostic.message}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

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
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void openCompiled()}
        >
          Run .storyc.json…
        </button>
        {session && (
          <>
            {(session.program.sourceLocale || (session.program.locales?.length ?? 0) > 0) && (
              <select
                value={previewLocale}
                onChange={(event) => {
                  const locale = event.target.value;
                  setPreviewLocale(locale);
                  session.runtime.setLocale(locale);
                  acceptResult(session.runtime, session.runtime.runUntilPause());
                }}
              >
                {[session.program.sourceLocale, ...(session.program.locales ?? [])]
                  .filter((locale): locale is string => Boolean(locale))
                  .map((locale) => (
                    <option key={locale} value={locale}>
                      {locale}
                    </option>
                  ))}
              </select>
            )}
            <button type="button" className={styles.secondaryButton} onClick={saveState}>
              {saveStatus === 'saved' ? 'Saved' : 'Save State'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!savedStateJson}
              onClick={loadState}
            >
              {saveStatus === 'loaded'
                ? 'Loaded'
                : saveStatus === 'failed'
                  ? 'Load Failed'
                  : 'Load State'}
            </button>
            <CopyButton text={JSON.stringify(session.runtime.state, null, 2)} label="Copy State" />
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
          </>
        )}
        <span className={styles.status} data-status={state?.status ?? 'idle'}>
          {state?.status ?? 'idle'}
        </span>
        {errorText && <CopyButton text={errorText} label="Copy Errors" />}
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
                ) : item.kind === 'choice' ? (
                  <div key={index} className={styles.historyChoice}>
                    › {item.text}
                  </div>
                ) : item.kind === 'event' ? (
                  <div key={index} className={styles.historyChoice}>
                    ⚡ {item.name}({Object.values(item.arguments).map(valueLabel).join(', ')})
                  </div>
                ) : (
                  <div key={index} className={styles.historyChoice}>
                    ↔ {item.action} {item.storyId ?? item.instanceId ?? ''}
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

          {interaction?.kind === 'signal' && (
            <div className={styles.currentCard}>
              <div className={styles.prompt}>
                Wait for Signal ·{' '}
                {session?.signals.find((signal) => signal.id === interaction.request.signalId)
                  ?.displayName ?? interaction.request.signalId}
              </div>
              <div className={styles.eventArguments}>
                {(
                  session?.signals.find((signal) => signal.id === interaction.request.signalId)
                    ?.parameters ?? []
                ).map((parameter) => (
                  <label className={styles.eventArgument} key={parameter.name}>
                    <strong>{parameter.name}</strong>
                    {parameter.valueType.kind === 'boolean' ? (
                      <select
                        value={String(signalPayload[parameter.name] ?? false)}
                        onChange={(event) =>
                          setSignalPayload((current) => ({
                            ...current,
                            [parameter.name]: event.target.value === 'true',
                          }))
                        }
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : (
                      <input
                        type={parameter.valueType.kind === 'number' ? 'number' : 'text'}
                        value={String(signalPayload[parameter.name] ?? '')}
                        onChange={(event) =>
                          setSignalPayload((current) => ({
                            ...current,
                            [parameter.name]:
                              parameter.valueType.kind === 'number'
                                ? Number(event.target.value)
                                : event.target.value,
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className={styles.continueButton}
                onClick={() => {
                  if (!session) return;
                  const next = session.runtime.sendSignal(
                    interaction.request.signalId,
                    signalPayload,
                  );
                  if (next) acceptResult(session.runtime, next);
                }}
              >
                Send Signal
              </button>
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
          {(session?.variables ?? authoringVariables).length === 0 && (
            <div className={styles.muted}>No variables</div>
          )}
          {(session?.variables ?? authoringVariables).map((variable) => (
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
