import {
  createStableId,
  StoryNodeType,
  type BranchNodeData,
  type CallSubstoryNodeData,
  type CallEventNodeData,
  type WaitSignalNodeData,
  type ChoiceNodeData,
  type ChoiceOption,
  type DialogueNodeData,
  type DialogueLine,
  type DialogueLineId,
  type EndNodeData,
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
  type GetVariableNodeData,
  type SetVariableNodeData,
  type StartNodeData,
  type NodeId,
  type OptionId,
  type VariableId,
} from '@story-blueprint/common';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { toSourceGraph, type EditorGraphState } from '../../graph/editorGraph';
import { readStoryDataDrag } from '../../graph/storyDataDrag';
import { formatDialogueInk, parseDialogueInk } from '../../dialogue/dialogueInk';
import { formatChoiceInk, parseChoiceInk } from '../../dialogue/choiceInk';
import { StoryDataInspector } from './StoryData';
import panelStyles from './Panel.module.css';
import styles from './Inspector.module.css';

const DialogueInkEditor = lazy(() =>
  import('./DialogueInkEditor').then((module) => ({ default: module.DialogueInkEditor })),
);

interface PropertyFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  variableMode?: 'template' | 'expression';
  onBeginEdit: () => void;
  onChange: (value: string) => void;
}

function PropertyField({
  label,
  value,
  multiline,
  variableMode,
  onBeginEdit,
  onChange,
}: PropertyFieldProps) {
  const { variables, projectVariables } = useStoryGraphStore();
  const availableVariables = [...variables, ...projectVariables];
  const editing = useRef(false);
  const handleChange = (nextValue: string) => {
    if (!editing.current) {
      onBeginEdit();
      editing.current = true;
    }
    onChange(nextValue);
  };
  const handleBlur = () => {
    editing.current = false;
  };
  const handleDrop = (event: DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!variableMode) return;
    const payload = readStoryDataDrag(event.dataTransfer);
    if (payload?.kind !== 'variable') return;
    const variable = availableVariables.find((candidate) => candidate.id === payload.id);
    if (!variable) return;
    event.preventDefault();
    const control = event.currentTarget;
    const start = control.selectionStart ?? value.length;
    const end = control.selectionEnd ?? start;
    const token = variableMode === 'template' ? `{${variable.name}}` : variable.name;
    handleChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };
  const common = {
    value,
    onBlur: handleBlur,
    onDragOver: (event: DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (variableMode && readStoryDataDrag(event.dataTransfer)?.kind === 'variable') {
        event.preventDefault();
      }
    },
    onDrop: handleDrop,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      handleChange(event.target.value),
  };

  return (
    <label className={styles.field}>
      <span>{label}</span>
      {multiline ? <textarea {...common} rows={5} /> : <input {...common} />}
      {variableMode && <small>Drag a variable here to insert it.</small>}
    </label>
  );
}

function VariableSelect({
  label,
  value,
  onBeginEdit,
  onChange,
}: {
  label: string;
  value?: VariableId;
  onBeginEdit: () => void;
  onChange: (value: VariableId | undefined) => void;
}) {
  const { variables, projectVariables, characters } = useStoryGraphStore();
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => {
          onBeginEdit();
          onChange((event.target.value || undefined) as VariableId | undefined);
        }}
      >
        <option value="">Select variable…</option>
        {variables.map((variable) => (
          <option key={variable.id} value={variable.id}>
            {variable.name} · {variable.valueType.kind}
          </option>
        ))}
        {projectVariables.length > 0 && (
          <optgroup label="Project">
            {projectVariables.map((variable) => (
              <option key={variable.id} value={variable.id}>
                {variable.name} · {variable.valueType.kind}
              </option>
            ))}
          </optgroup>
        )}
        {characters.map((character) =>
          (character.fields?.length ?? 0) > 0 ? (
            <optgroup key={character.id} label={character.displayName}>
              {character.fields!.map((field) => (
                <option key={field.id} value={field.id}>
                  {character.name}.{field.name} · {field.valueType.kind}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </label>
  );
}

function TagsField({
  value,
  onBeginEdit,
  onChange,
}: {
  value: readonly string[];
  onBeginEdit: () => void;
  onChange: (value: string[] | undefined) => void;
}) {
  const serialized = value.join(', ');
  const [draft, setDraft] = useState(serialized);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(serialized);
  }, [serialized]);
  return (
    <label className={styles.field}>
      <span>Tags</span>
      <input
        value={draft}
        placeholder="intro, greeting"
        onChange={(event) => {
          if (!editing.current) {
            onBeginEdit();
            editing.current = true;
          }
          setDraft(event.target.value);
        }}
        onBlur={() => {
          if (!editing.current) return;
          const tags = [
            ...new Set(
              draft
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ];
          editing.current = false;
          setDraft(tags.join(', '));
          onChange(tags.length > 0 ? tags : undefined);
        }}
      />
      <small>Comma-separated tags.</small>
    </label>
  );
}

function decodeStringLiteral(source: string): string | undefined {
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function SetVariableEditor({ nodeId, data }: { nodeId: NodeId; data: SetVariableNodeData }) {
  const { variables, projectVariables, characters, checkpoint, updateNodeData } =
    useStoryGraphStore();
  const allVariables = [
    ...variables,
    ...projectVariables,
    ...characters.flatMap((character) => character.fields ?? []),
  ];
  const variable = allVariables.find((candidate) => candidate.id === data.variableId);
  const isString = variable?.valueType.kind === 'string';
  const decodedLiteral = decodeStringLiteral(data.value.source);
  const [mode, setMode] = useState<'literal' | 'expression'>(() =>
    decodedLiteral === undefined ? 'expression' : 'literal',
  );

  useEffect(() => {
    setMode(decodeStringLiteral(data.value.source) === undefined ? 'expression' : 'literal');
  }, [data.variableId, nodeId]);

  const updateValue = (source: string) =>
    updateNodeData(nodeId, StoryNodeType.SetVariable, {
      value: { source, bindings: {} },
    });

  return (
    <>
      <VariableSelect
        label="Variable"
        value={data.variableId}
        onBeginEdit={checkpoint}
        onChange={(variableId) => {
          const nextVariable = allVariables.find((candidate) => candidate.id === variableId);
          const nextIsString = nextVariable?.valueType.kind === 'string';
          setMode(nextIsString ? 'literal' : 'expression');
          updateNodeData(nodeId, StoryNodeType.SetVariable, {
            variableId,
            ...(nextIsString
              ? {
                  value: {
                    source: JSON.stringify(decodedLiteral ?? data.value.source),
                    bindings: {},
                  },
                }
              : {}),
          });
        }}
      />
      {isString && (
        <label className={styles.field}>
          <span>Value Mode</span>
          <select
            value={mode}
            onChange={(event) => {
              checkpoint();
              const nextMode = event.target.value as 'literal' | 'expression';
              setMode(nextMode);
              if (nextMode === 'literal' && decodedLiteral === undefined) {
                updateValue(JSON.stringify(data.value.source));
              }
            }}
          >
            <option value="literal">Text</option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {isString && mode === 'literal' ? (
        <PropertyField
          label="Text Value"
          value={decodedLiteral ?? data.value.source}
          onBeginEdit={checkpoint}
          onChange={(value) => updateValue(JSON.stringify(value))}
        />
      ) : (
        <PropertyField
          label="Value Expression"
          value={data.value.source}
          variableMode="expression"
          onBeginEdit={checkpoint}
          onChange={updateValue}
        />
      )}
    </>
  );
}

function EventArgumentEditor({
  nodeId,
  name,
  kind,
  value,
  argumentsByName,
}: {
  nodeId: NodeId;
  name: string;
  kind: 'boolean' | 'number' | 'string';
  value?: CallEventNodeData['arguments'][string];
  argumentsByName: CallEventNodeData['arguments'];
}) {
  const { checkpoint, updateNodeData } = useStoryGraphStore();
  const source = value?.source ?? (kind === 'string' ? '""' : kind === 'boolean' ? 'false' : '0');
  const decodedLiteral = decodeStringLiteral(source);
  const [mode, setMode] = useState<'literal' | 'expression'>(() =>
    kind === 'string' && decodedLiteral !== undefined ? 'literal' : 'expression',
  );

  useEffect(() => {
    setMode(
      kind === 'string' && decodeStringLiteral(source) !== undefined ? 'literal' : 'expression',
    );
  }, [kind, name, nodeId]);

  const updateSource = (nextSource: string) =>
    updateNodeData(nodeId, StoryNodeType.CallEvent, {
      arguments: {
        ...argumentsByName,
        [name]: { source: nextSource, bindings: {} },
      },
    });

  return (
    <>
      {kind === 'string' && (
        <label className={styles.field}>
          <span>{name} Mode</span>
          <select
            value={mode}
            onChange={(event) => {
              checkpoint();
              const nextMode = event.target.value as 'literal' | 'expression';
              setMode(nextMode);
              if (nextMode === 'literal' && decodedLiteral === undefined) {
                updateSource(JSON.stringify(source));
              }
            }}
          >
            <option value="literal">Text</option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {kind === 'string' && mode === 'literal' ? (
        <PropertyField
          label={`${name} · string`}
          value={decodedLiteral ?? source}
          onBeginEdit={checkpoint}
          onChange={(text) => updateSource(JSON.stringify(text))}
        />
      ) : (
        <PropertyField
          label={`${name} · ${kind}`}
          value={source}
          variableMode="expression"
          onBeginEdit={checkpoint}
          onChange={updateSource}
        />
      )}
    </>
  );
}

function SignalMatchEditor({
  nodeId,
  name,
  kind,
  value,
  matches,
}: {
  nodeId: NodeId;
  name: string;
  kind: 'boolean' | 'number' | 'string';
  value?: WaitSignalNodeData['matches'][string];
  matches: WaitSignalNodeData['matches'];
}) {
  const { checkpoint, updateNodeData } = useStoryGraphStore();
  const enabled = value !== undefined;
  const source = value?.source ?? (kind === 'string' ? '""' : kind === 'boolean' ? 'false' : '0');
  const decodedLiteral = decodeStringLiteral(source);
  const [mode, setMode] = useState<'literal' | 'expression'>(() =>
    kind === 'string' && decodedLiteral !== undefined ? 'literal' : 'expression',
  );

  useEffect(() => {
    setMode(
      kind === 'string' && decodeStringLiteral(source) !== undefined ? 'literal' : 'expression',
    );
  }, [kind, name, nodeId]);

  const updateSource = (nextSource: string) =>
    updateNodeData(nodeId, StoryNodeType.WaitSignal, {
      matches: { ...matches, [name]: { source: nextSource, bindings: {} } },
    });

  return (
    <>
      <label className={styles.field}>
        <span>{name} Filter</span>
        <select
          value={enabled ? 'match' : 'any'}
          onChange={(event) => {
            checkpoint();
            if (event.target.value === 'match') updateSource(source);
            else {
              const nextMatches = { ...matches };
              delete nextMatches[name];
              updateNodeData(nodeId, StoryNodeType.WaitSignal, { matches: nextMatches });
            }
          }}
        >
          <option value="any">Any value</option>
          <option value="match">Match</option>
        </select>
      </label>
      {enabled && kind === 'string' && (
        <label className={styles.field}>
          <span>{name} Mode</span>
          <select
            value={mode}
            onChange={(event) => {
              checkpoint();
              const nextMode = event.target.value as 'literal' | 'expression';
              setMode(nextMode);
              if (nextMode === 'literal' && decodedLiteral === undefined) {
                updateSource(JSON.stringify(source));
              }
            }}
          >
            <option value="literal">Text</option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {enabled &&
        (kind === 'string' && mode === 'literal' ? (
          <PropertyField
            label={`${name} · string`}
            value={decodedLiteral ?? source}
            onBeginEdit={checkpoint}
            onChange={(text) => updateSource(JSON.stringify(text))}
          />
        ) : (
          <PropertyField
            label={`${name} · ${kind}`}
            value={source}
            variableMode="expression"
            onBeginEdit={checkpoint}
            onChange={updateSource}
          />
        ))}
    </>
  );
}

function ChoiceEditor({ nodeId, data }: { nodeId: NodeId; data: ChoiceNodeData }) {
  const { nodes, edges, setEdges, checkpoint, updateNodeData, source, activeGraphId, saveStory } =
    useStoryGraphStore();
  const [draggedOptionId, setDraggedOptionId] = useState<OptionId>();
  const [expandedOptionIds, setExpandedOptionIds] = useState<Set<OptionId>>(() => new Set());
  const [view, setView] = useState<'options' | 'ink'>('options');
  const [inkFocusLine, setInkFocusLine] = useState<number>();
  const inkUndoSnapshotRef = useRef<EditorGraphState>();
  const canonicalInk = useMemo(() => formatChoiceInk(data), [data]);
  const [inkDraft, setInkDraft] = useState(canonicalInk);
  const [inkDirty, setInkDirty] = useState(false);
  const parsedInk = useMemo(() => parseChoiceInk(inkDraft, data), [data, inkDraft]);

  useEffect(() => {
    setView('options');
    setExpandedOptionIds(new Set());
    setInkFocusLine(undefined);
    inkUndoSnapshotRef.current = undefined;
    setInkDraft(canonicalInk);
    setInkDirty(false);
  }, [nodeId]);
  useEffect(() => {
    if (!inkDirty) setInkDraft(canonicalInk);
  }, [canonicalInk, inkDirty]);

  const edgesForOptions = (options: readonly ChoiceOption[]) => {
    const optionIds = new Set<string>(options.map((option) => option.id));
    return edges.filter(
      (edge) => edge.source !== nodeId || !edge.sourceHandle || optionIds.has(edge.sourceHandle),
    );
  };
  const updateChoice = (next: ChoiceNodeData) => {
    const nextEdges = edgesForOptions(next.options);
    updateNodeData(nodeId, StoryNodeType.Choice, next);
    if (nextEdges.length !== edges.length) setEdges(nextEdges);
  };
  const updateOptions = (options: ChoiceOption[]) => updateChoice({ ...data, options });
  const updateOption = (optionId: OptionId, update: Partial<ChoiceOption>) =>
    updateOptions(
      data.options.map((option) => (option.id === optionId ? { ...option, ...update } : option)),
    );
  const moveOption = (optionId: OptionId, nextIndex: number) => {
    const currentIndex = data.options.findIndex((option) => option.id === optionId);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= data.options.length) return;
    const options = [...data.options];
    const [option] = options.splice(currentIndex, 1);
    options.splice(nextIndex, 0, option);
    checkpoint();
    updateOptions(options);
  };
  const toggleOption = (optionId: OptionId) => {
    setExpandedOptionIds((current) => {
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };
  const sourceWithChoice = (next: ChoiceNodeData) => {
    const nextGraph = toSourceGraph(graphWithChoice(next));
    return activeGraphId === 'root'
      ? { ...source, root: nextGraph }
      : {
          ...source,
          chapters: source.chapters.map((chapter) =>
            chapter.id === activeGraphId ? { ...chapter, graph: nextGraph } : chapter,
          ),
        };
  };
  const graphWithChoice = (next: ChoiceNodeData): EditorGraphState => ({
    nodes: nodes.map((node) =>
      node.id === nodeId && node.type === StoryNodeType.Choice
        ? { ...node, data: next as unknown as typeof node.data }
        : node,
    ),
    edges: edgesForOptions(next.options),
  });
  const enterInk = (focusLine?: number) => {
    inkUndoSnapshotRef.current = structuredClone({ nodes, edges });
    setInkFocusLine(focusLine);
    setView('ink');
  };
  const saveInk = (saveAs = false, leaving = false): boolean => {
    if (!inkDirty) {
      void saveStory(saveAs);
      return true;
    }
    if (!parsedInk.data) return false;
    const next = parsedInk.data;
    checkpoint(inkUndoSnapshotRef.current ?? { nodes, edges });
    updateChoice(next);
    inkUndoSnapshotRef.current = structuredClone(graphWithChoice(next));
    if (!leaving) {
      setInkDraft(formatChoiceInk(next));
      setInkDirty(false);
    }
    void saveStory(saveAs, sourceWithChoice(next));
    return true;
  };
  const viewRef = useRef(view);
  const saveInkRef = useRef(saveInk);
  viewRef.current = view;
  saveInkRef.current = saveInk;
  useEffect(
    () => () => {
      if (viewRef.current === 'ink') saveInkRef.current(false, true);
    },
    [],
  );

  return (
    <>
      <div className={styles.groupHeader}>
        <div className={styles.viewTabs}>
          <button
            type="button"
            className={view === 'options' ? styles.activeTab : undefined}
            onClick={() => {
              if (view === 'ink' && !saveInk(false)) return;
              inkUndoSnapshotRef.current = undefined;
              setView('options');
            }}
          >
            Options · {data.options.length}
          </button>
          <button
            type="button"
            className={view === 'ink' ? styles.activeTab : undefined}
            onClick={() => enterInk()}
          >
            Ink
          </button>
        </div>
        {view === 'options' && (
          <button
            type="button"
            onClick={() => {
              const optionId = createStableId('option');
              checkpoint();
              updateOptions([...data.options, { id: optionId, text: { source: '' } }]);
              setExpandedOptionIds((current) => new Set(current).add(optionId));
            }}
          >
            Add Option
          </button>
        )}
      </div>
      {view === 'ink' ? (
        <Suspense fallback={<div className={styles.inkLoading}>Loading editor…</div>}>
          <DialogueInkEditor
            nodeId={nodeId}
            value={inkDraft}
            diagnostics={parsedInk.diagnostics}
            dirty={inkDirty}
            focusLine={inkFocusLine}
            onChange={(value) => {
              setInkDraft(value);
              setInkDirty(value !== canonicalInk);
            }}
            onSave={saveInk}
            onRevert={() => {
              setInkDraft(canonicalInk);
              setInkDirty(false);
            }}
          />
        </Suspense>
      ) : (
        <>
          <PropertyField
            label="Prompt Template"
            value={data.prompt.source}
            variableMode="template"
            onBeginEdit={checkpoint}
            onChange={(source) => updateChoice({ ...data, prompt: { source } })}
          />
          <div className={styles.groupLabel}>Options</div>
          {data.options.map((option, index) => {
            const isExpanded = expandedOptionIds.has(option.id);
            return (
              <div
                key={option.id}
                className={`${styles.optionGroup} ${styles.lineGroup} ${
                  isExpanded ? '' : styles.lineGroupCollapsed
                }`}
                onDragOver={(event) => {
                  if (draggedOptionId) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedOptionId && draggedOptionId !== option.id)
                    moveOption(draggedOptionId, index);
                  setDraggedOptionId(undefined);
                }}
              >
                <div className={styles.lineHeader}>
                  <span
                    className={styles.dragHandle}
                    draggable
                    title="Drag to reorder"
                    onDragStart={(event) => {
                      setDraggedOptionId(option.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', option.id);
                    }}
                    onDragEnd={() => setDraggedOptionId(undefined)}
                  >
                    ↕
                  </span>
                  <button
                    type="button"
                    className={styles.disclosureButton}
                    title={isExpanded ? 'Collapse option' : 'Expand option'}
                    aria-expanded={isExpanded}
                    onClick={() => toggleOption(option.id)}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className={styles.lineSummary}
                    title={option.text.source || 'Empty choice option'}
                    onClick={() => toggleOption(option.id)}
                  >
                    <strong>Option {index + 1}</strong>
                    <span>{option.text.source || 'Empty choice option…'}</span>
                  </button>
                  <div className={styles.lineActions}>
                    <button
                      type="button"
                      title={`Edit option ${index + 1} in Ink`}
                      onClick={() => enterInk(index + 2)}
                    >
                      Ink
                    </button>
                    {isExpanded && (
                      <>
                        <button
                          type="button"
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => moveOption(option.id, index - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          disabled={index === data.options.length - 1}
                          onClick={() => moveOption(option.id, index + 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="Duplicate option"
                          onClick={() => {
                            checkpoint();
                            const options = [...data.options];
                            const copy = {
                              ...structuredClone(option),
                              id: createStableId('option'),
                            };
                            options.splice(index + 1, 0, copy);
                            updateOptions(options);
                            setExpandedOptionIds((current) => new Set(current).add(copy.id));
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          title="Delete option"
                          disabled={data.options.length === 1}
                          onClick={() => {
                            checkpoint();
                            updateOptions(
                              data.options.filter((candidate) => candidate.id !== option.id),
                            );
                            setExpandedOptionIds((current) => {
                              const next = new Set(current);
                              next.delete(option.id);
                              return next;
                            });
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <>
                    <PropertyField
                      label="Text Template"
                      value={option.text.source}
                      variableMode="template"
                      onBeginEdit={checkpoint}
                      onChange={(source) => updateOption(option.id, { text: { source } })}
                    />
                    <PropertyField
                      label="Visible If"
                      value={option.visibleIf?.source ?? ''}
                      variableMode="expression"
                      onBeginEdit={checkpoint}
                      onChange={(source) =>
                        updateOption(option.id, {
                          visibleIf: source ? { source, bindings: {} } : undefined,
                        })
                      }
                    />
                    <PropertyField
                      label="Enabled If"
                      value={option.enabledIf?.source ?? ''}
                      variableMode="expression"
                      onBeginEdit={checkpoint}
                      onChange={(source) =>
                        updateOption(option.id, {
                          enabledIf: source ? { source, bindings: {} } : undefined,
                        })
                      }
                    />
                    <div className={styles.stableIds}>
                      <code>{option.id}</code>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function DialogueEditor({ nodeId, data }: { nodeId: NodeId; data: DialogueNodeData }) {
  const {
    characters,
    assets,
    nodes,
    edges,
    checkpoint,
    updateNodeData,
    source,
    activeGraphId,
    saveStory,
    splitDialogueLines,
  } = useStoryGraphStore();
  const [draggedLineId, setDraggedLineId] = useState<DialogueLineId>();
  const [expandedLineIds, setExpandedLineIds] = useState<Set<DialogueLineId>>(() => new Set());
  const [selectedLineIds, setSelectedLineIds] = useState<Set<DialogueLineId>>(() => new Set());
  const [lineOperationError, setLineOperationError] = useState<string>();
  const [view, setView] = useState<'lines' | 'ink'>('lines');
  const [inkFocusLine, setInkFocusLine] = useState<number>();
  const inkUndoSnapshotRef = useRef<EditorGraphState>();
  const canonicalInk = useMemo(
    () => formatDialogueInk(data, characters, assets),
    [assets, characters, data],
  );
  const [inkDraft, setInkDraft] = useState(canonicalInk);
  const [inkDirty, setInkDirty] = useState(false);
  const parsedInk = useMemo(
    () => parseDialogueInk(inkDraft, data, characters, assets),
    [assets, characters, data, inkDraft],
  );
  useEffect(() => {
    setView('lines');
    setExpandedLineIds(new Set());
    setSelectedLineIds(new Set());
    setLineOperationError(undefined);
    setInkFocusLine(undefined);
    inkUndoSnapshotRef.current = undefined;
    setInkDraft(canonicalInk);
    setInkDirty(false);
  }, [nodeId]);
  useEffect(() => {
    if (!inkDirty) setInkDraft(canonicalInk);
  }, [canonicalInk, inkDirty]);
  const updateLines = (lines: DialogueLine[]) =>
    updateNodeData(nodeId, StoryNodeType.Dialogue, { lines });
  const updateLine = (lineId: DialogueLineId, update: Partial<DialogueLine>) =>
    updateLines(data.lines.map((line) => (line.id === lineId ? { ...line, ...update } : line)));
  const moveLine = (lineId: DialogueLineId, nextIndex: number) => {
    const currentIndex = data.lines.findIndex((line) => line.id === lineId);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= data.lines.length) return;
    const lines = [...data.lines];
    const [line] = lines.splice(currentIndex, 1);
    lines.splice(nextIndex, 0, line);
    checkpoint();
    updateLines(lines);
  };
  const toggleLine = (lineId: DialogueLineId) => {
    setExpandedLineIds((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };
  const toggleLineSelection = (lineId: DialogueLineId) => {
    setSelectedLineIds((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
    setLineOperationError(undefined);
  };
  const sourceWithDialogueLines = (lines: DialogueLine[]) => {
    const updateGraph = (graph: typeof source.root) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === nodeId && node.type === StoryNodeType.Dialogue
          ? { ...node, data: { ...node.data, lines } }
          : node,
      ),
    });
    return activeGraphId === 'root'
      ? { ...source, root: updateGraph(source.root) }
      : {
          ...source,
          chapters: source.chapters.map((chapter) =>
            chapter.id === activeGraphId
              ? { ...chapter, graph: updateGraph(chapter.graph) }
              : chapter,
          ),
        };
  };
  const graphWithDialogueLines = (lines: DialogueLine[]): EditorGraphState => ({
    nodes: nodes.map((node) =>
      node.id === nodeId && node.type === StoryNodeType.Dialogue
        ? { ...node, data: { ...node.data, lines } }
        : node,
    ),
    edges,
  });
  const enterInk = (focusLine?: number) => {
    inkUndoSnapshotRef.current = structuredClone({ nodes, edges });
    setInkFocusLine(focusLine);
    setView('ink');
  };
  const saveInk = (saveAs = false, leaving = false): boolean => {
    if (!inkDirty) {
      void saveStory(saveAs);
      return true;
    }
    if (!parsedInk.lines) return false;
    const lines = parsedInk.lines;
    checkpoint(inkUndoSnapshotRef.current ?? { nodes, edges });
    updateLines(lines);
    inkUndoSnapshotRef.current = structuredClone(graphWithDialogueLines(lines));
    if (!leaving) {
      setInkDraft(formatDialogueInk({ ...data, lines }, characters, assets));
      setInkDirty(false);
    }
    void saveStory(saveAs, sourceWithDialogueLines(lines));
    return true;
  };
  const viewRef = useRef(view);
  const saveInkRef = useRef(saveInk);
  viewRef.current = view;
  saveInkRef.current = saveInk;
  useEffect(
    () => () => {
      if (viewRef.current === 'ink') saveInkRef.current(false, true);
    },
    [],
  );

  return (
    <>
      <div className={styles.groupHeader}>
        <div className={styles.viewTabs}>
          <button
            type="button"
            className={view === 'lines' ? styles.activeTab : undefined}
            onClick={() => {
              if (view === 'ink' && !saveInk(false)) return;
              inkUndoSnapshotRef.current = undefined;
              setView('lines');
            }}
          >
            Lines · {data.lines.length}
          </button>
          <button
            type="button"
            className={view === 'ink' ? styles.activeTab : undefined}
            onClick={() => {
              enterInk();
            }}
          >
            Ink
          </button>
        </div>
        {view === 'lines' && (
          <div className={styles.groupHeaderActions}>
            {selectedLineIds.size > 0 && (
              <>
                <button
                  type="button"
                  disabled={selectedLineIds.size === data.lines.length}
                  title="Split the selected Lines into an ordered Dialogue chain"
                  onClick={() => {
                    const result = splitDialogueLines(nodeId, [...selectedLineIds]);
                    if (!result.ok) {
                      setLineOperationError(result.message);
                      return;
                    }
                    setSelectedLineIds(new Set());
                    setLineOperationError(undefined);
                  }}
                >
                  Split · {selectedLineIds.size}
                </button>
                <button type="button" onClick={() => setSelectedLineIds(new Set())}>
                  Clear
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                const lineId = createStableId('line');
                const previous = data.lines.at(-1);
                checkpoint();
                updateLines([
                  ...data.lines,
                  {
                    id: lineId,
                    textId: createStableId('text'),
                    text: { source: '' },
                    speakerId: previous?.speakerId,
                    voiceId: previous?.voiceId,
                    emotion: previous?.emotion,
                  },
                ]);
                setExpandedLineIds((current) => new Set(current).add(lineId));
              }}
            >
              Add Line
            </button>
          </div>
        )}
      </div>
      {lineOperationError && <div className={styles.operationError}>{lineOperationError}</div>}
      {view === 'ink' ? (
        <Suspense fallback={<div className={styles.inkLoading}>Loading editor…</div>}>
          <DialogueInkEditor
            nodeId={nodeId}
            value={inkDraft}
            diagnostics={parsedInk.diagnostics}
            dirty={inkDirty}
            focusLine={inkFocusLine}
            onChange={(value) => {
              setInkDraft(value);
              setInkDirty(value !== canonicalInk);
            }}
            onSave={saveInk}
            onRevert={() => {
              setInkDraft(canonicalInk);
              setInkDirty(false);
            }}
          />
        </Suspense>
      ) : (
        data.lines.map((line, index) => {
          const speakerId = line.speakerId;
          const character = characters.find((candidate) => candidate.id === speakerId);
          const speakerName = character?.displayName ?? 'Narrator';
          const isExpanded = expandedLineIds.has(line.id);
          return (
            <div
              key={line.id}
              className={`${styles.optionGroup} ${styles.lineGroup} ${
                isExpanded ? '' : styles.lineGroupCollapsed
              }`}
              onDragOver={(event) => {
                if (draggedLineId) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedLineId && draggedLineId !== line.id) moveLine(draggedLineId, index);
                setDraggedLineId(undefined);
              }}
            >
              <div className={styles.lineHeader}>
                <label className={styles.lineSelection} title={`Select Line ${index + 1}`}>
                  <input
                    type="checkbox"
                    checked={selectedLineIds.has(line.id)}
                    onChange={() => toggleLineSelection(line.id)}
                  />
                </label>
                <span
                  className={styles.dragHandle}
                  draggable
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    setDraggedLineId(line.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', line.id);
                  }}
                  onDragEnd={() => setDraggedLineId(undefined)}
                >
                  ↕
                </span>
                <button
                  type="button"
                  className={styles.disclosureButton}
                  title={isExpanded ? 'Collapse line' : 'Expand line'}
                  aria-expanded={isExpanded}
                  onClick={() => toggleLine(line.id)}
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  className={styles.lineSummary}
                  title={line.text.source || 'Empty dialogue line'}
                  onClick={() => toggleLine(line.id)}
                >
                  <strong>{speakerName}</strong>
                  <span>{line.text.source || 'Empty dialogue line…'}</span>
                </button>
                <div className={styles.lineActions}>
                  <button
                    type="button"
                    title={`Edit line ${index + 1} in Ink`}
                    onClick={() => {
                      enterInk(index + 1);
                    }}
                  >
                    Ink
                  </button>
                  {isExpanded && (
                    <>
                      <button
                        type="button"
                        title="Move up"
                        disabled={index === 0}
                        onClick={() => moveLine(line.id, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={index === data.lines.length - 1}
                        onClick={() => moveLine(line.id, index + 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title="Duplicate line"
                        onClick={() => {
                          checkpoint();
                          const lines = [...data.lines];
                          const copy = {
                            ...structuredClone(line),
                            id: createStableId('line'),
                            textId: createStableId('text'),
                          };
                          lines.splice(index + 1, 0, copy);
                          updateLines(lines);
                          setExpandedLineIds((current) => new Set(current).add(copy.id));
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        title="Delete line"
                        disabled={data.lines.length === 1}
                        onClick={() => {
                          checkpoint();
                          updateLines(data.lines.filter((candidate) => candidate.id !== line.id));
                          setExpandedLineIds((current) => {
                            const next = new Set(current);
                            next.delete(line.id);
                            return next;
                          });
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isExpanded && (
                <>
                  <label
                    className={styles.field}
                    onDragOver={(event) => {
                      if (readStoryDataDrag(event.dataTransfer)?.kind === 'character')
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const payload = readStoryDataDrag(event.dataTransfer);
                      if (payload?.kind !== 'character') return;
                      event.preventDefault();
                      checkpoint();
                      updateLine(line.id, { speakerId: payload.id });
                    }}
                  >
                    <span>Speaker</span>
                    <select
                      value={line.speakerId ?? ''}
                      onChange={(event) => {
                        checkpoint();
                        updateLine(line.id, {
                          speakerId: (event.target.value || undefined) as DialogueLine['speakerId'],
                        });
                      }}
                    >
                      <option value="">Narrator</option>
                      {characters.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PropertyField
                    label="Text Template"
                    value={line.text.source}
                    multiline
                    variableMode="template"
                    onBeginEdit={checkpoint}
                    onChange={(source) => updateLine(line.id, { text: { source } })}
                  />
                  {character && (
                    <label className={styles.field}>
                      <span>Emotion</span>
                      <select
                        value={line.emotion ?? ''}
                        onChange={(event) => {
                          checkpoint();
                          updateLine(line.id, { emotion: event.target.value || undefined });
                        }}
                      >
                        <option value="">None / Character Default</option>
                        {Object.entries(character.emotions).map(([key, emotion]) => (
                          <option key={key} value={key}>
                            {emotion.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label
                    className={styles.field}
                    onDragOver={(event) => {
                      if (readStoryDataDrag(event.dataTransfer)?.kind === 'asset')
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const payload = readStoryDataDrag(event.dataTransfer);
                      if (payload?.kind !== 'asset') return;
                      event.preventDefault();
                      checkpoint();
                      updateLine(line.id, { voiceId: payload.id });
                    }}
                  >
                    <span>Voice Asset</span>
                    <select
                      value={line.voiceId ?? ''}
                      onChange={(event) => {
                        checkpoint();
                        updateLine(line.id, {
                          voiceId: (event.target.value || undefined) as DialogueLine['voiceId'],
                        });
                      }}
                    >
                      <option value="">None</option>
                      {assets
                        .filter((asset) => asset.kind === 'audio')
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <TagsField
                    value={line.tags ?? []}
                    onBeginEdit={checkpoint}
                    onChange={(tags) => updateLine(line.id, { tags })}
                  />
                  <div className={styles.stableIds}>
                    <code>{line.id}</code>
                    <code>{line.textId}</code>
                  </div>
                </>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

export function Inspector() {
  const {
    hasActiveStory,
    nodes,
    variables,
    events,
    signals,
    chapters,
    activeGraphId,
    checkpoint,
    updateNode,
    updateNodeData,
    mergeSelectedDialogues,
    storyDataSelection,
  } = useStoryGraphStore();
  const [multiNodeError, setMultiNodeError] = useState<string>();
  const selected = nodes.filter((node) => node.selected);
  const selectedNodeKey = selected.map((node) => node.id).join('|');
  useEffect(() => setMultiNodeError(undefined), [selectedNodeKey]);

  if (selected.length !== 1) {
    const canMergeDialogues =
      selected.length > 1 && selected.every((node) => node.type === StoryNodeType.Dialogue);
    if (canMergeDialogues) {
      const lineCount = selected.reduce(
        (total, node) => total + (node.data as DialogueNodeData).lines.length,
        0,
      );
      return (
        <div className={panelStyles.panel}>
          <div className={`${panelStyles.body} ${styles.body}`}>
            <section className={styles.section}>
              <div className={styles.sectionTitle}>Dialogue Selection</div>
              <p className={styles.selectionSummary}>
                {selected.length} connected Dialogue nodes · {lineCount} Lines
              </p>
              <button
                type="button"
                className={styles.primaryOperation}
                onClick={() => {
                  const result = mergeSelectedDialogues();
                  setMultiNodeError(result.ok ? undefined : result.message);
                }}
              >
                Merge Dialogues
              </button>
              <p className={styles.operationHint}>
                Nodes must form one continuous execution chain. Line order and stable IDs are
                preserved.
              </p>
              {multiNodeError && <div className={styles.operationError}>{multiNodeError}</div>}
            </section>
          </div>
        </div>
      );
    }
    if (storyDataSelection) {
      return (
        <div className={panelStyles.panel}>
          <div className={`${panelStyles.body} ${styles.body}`}>
            <StoryDataInspector />
          </div>
        </div>
      );
    }
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>
            {!hasActiveStory
              ? 'Open a Story to inspect nodes'
              : selected.length > 1
                ? `${selected.length} nodes selected`
                : 'Select a node to edit'}
          </p>
        </div>
      </div>
    );
  }

  const node = selected[0];
  const duplicateName = Boolean(
    node.name &&
    nodes.some((candidate) => candidate.id !== node.id && candidate.name === node.name),
  );

  const renderTypeProperties = () => {
    switch (node.type) {
      case StoryNodeType.Start: {
        const data = node.data as StartNodeData;
        return (
          <PropertyField
            label="Title"
            value={data.title}
            onBeginEdit={checkpoint}
            onChange={(title) => updateNodeData(node.id, StoryNodeType.Start, { title })}
          />
        );
      }
      case StoryNodeType.Dialogue: {
        const data = node.data as DialogueNodeData;
        return <DialogueEditor key={node.id} nodeId={node.id} data={data} />;
      }
      case StoryNodeType.Choice: {
        const data = node.data as ChoiceNodeData;
        return <ChoiceEditor key={node.id} nodeId={node.id} data={data} />;
      }
      case StoryNodeType.Branch: {
        const data = node.data as BranchNodeData;
        return (
          <PropertyField
            label="Boolean Expression"
            value={data.condition.source}
            multiline
            variableMode="expression"
            onBeginEdit={checkpoint}
            onChange={(source) =>
              updateNodeData(node.id, StoryNodeType.Branch, {
                condition: { source, bindings: {} },
              })
            }
          />
        );
      }
      case StoryNodeType.GetVariable: {
        const data = node.data as GetVariableNodeData;
        return (
          <VariableSelect
            label="Variable"
            value={data.variableId}
            onBeginEdit={checkpoint}
            onChange={(variableId) =>
              updateNodeData(node.id, StoryNodeType.GetVariable, { variableId })
            }
          />
        );
      }
      case StoryNodeType.SetVariable: {
        const data = node.data as SetVariableNodeData;
        return <SetVariableEditor nodeId={node.id} data={data} />;
      }
      case StoryNodeType.CallEvent: {
        const data = node.data as CallEventNodeData;
        const selectedEvent = events.find((candidate) => candidate.id === data.eventId);
        return (
          <>
            <label className={styles.field}>
              <span>Project Event</span>
              <select
                value={data.eventId ?? ''}
                onChange={(event) => {
                  checkpoint();
                  const eventId = event.target.value as CallEventNodeData['eventId'];
                  const definition = events.find((candidate) => candidate.id === eventId);
                  updateNodeData(node.id, StoryNodeType.CallEvent, {
                    eventId: eventId || undefined,
                    arguments: Object.fromEntries(
                      (definition?.parameters ?? []).map((parameter) => [
                        parameter.name,
                        data.arguments[parameter.name] ?? {
                          source:
                            parameter.valueType.kind === 'string'
                              ? '""'
                              : parameter.valueType.kind === 'boolean'
                                ? 'false'
                                : '0',
                          bindings: {},
                        },
                      ]),
                    ),
                  });
                }}
              >
                <option value="">Select event…</option>
                {events.map((event) => (
                  <option value={event.id} key={event.id}>
                    {event.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedEvent?.description && (
              <div className={styles.info}>{selectedEvent.description}</div>
            )}
            {selectedEvent?.parameters.map((parameter) => (
              <EventArgumentEditor
                key={`${data.eventId}-${parameter.name}`}
                nodeId={node.id}
                name={parameter.name}
                kind={parameter.valueType.kind as 'boolean' | 'number' | 'string'}
                value={data.arguments[parameter.name]}
                argumentsByName={data.arguments}
              />
            ))}
            <div className={styles.info}>
              Dispatches the event to the engine and continues immediately.
            </div>
          </>
        );
      }
      case StoryNodeType.WaitSignal: {
        const data = node.data as WaitSignalNodeData;
        const selectedSignal = signals.find((candidate) => candidate.id === data.signalId);
        return (
          <>
            <label className={styles.field}>
              <span>Project Signal</span>
              <select
                value={data.signalId ?? ''}
                onChange={(event) => {
                  checkpoint();
                  updateNodeData(node.id, StoryNodeType.WaitSignal, {
                    signalId: (event.target.value || undefined) as WaitSignalNodeData['signalId'],
                    matches: {},
                  });
                }}
              >
                <option value="">Select signal…</option>
                {signals.map((signal) => (
                  <option value={signal.id} key={signal.id}>
                    {signal.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedSignal?.description && (
              <div className={styles.info}>{selectedSignal.description}</div>
            )}
            {selectedSignal?.parameters.map((parameter) => (
              <SignalMatchEditor
                key={`${data.signalId}-${parameter.name}`}
                nodeId={node.id}
                name={parameter.name}
                kind={parameter.valueType.kind as 'boolean' | 'number' | 'string'}
                value={(data.matches ?? {})[parameter.name]}
                matches={data.matches ?? {}}
              />
            ))}
            <div className={styles.info}>Pauses here until the engine sends this signal.</div>
          </>
        );
      }
      case StoryNodeType.CallSubstory: {
        const data = node.data as CallSubstoryNodeData;
        return (
          <label className={styles.field}>
            <span>Substory</span>
            <select
              value={data.chapterId ?? ''}
              onChange={(event) => {
                checkpoint();
                updateNodeData(node.id, StoryNodeType.CallSubstory, {
                  chapterId: (event.target.value || undefined) as CallSubstoryNodeData['chapterId'],
                });
              }}
            >
              <option value="">Select substory…</option>
              {chapters
                .filter((chapter) => chapter.id !== activeGraphId)
                .map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.displayName}
                  </option>
                ))}
            </select>
          </label>
        );
      }
      case StoryNodeType.Reroute:
        return <div className={styles.info}>Visual routing only; removed during compilation.</div>;
      case StoryNodeType.FlowAnchor: {
        const data = node.data as FlowAnchorNodeData;
        return (
          <PropertyField
            label="Portal Label"
            value={data.label}
            onBeginEdit={checkpoint}
            onChange={(label) => updateNodeData(node.id, StoryNodeType.FlowAnchor, { label })}
          />
        );
      }
      case StoryNodeType.FlowJump: {
        const data = node.data as FlowJumpNodeData;
        const anchors = nodes.filter((candidate) => candidate.type === StoryNodeType.FlowAnchor);
        return (
          <label className={styles.field}>
            <span>Target Anchor</span>
            <select
              value={data.targetNodeId ?? ''}
              onChange={(event) => {
                checkpoint();
                updateNodeData(node.id, StoryNodeType.FlowJump, {
                  targetNodeId: (event.target.value ||
                    undefined) as FlowJumpNodeData['targetNodeId'],
                });
              }}
            >
              <option value="">Select Flow Anchor…</option>
              {anchors.map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {(anchor.data as FlowAnchorNodeData).label || anchor.id}
                </option>
              ))}
            </select>
            <small>Double-click the Flow Jump on the graph to locate its target.</small>
          </label>
        );
      }
      case StoryNodeType.Return:
        return <div className={styles.info}>Returns execution to the calling blueprint.</div>;
      case StoryNodeType.End: {
        const data = node.data as EndNodeData;
        return (
          <>
            {activeGraphId !== 'root' && (
              <div className={styles.warning}>
                End Story stops the whole story. Use Return to exit only this substory.
              </div>
            )}
            <PropertyField
              label="Title"
              value={data.title}
              onBeginEdit={checkpoint}
              onChange={(title) => updateNodeData(node.id, StoryNodeType.End, { title })}
            />
          </>
        );
      }
    }
  };

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Node</div>
          <PropertyField
            label="Name (optional)"
            value={node.name ?? ''}
            onBeginEdit={checkpoint}
            onChange={(name) => updateNode(node.id, { name: name || undefined })}
          />
          {duplicateName && <div className={styles.warning}>Name must be unique.</div>}
          <div className={styles.readonlyField}>
            <span>Type</span>
            <code>{node.type}</code>
          </div>
          <div className={styles.readonlyField}>
            <span>ID</span>
            <code title={node.id}>{node.id}</code>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Properties</div>
          {variables.length === 0 &&
            (node.type === StoryNodeType.Branch || node.type === StoryNodeType.Choice) && (
              <div className={styles.info}>
                Create variables in Story Data, then drag them here.
              </div>
            )}
          {renderTypeProperties()}
        </section>
      </div>
    </div>
  );
}
