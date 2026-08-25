import {
  createStableId,
  StoryNodeType,
  type BranchNodeData,
  type CallSubstoryNodeData,
  type ChapterParameter,
  type CallEventNodeData,
  type WaitSignalNodeData,
  type ChoiceNodeData,
  type ChoiceOption,
  type DialogueNodeData,
  type InkBlockNodeData,
  type InkVariableDirection,
  type DialogueLine,
  type DialogueLineId,
  type EndNodeData,
  type EngineTypeDefinition,
  type ExpressionSource,
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
  type GetVariableNodeData,
  type SetVariableNodeData,
  type StartNodeData,
  type NodeId,
  type OptionId,
  type ReturnNodeData,
  type RuntimeValue,
  type ValueType,
  type VariableDefinition,
  type VariableId,
} from '@story-blueprint/common';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { compileTextTemplate } from '@story-blueprint/compiler';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { toSourceGraph, type EditorGraphState } from '../../graph/editorGraph';
import { readStoryDataDrag } from '../../graph/storyDataDrag';
import { formatDialogueInk, parseDialogueInk } from '../../dialogue/dialogueInk';
import { formatChoiceInk, parseChoiceInk } from '../../dialogue/choiceInk';
import { ExpressionField } from './ExpressionField';
import {
  createStringValueModeState,
  decodeStringLiteral,
  editStringValueText,
  expressionToTextTemplate,
  stringValueModeText,
  switchStringValueMode,
} from './expressionAuthoring';
import { JsonValueInput, NamedCreateControl, StoryDataInspector } from './StoryData';
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
  expectedType?: ValueType;
  onBeginEdit: () => void;
  onChange: (value: string) => void;
}

function EngineJsonSourceEditor({
  label,
  typeName,
  source,
  onBeginEdit,
  onChange,
}: {
  label: string;
  typeName: string;
  source: string;
  onBeginEdit: () => void;
  onChange: (source: string) => void;
}) {
  const { engineTypes } = useStoryGraphStore();
  const schema = engineTypes.find((item) => item.name === typeName);
  let value: RuntimeValue;
  try {
    value = JSON.parse(source) as RuntimeValue;
  } catch {
    return (
      <PropertyField
        label={`${label} · invalid JSON`}
        value={source}
        multiline
        onBeginEdit={onBeginEdit}
        onChange={onChange}
      />
    );
  }
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <JsonValueInput
        value={value}
        schema={schema}
        engineTypes={engineTypes}
        onCommit={(next) => {
          onBeginEdit();
          onChange(JSON.stringify(next));
        }}
      />
    </label>
  );
}

function PropertyField(props: PropertyFieldProps) {
  if (props.variableMode === 'expression') {
    return (
      <ExpressionField
        label={props.label}
        value={props.value}
        multiline={props.multiline}
        expectedType={props.expectedType}
        onBeginEdit={props.onBeginEdit}
        onChange={props.onChange}
      />
    );
  }
  return <PlainPropertyField {...props} />;
}

function PlainPropertyField({
  label,
  value,
  multiline,
  variableMode,
  onBeginEdit,
  onChange,
}: PropertyFieldProps) {
  const {
    availableVariables: graphVariables,
    projectVariables,
    engineTypes,
    characters,
  } = useStoryGraphStore();
  const availableVariables = [...graphVariables, ...projectVariables];
  const editing = useRef(false);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState('');
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
    ref: (control: HTMLInputElement | HTMLTextAreaElement | null) => {
      controlRef.current = control;
    },
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
  const references = useMemo(
    () =>
      referenceOpen ? availableVariables.flatMap((variable) => {
        if (variable.valueType.kind !== 'json') {
          return ['array', 'map'].includes(variable.valueType.kind)
            ? []
            : [{ label: variable.displayName, detail: variable.name, token: variable.name }];
        }
        const engineTypeName = variable.valueType.name;
        const schema = engineTypes.find((candidate) => candidate.name === engineTypeName);
        return (schema?.fields ?? []).flatMap((field) =>
          ['boolean', 'number', 'string', 'enum', 'character-ref', 'asset-ref'].includes(
            field.type.kind,
          )
            ? [{
                label: `${variable.displayName} · ${field.displayName}`,
                detail: `${variable.name}.${field.name}`,
                token: `${variable.name}.${field.name}`,
              }]
            : [],
        );
      }) : [],
    [availableVariables, engineTypes, referenceOpen],
  );
  const filteredReferences = references.filter((reference) =>
    `${reference.label} ${reference.detail}`.toLowerCase().includes(referenceSearch.toLowerCase()),
  );
  const insertReference = (token: string) => {
    const control = controlRef.current;
    const start = control?.selectionStart ?? value.length;
    const end = control?.selectionEnd ?? start;
    handleChange(`${value.slice(0, start)}{${token}}${value.slice(end)}`);
    setReferenceOpen(false);
    requestAnimationFrame(() => {
      control?.focus();
      control?.setSelectionRange(start + token.length + 2, start + token.length + 2);
    });
  };
  let templateError: string | undefined;
  if (variableMode === 'template' && editing.current) {
    try {
      compileTextTemplate({ source: value }, 't_inspector_preview', availableVariables, characters);
    } catch (error) {
      templateError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <label className={styles.field}>
      <span className={styles.propertyLabelRow}>
        <span>{label}</span>
        {variableMode === 'template' && (
          <button
            type="button"
            className={styles.insertReferenceButton}
            onClick={(event) => {
              event.preventDefault();
              setReferenceOpen((open) => !open);
            }}
          >
            Insert Reference
          </button>
        )}
      </span>
      {multiline ? <textarea {...common} rows={5} /> : <input {...common} />}
      {referenceOpen && (
        <div className={styles.referencePicker} onClick={(event) => event.preventDefault()}>
          <input
            autoFocus
            placeholder="Search variables and fields…"
            value={referenceSearch}
            onChange={(event) => setReferenceSearch(event.target.value)}
          />
          <div className={styles.referenceResults}>
            {filteredReferences.map((reference) => (
              <button
                type="button"
                key={reference.token}
                onClick={() => insertReference(reference.token)}
              >
                <span>{reference.label}</span>
                <code>{`{${reference.detail}}`}</code>
              </button>
            ))}
            {filteredReferences.length === 0 && <small>No displayable references.</small>}
          </div>
        </div>
      )}
      {templateError ? (
        <small className={styles.templateError}>{templateError}</small>
      ) : variableMode ? (
        <small>Drag a variable here or insert a reference.</small>
      ) : null}
    </label>
  );
}

function MetadataTitleField({
  label = 'Title',
  value,
  onCommit,
}: {
  label?: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function VariableSelect({
  label,
  value,
  valueType,
  allowedKinds,
  onBeginEdit,
  onChange,
}: {
  label: string;
  value?: VariableId;
  valueType?: ValueType;
  allowedKinds?: readonly ValueType['kind'][];
  onBeginEdit: () => void;
  onChange: (value: VariableId | undefined) => void;
}) {
  const { availableVariables, projectVariables, characters, chapters, activeGraphId } =
    useStoryGraphStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const accepts = (variable: VariableDefinition) =>
    (!allowedKinds || allowedKinds.includes(variable.valueType.kind)) &&
    (!valueType ||
      valueType.kind === 'any' ||
      variable.valueType.kind === 'any' ||
      (variable.valueType.kind === valueType.kind &&
        (valueType.kind !== 'json' ||
          variable.valueType.kind !== 'json' ||
          variable.valueType.name === valueType.name)));

  const selected = useMemo(() => {
    if (!value) return undefined;
    const variable =
      availableVariables.find((candidate) => candidate.id === value) ??
      projectVariables.find((candidate) => candidate.id === value);
    if (variable) return { variable, prefix: '' };
    for (const character of characters) {
      const field = character.fields?.find((candidate) => candidate.id === value);
      if (field) return { variable: field, prefix: `${character.displayName}.` };
    }
    return undefined;
  }, [availableVariables, characters, projectVariables, value]);

  const activeChapter = chapters.find((chapter) => chapter.id === activeGraphId);
  const inputIds = useMemo(
    () => new Set(activeChapter?.parameters.map((parameter) => parameter.variable.id) ?? []),
    [activeChapter?.parameters],
  );
  const localIds = useMemo(
    () => new Set(activeChapter?.localVariables.map((variable) => variable.id) ?? []),
    [activeChapter?.localVariables],
  );
  const resultLimit = 60;
  const { results, totalMatches } = useMemo(() => {
    if (!open) return { results: [], totalMatches: 0 };
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const options: {
      variable: VariableDefinition;
      prefix: string;
      group: string;
    }[] = [];
    const addOption = (variable: VariableDefinition, prefix: string, group: string) => {
      if (!accepts(variable)) return;
      const searchText =
        `${prefix}${variable.name} ${variable.displayName} ${variable.valueType.kind} ${variable.valueType.kind === 'json' ? variable.valueType.name : ''} ${group}`.toLocaleLowerCase();
      if (normalizedQuery && !searchText.includes(normalizedQuery)) return;
      options.push({ variable, prefix, group });
    };
    for (const variable of availableVariables) {
      const group = inputIds.has(variable.id)
        ? 'Substory Inputs'
        : localIds.has(variable.id)
          ? 'Substory Locals'
          : variable.scope === 'story'
            ? 'Story'
            : 'Chapter';
      addOption(variable, '', group);
    }
    for (const variable of projectVariables) addOption(variable, '', 'Project');
    for (const character of characters) {
      for (const field of character.fields ?? []) {
        addOption(field, `${character.displayName}.`, `Character · ${character.displayName}`);
      }
    }
    options.sort(
      (left, right) =>
        left.group.localeCompare(right.group) ||
        `${left.prefix}${left.variable.displayName}`.localeCompare(
          `${right.prefix}${right.variable.displayName}`,
        ),
    );
    return { results: options.slice(0, resultLimit), totalMatches: options.length };
  }, [
    availableVariables,
    allowedKinds,
    characters,
    inputIds,
    localIds,
    open,
    projectVariables,
    query,
    valueType,
  ]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    searchRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  const choose = (nextValue: VariableId | undefined) => {
    if (nextValue !== value) {
      onBeginEdit();
      onChange(nextValue);
    }
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={styles.field} ref={rootRef}>
      <span>{label}</span>
      <div className={styles.variablePicker}>
        <button
          type="button"
          className={`${styles.variablePickerTrigger} ${!selected && value ? styles.missingValue : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current);
            setQuery('');
          }}
        >
          <span>
            {selected
              ? `${selected.prefix}${selected.variable.displayName} · ${selected.variable.valueType.kind}`
              : value
                ? 'Missing variable'
                : 'Select variable…'}
          </span>
          <span className={styles.variablePickerChevron} aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        </button>
        {open && (
          <div className={styles.variablePickerPopup}>
            <input
              ref={searchRef}
              className={styles.variablePickerSearch}
              value={query}
              placeholder="Search name, type, or scope…"
              aria-label={`Search ${label}`}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((current) => Math.min(results.length - 1, current + 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(0, current - 1));
                } else if (event.key === 'Enter' && results[activeIndex]) {
                  event.preventDefault();
                  choose(results[activeIndex].variable.id);
                }
              }}
            />
            <div className={styles.variablePickerResults} role="listbox">
              {value && (
                <button
                  type="button"
                  className={styles.variablePickerClear}
                  onClick={() => choose(undefined)}
                >
                  Clear selection
                </button>
              )}
              {results.map((option, index) => {
                const previousGroup = index > 0 ? results[index - 1]?.group : undefined;
                return (
                  <div key={option.variable.id}>
                    {option.group !== previousGroup && (
                      <div className={styles.variablePickerGroup}>{option.group}</div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.variable.id === value}
                      className={`${styles.variablePickerOption} ${index === activeIndex ? styles.variablePickerOptionActive : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option.variable.id)}
                    >
                      <span>
                        {option.prefix}
                        {option.variable.displayName}
                      </span>
                      <small>
                        {option.variable.name} · {option.variable.valueType.kind}
                      </small>
                    </button>
                  </div>
                );
              })}
              {results.length === 0 && (
                <div className={styles.variablePickerEmpty}>No matching variables.</div>
              )}
            </div>
            {totalMatches > resultLimit && (
              <div className={styles.variablePickerLimit}>
                Showing {resultLimit} of {totalMatches}. Refine the search to see more.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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

function useStringExpressionMode({
  source,
  identity,
  checkpoint,
  updateSource,
}: {
  source: string;
  identity: string;
  checkpoint: () => void;
  updateSource: (source: string) => void;
}) {
  const { availableVariables, projectVariables, characters } = useStoryGraphStore();
  const textTemplate = expressionToTextTemplate(
    source,
    availableVariables,
    projectVariables,
    characters,
  );
  const drafts = useRef(createStringValueModeState(source, textTemplate));
  const [mode, setMode] = useState<'literal' | 'expression'>(() => drafts.current.mode);
  const expectedSource = useRef<string>();

  useEffect(() => {
    if (expectedSource.current === source) {
      expectedSource.current = undefined;
      return;
    }
    drafts.current = createStringValueModeState(
      source,
      expressionToTextTemplate(source, availableVariables, projectVariables, characters),
    );
    setMode(drafts.current.mode);
  }, [availableVariables, characters, identity, projectVariables, source]);

  const writeSource = (nextSource: string) => {
    expectedSource.current = nextSource;
    updateSource(nextSource);
  };

  const switchMode = (nextMode: 'literal' | 'expression') => {
    if (nextMode === mode) return;
    const transition = switchStringValueMode(drafts.current, source, nextMode, textTemplate);
    if (!transition.converted) return;
    drafts.current = transition.state;
    setMode(transition.state.mode);
    if (transition.source !== source) {
      checkpoint();
      writeSource(transition.source);
    }
  };

  return {
    mode,
    canConvertToText: textTemplate !== undefined,
    textValue: stringValueModeText(source, drafts.current),
    switchMode,
    updateText: (text: string) => {
      const transition = editStringValueText(drafts.current, text);
      drafts.current = transition.state;
      writeSource(transition.source);
    },
    updateExpression: (expression: string) => {
      drafts.current = { ...drafts.current, expressionDraft: expression };
      writeSource(expression);
    },
  };
}

function SetVariableEditor({ nodeId, data }: { nodeId: NodeId; data: SetVariableNodeData }) {
  const { availableVariables, projectVariables, characters, assets, engineTypes, edges, checkpoint, updateNodeData } =
    useStoryGraphStore();
  const allVariables = [
    ...availableVariables,
    ...projectVariables,
    ...characters.flatMap((character) => character.fields ?? []),
  ];
  const variable = allVariables.find((candidate) => candidate.id === data.variableId);
  const isString = variable?.valueType.kind === 'string';
  const jsonType = variable?.valueType.kind === 'json' ? variable.valueType : undefined;
  const isJson = jsonType !== undefined;
  const isArray = variable?.valueType.kind === 'array';
  const isMap = variable?.valueType.kind === 'map';
  const schema = jsonType
    ? engineTypes.find((candidate) => candidate.name === jsonType.name)
    : undefined;
  const fieldValueType = (field: EngineTypeDefinition['fields'][number]): ValueType => {
    const type = field.type;
    if (type.kind === 'object')
      return { kind: 'json', name: type.typeName, nullable: field.nullable };
    if (
      type.kind === 'array' ||
      type.kind === 'map' ||
      type.kind === 'boolean' ||
      type.kind === 'number' ||
      type.kind === 'string' ||
      type.kind === 'any'
    )
      return { kind: type.kind, nullable: field.nullable } as ValueType;
    if (type.kind === 'enum')
      return {
        kind: 'enum',
        name: `${schema?.name ?? jsonType?.name ?? 'EngineObject'}.${field.name}`,
        values: type.values,
        nullable: field.nullable,
      };
    return { kind: 'string', nullable: field.nullable };
  };
  const decodedLiteral = decodeStringLiteral(data.value.source);
  const valueConnected = edges.some(
    (edge) => edge.target === nodeId && edge.targetHandle === 'value',
  );
  const keyConnected = edges.some(
    (edge) => edge.target === nodeId && edge.targetHandle === 'key',
  );

  const updateValue = (source: string) =>
    updateNodeData(nodeId, StoryNodeType.SetVariable, {
      value: { source, bindings: {} },
    });
  const stringMode = useStringExpressionMode({
    source: data.value.source,
    identity: `${nodeId}:${data.variableId ?? ''}`,
    checkpoint,
    updateSource: updateValue,
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
          const nextIsJson = nextVariable?.valueType.kind === 'json';
          updateNodeData(nodeId, StoryNodeType.SetVariable, {
            variableId,
            containerOperation: undefined,
            key: undefined,
            fieldId: undefined,
            fieldName: undefined,
            fieldValueType: undefined,
            valueInputType: nextVariable?.valueType,
            keyInputType: undefined,
            ...(nextIsJson
              ? { value: { source: '{}', bindings: {} } }
              : nextIsString
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
      {(isArray || isMap || (isJson && schema)) && (
        <label className={styles.field}>
          <span>Operation</span>
          <select
            value={data.containerOperation ?? 'set'}
            onChange={(event) => {
              checkpoint();
              const operation = event.target.value;
              updateNodeData(nodeId, StoryNodeType.SetVariable, {
                containerOperation:
                  operation === 'set'
                    ? undefined
                    : (operation as 'append' | 'set-entry' | 'set-field'),
                key:
                  operation === 'set-entry'
                    ? data.key ?? { source: '"key"', bindings: {} }
                    : undefined,
                fieldId:
                  operation === 'set-field' ? (schema?.fields[0]?.id ?? undefined) : undefined,
                fieldName:
                  operation === 'set-field' ? (schema?.fields[0]?.name ?? undefined) : undefined,
                fieldValueType:
                  operation === 'set-field' && schema?.fields[0]
                    ? fieldValueType(schema.fields[0])
                    : undefined,
                valueInputType:
                  operation === 'set-field' && schema?.fields[0]
                    ? fieldValueType(schema.fields[0])
                    : operation === 'append' && variable?.valueType.kind === 'array'
                      ? variable.valueType.elementType ?? { kind: 'any' }
                      : operation === 'set-entry' && variable?.valueType.kind === 'map'
                        ? variable.valueType.valueType ?? { kind: 'any' }
                        : variable?.valueType,
                keyInputType:
                  operation === 'set-entry' && variable?.valueType.kind === 'map'
                    ? variable.valueType.keyType === 'number'
                      ? { kind: 'number' }
                      : { kind: 'string' }
                    : undefined,
                value:
                  operation === 'set'
                    ? { source: isArray ? '[]' : '{}', bindings: {} }
                    : operation === 'set-field' && schema?.fields[0]
                      ? {
                          source: JSON.stringify(schema.fields[0].defaultValue),
                          bindings: {},
                        }
                      : { source: isArray ? '0' : '"value"', bindings: {} },
              });
            }}
          >
            <option value="set">
              Set Entire {isArray ? 'Array' : isMap ? 'Map' : schema?.displayName ?? 'Object'}
            </option>
            {isArray && <option value="append">Add Item</option>}
            {isMap && <option value="set-entry">Set / Add Entry</option>}
            {isJson && schema && <option value="set-field">Set Object Field</option>}
          </select>
        </label>
      )}
      {isJson && schema && data.containerOperation === 'set-field' && (
        <label className={styles.field}>
          <span>Field</span>
          <select
            value={data.fieldId ?? ''}
            onChange={(event) => {
              checkpoint();
              const field = schema.fields.find((candidate) => candidate.id === event.target.value);
              updateNodeData(nodeId, StoryNodeType.SetVariable, {
                fieldId: field?.id,
                fieldName: field?.name,
                fieldValueType: field ? fieldValueType(field) : undefined,
                valueInputType: field ? fieldValueType(field) : undefined,
                value: {
                  source: JSON.stringify(field?.defaultValue ?? null),
                  bindings: {},
                },
              });
            }}
          >
            {schema.fields.map((field) => (
              <option value={field.id} key={field.id}>
                {field.displayName} · {field.type.kind}
              </option>
            ))}
          </select>
        </label>
      )}
      {valueConnected && (
        <div className={styles.info}>
          Value comes from a data connection. The Inspector value remains as the fallback after disconnecting.
        </div>
      )}
      {keyConnected && (
        <div className={styles.info}>
          Key comes from a data connection. The Inspector key remains as the fallback after disconnecting.
        </div>
      )}
      {isMap &&
      data.containerOperation === 'set-entry' &&
      (variable?.valueType.kind === 'map') &&
      (variable.valueType.keyType === 'character-ref' ||
        variable.valueType.keyType === 'asset-ref') ? (
        <label className={styles.field}>
          <span>Entry Key</span>
          <select
            value={decodeStringLiteral(data.key?.source ?? '') ?? ''}
            onChange={(event) => {
              checkpoint();
              updateNodeData(nodeId, StoryNodeType.SetVariable, {
                key: { source: JSON.stringify(event.target.value), bindings: {} },
              });
            }}
          >
            <option value="">Select {variable.valueType.keyType === 'character-ref' ? 'Character' : 'Asset'}…</option>
            {(variable.valueType.keyType === 'character-ref' ? characters : assets).map((resource) => (
              <option value={resource.id} key={resource.id}>
                {resource.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : isMap && data.containerOperation === 'set-entry' ? (
        <PropertyField
          label="Entry Key"
          value={data.key?.source ?? '"key"'}
          variableMode="expression"
          expectedType={
            variable?.valueType.kind === 'map' && variable.valueType.keyType === 'number'
              ? { kind: 'number' }
              : { kind: 'string' }
          }
          onBeginEdit={checkpoint}
          onChange={(source) =>
            updateNodeData(nodeId, StoryNodeType.SetVariable, {
              key: { source, bindings: {} },
            })
          }
        />
      ) : null}
      {isString && (
        <label className={styles.field}>
          <span>Value Mode</span>
          <select
            value={stringMode.mode}
            onChange={(event) =>
              stringMode.switchMode(event.target.value as 'literal' | 'expression')
            }
          >
            <option value="literal" disabled={!stringMode.canConvertToText}>
              {stringMode.canConvertToText ? 'Text' : 'Text (literal only)'}
            </option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {isJson && data.containerOperation !== 'set-field' ? (
        <EngineJsonSourceEditor
          label={`JSON or ${jsonType!.name} variable`}
          typeName={jsonType!.name}
          source={data.value.source}
          onBeginEdit={checkpoint}
          onChange={updateValue}
        />
      ) : data.containerOperation === 'set-field' && data.fieldValueType?.kind === 'json' ? (
        <EngineJsonSourceEditor
          label={`Field Value · ${data.fieldName ?? 'field'}`}
          typeName={data.fieldValueType.name}
          source={data.value.source}
          onBeginEdit={checkpoint}
          onChange={updateValue}
        />
      ) : isString && stringMode.mode === 'literal' ? (
        <PropertyField
          label="Text Value"
          value={stringMode.textValue}
          variableMode="template"
          onBeginEdit={checkpoint}
          onChange={stringMode.updateText}
        />
      ) : (
        <PropertyField
          label="Value Expression"
          value={data.value.source}
          variableMode="expression"
          expectedType={
            data.containerOperation === 'set-field'
              ? data.fieldValueType
              : data.containerOperation === 'append' && variable?.valueType.kind === 'array'
                ? variable.valueType.elementType ?? { kind: 'any' }
                : data.containerOperation === 'set-entry' && variable?.valueType.kind === 'map'
                  ? variable.valueType.valueType ?? { kind: 'any' }
              : data.containerOperation
                ? { kind: 'any' }
                : variable?.valueType
          }
          onBeginEdit={checkpoint}
          onChange={stringMode.updateExpression}
        />
      )}
    </>
  );
}

function EventArgumentEditor({
  nodeId,
  name,
  kind,
  typeName,
  value,
  argumentsByName,
}: {
  nodeId: NodeId;
  name: string;
  kind: 'boolean' | 'number' | 'string' | 'json';
  typeName?: string;
  value?: CallEventNodeData['arguments'][string];
  argumentsByName: CallEventNodeData['arguments'];
}) {
  const { checkpoint, updateNodeData } = useStoryGraphStore();
  const source =
    value?.source ??
    (kind === 'json' ? '{}' : kind === 'string' ? '""' : kind === 'boolean' ? 'false' : '0');

  const updateSource = (nextSource: string) =>
    updateNodeData(nodeId, StoryNodeType.CallEvent, {
      arguments: {
        ...argumentsByName,
        [name]: { source: nextSource, bindings: {} },
      },
    });
  const stringMode = useStringExpressionMode({
    source,
    identity: `${nodeId}:${name}:${kind}`,
    checkpoint,
    updateSource,
  });

  return (
    <>
      {kind === 'string' && (
        <label className={styles.field}>
          <span>{name} Mode</span>
          <select
            value={stringMode.mode}
            onChange={(event) =>
              stringMode.switchMode(event.target.value as 'literal' | 'expression')
            }
          >
            <option value="literal" disabled={!stringMode.canConvertToText}>
              {stringMode.canConvertToText ? 'Text' : 'Text (literal only)'}
            </option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {kind === 'json' ? (
        <EngineJsonSourceEditor
          label={`${name} · JSON or ${typeName || 'Engine JSON'} variable`}
          typeName={typeName ?? ''}
          source={source}
          onBeginEdit={checkpoint}
          onChange={updateSource}
        />
      ) : kind === 'string' && stringMode.mode === 'literal' ? (
        <PropertyField
          label={`${name} · string`}
          value={stringMode.textValue}
          variableMode="template"
          onBeginEdit={checkpoint}
          onChange={stringMode.updateText}
        />
      ) : (
        <PropertyField
          label={`${name} · ${kind}`}
          value={source}
          variableMode="expression"
          expectedType={{ kind }}
          onBeginEdit={checkpoint}
          onChange={stringMode.updateExpression}
        />
      )}
    </>
  );
}

function SignalMatchEditor({
  nodeId,
  name,
  kind,
  typeName,
  value,
  matches,
}: {
  nodeId: NodeId;
  name: string;
  kind: 'boolean' | 'number' | 'string' | 'json';
  typeName?: string;
  value?: WaitSignalNodeData['matches'][string];
  matches: WaitSignalNodeData['matches'];
}) {
  const { checkpoint, updateNodeData } = useStoryGraphStore();
  const enabled = value !== undefined;
  const source =
    value?.source ??
    (kind === 'json' ? '{}' : kind === 'string' ? '""' : kind === 'boolean' ? 'false' : '0');

  const updateSource = (nextSource: string) =>
    updateNodeData(nodeId, StoryNodeType.WaitSignal, {
      matches: { ...matches, [name]: { source: nextSource, bindings: {} } },
    });
  const stringMode = useStringExpressionMode({
    source,
    identity: `${nodeId}:${name}:${kind}`,
    checkpoint,
    updateSource,
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
            value={stringMode.mode}
            onChange={(event) =>
              stringMode.switchMode(event.target.value as 'literal' | 'expression')
            }
          >
            <option value="literal" disabled={!stringMode.canConvertToText}>
              {stringMode.canConvertToText ? 'Text' : 'Text (literal only)'}
            </option>
            <option value="expression">Expression</option>
          </select>
        </label>
      )}
      {enabled &&
        (kind === 'json' ? (
          <EngineJsonSourceEditor
            label={`${name} · JSON or ${typeName || 'Engine JSON'} variable`}
            typeName={typeName ?? ''}
            source={source}
            onBeginEdit={checkpoint}
            onChange={updateSource}
          />
        ) : kind === 'string' && stringMode.mode === 'literal' ? (
          <PropertyField
            label={`${name} · string`}
            value={stringMode.textValue}
            variableMode="template"
            onBeginEdit={checkpoint}
            onChange={stringMode.updateText}
          />
        ) : (
          <PropertyField
            label={`${name} · ${kind}`}
            value={source}
            variableMode="expression"
            expectedType={{ kind }}
            onBeginEdit={checkpoint}
            onChange={stringMode.updateExpression}
          />
        ))}
    </>
  );
}

function ChoiceEditor({ nodeId, data }: { nodeId: NodeId; data: ChoiceNodeData }) {
  const { nodes, edges, setEdges, checkpoint, updateNodeData, source, activeGraphId, saveStory } =
    useStoryGraphStore();
  const [draggedOptionId, setDraggedOptionId] = useState<OptionId>();
  const [dragTargetOptionId, setDragTargetOptionId] = useState<OptionId>();
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
    checkpoint(inkUndoSnapshotRef.current ?? { nodes, edges }, 'Edit Choice Ink');
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
                } ${dragTargetOptionId === option.id ? styles.reorderTarget : ''}`}
                onDragOver={(event) => {
                  if (draggedOptionId) {
                    event.preventDefault();
                    setDragTargetOptionId(option.id);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedOptionId && draggedOptionId !== option.id)
                    moveOption(draggedOptionId, index);
                  setDraggedOptionId(undefined);
                  setDragTargetOptionId(undefined);
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
                    onDragEnd={() => {
                      setDraggedOptionId(undefined);
                      setDragTargetOptionId(undefined);
                    }}
                  >
                    ⠿
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
                      expectedType={{ kind: 'boolean' }}
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
                      expectedType={{ kind: 'boolean' }}
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
  const [dragTargetLineId, setDragTargetLineId] = useState<DialogueLineId>();
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
    checkpoint(inkUndoSnapshotRef.current ?? { nodes, edges }, 'Edit Dialogue Ink');
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
              } ${dragTargetLineId === line.id ? styles.reorderTarget : ''}`}
              onDragOver={(event) => {
                if (draggedLineId) {
                  event.preventDefault();
                  setDragTargetLineId(line.id);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedLineId && draggedLineId !== line.id) moveLine(draggedLineId, index);
                setDraggedLineId(undefined);
                setDragTargetLineId(undefined);
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
                  onDragEnd={() => {
                    setDraggedLineId(undefined);
                    setDragTargetLineId(undefined);
                  }}
                >
                  ⠿
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
                  {index < data.lines.length - 1 && (
                    <button
                      type="button"
                      title={`Split Dialogue after line ${index + 1}`}
                      onClick={() => {
                        const suffixLineIds = data.lines
                          .slice(index + 1)
                          .map((candidate) => candidate.id);
                        const result = splitDialogueLines(nodeId, suffixLineIds);
                        if (!result.ok) {
                          setLineOperationError(result.message);
                          return;
                        }
                        setSelectedLineIds(new Set());
                        setLineOperationError(undefined);
                      }}
                    >
                      Split after
                    </button>
                  )}
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

type ScalarKind = 'boolean' | 'number' | 'string';
type InterfaceKind = ScalarKind | 'json';

function defaultValueFor(kind: ScalarKind): RuntimeValue {
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  return '';
}

function expressionForDefault(value: RuntimeValue): ExpressionSource {
  return { source: JSON.stringify(value), bindings: {} };
}

function InterfaceVariableRow({
  variable,
  label,
  showDefault = true,
  onChange,
  onRemove,
}: {
  variable: VariableDefinition;
  label: string;
  showDefault?: boolean;
  onChange: (variable: VariableDefinition) => void;
  onRemove: () => void;
}) {
  const { engineTypes } = useStoryGraphStore();
  const [name, setName] = useState(variable.name);
  const [displayName, setDisplayName] = useState(variable.displayName);
  const [defaultValue, setDefaultValue] = useState(
    variable.valueType.kind === 'json'
      ? JSON.stringify(variable.defaultValue, null, 2)
      : String(variable.defaultValue),
  );
  useEffect(() => setName(variable.name), [variable.name]);
  useEffect(() => setDisplayName(variable.displayName), [variable.displayName]);
  useEffect(
    () =>
      setDefaultValue(
        variable.valueType.kind === 'json'
          ? JSON.stringify(variable.defaultValue, null, 2)
          : String(variable.defaultValue),
      ),
    [variable.defaultValue, variable.valueType.kind],
  );
  const kind = variable.valueType.kind as InterfaceKind;
  const interfaceEngineTypeName =
    variable.valueType.kind === 'json' ? variable.valueType.name : 'EnginePayload';
  const commitDefault = () => {
    let next: RuntimeValue;
    try {
      next =
        kind === 'json'
          ? (JSON.parse(defaultValue) as RuntimeValue)
          : kind === 'boolean'
            ? defaultValue === 'true'
            : kind === 'number'
              ? Number(defaultValue)
              : defaultValue;
    } catch {
      setDefaultValue(JSON.stringify(variable.defaultValue, null, 2));
      return;
    }
    if (kind === 'number' && !Number.isFinite(next)) {
      setDefaultValue(String(variable.defaultValue));
      return;
    }
    onChange({ ...variable, defaultValue: next });
  };
  return (
    <div className={styles.optionGroup}>
      <div className={styles.groupHeader}>
        <div className={styles.groupLabel}>{label}</div>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
      {showDefault && (
        <label className={styles.field}>
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next) onChange({ ...variable, name: next });
              else setName(variable.name);
            }}
          />
        </label>
      )}
      <label className={styles.field}>
        <span>Display Name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          onBlur={() => {
            const next = displayName.trim();
            if (next) onChange({ ...variable, displayName: next });
            else setDisplayName(variable.displayName);
          }}
        />
      </label>
      <label className={styles.field}>
        <span>Type</span>
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value as InterfaceKind;
            onChange({
              ...variable,
              valueType:
                nextKind === 'json'
                  ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
                  : { kind: nextKind },
              defaultValue:
                nextKind === 'json'
                  ? Object.fromEntries(
                      (engineTypes[0]?.fields ?? []).map((field) => [
                        field.name,
                        structuredClone(field.defaultValue),
                      ]),
                    )
                  : defaultValueFor(nextKind),
            });
          }}
        >
          <option value="boolean">Boolean</option>
          <option value="number">Number</option>
          <option value="string">String</option>
          <option value="json">Engine JSON</option>
        </select>
      </label>
      {variable.valueType.kind === 'json' && (
        <label className={styles.field}>
          <span>Engine Type</span>
          <select
            value={variable.valueType.name}
            onChange={(event) =>
              onChange({
                ...variable,
                valueType: { kind: 'json', name: event.target.value },
                defaultValue: Object.fromEntries(
                  (engineTypes.find((item) => item.name === event.target.value)?.fields ?? []).map(
                    (field) => [field.name, structuredClone(field.defaultValue)],
                  ),
                ),
              })
            }
          >
            {!engineTypes.some((item) => item.name === interfaceEngineTypeName) && (
              <option value={interfaceEngineTypeName}>{interfaceEngineTypeName} (undefined)</option>
            )}
            {engineTypes.map((item) => (
              <option key={item.name} value={item.name}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.field}>
        <span>Default Value</span>
        {kind === 'json' ? (
          <JsonValueInput
            value={variable.defaultValue}
            schema={engineTypes.find((item) => item.name === interfaceEngineTypeName)}
            engineTypes={engineTypes}
            onCommit={(next) => onChange({ ...variable, defaultValue: next })}
          />
        ) : kind === 'boolean' ? (
          <select
            value={defaultValue}
            onChange={(event) => {
              setDefaultValue(event.target.value);
              onChange({ ...variable, defaultValue: event.target.value === 'true' });
            }}
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        ) : (
          <textarea
            rows={1}
            value={defaultValue}
            onChange={(event) => setDefaultValue(event.target.value)}
            onBlur={commitDefault}
          />
        )}
      </label>
      <div className={styles.stableIds}>
        <code>{variable.id}</code>
      </div>
    </div>
  );
}

function SubstoryInterfaceEditor() {
  const { activeGraphId, chapters, updateSubstory } = useStoryGraphStore();
  const chapter = chapters.find((candidate) => candidate.id === activeGraphId);
  if (!chapter) return null;
  const usedNames = new Set([
    ...chapter.parameters.map((parameter) => parameter.variable.name),
    ...chapter.outputs.map((output) => output.variable.name),
    ...chapter.localVariables.map((variable) => variable.name),
  ]);
  const replaceParameter = (id: VariableId, variable: VariableDefinition) =>
    updateSubstory(chapter.id, {
      parameters: chapter.parameters.map((parameter) =>
        parameter.variable.id === id ? { ...parameter, variable } : parameter,
      ),
    });
  const replaceLocal = (id: VariableId, variable: VariableDefinition) =>
    updateSubstory(chapter.id, {
      localVariables: chapter.localVariables.map((candidate) =>
        candidate.id === id ? variable : candidate,
      ),
    });
  const replaceOutput = (id: VariableId, variable: VariableDefinition) =>
    updateSubstory(chapter.id, {
      outputs: chapter.outputs.map((output) =>
        output.variable.id === id ? { ...output, variable } : output,
      ),
    });
  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Substory Interface</div>
          <MetadataTitleField
            value={chapter.displayName}
            onCommit={(displayName) => updateSubstory(chapter.id, { displayName })}
          />
          <div className={styles.readonlyField}>
            <span>Internal Name</span>
            <code>{chapter.name}</code>
          </div>
          <div className={styles.info}>
            Parameters come from the caller. Local variables exist only during this call.
          </div>
          <div className={styles.groupHeader}>
            <div className={styles.groupLabel}>Input Parameters</div>
            <NamedCreateControl
              title="Add input parameter"
              placeholder="Input name"
              buttonLabel="Add Parameter"
              existingNames={[...usedNames]}
              onCreate={(name) => {
                const variable: VariableDefinition = {
                  id: createStableId('variable'),
                  name,
                  displayName: name,
                  scope: 'local',
                  valueType: { kind: 'string' },
                  defaultValue: '',
                };
                const parameter: ChapterParameter = { direction: 'input', variable };
                updateSubstory(chapter.id, { parameters: [...chapter.parameters, parameter] });
              }}
            />
          </div>
          {chapter.parameters.length === 0 && <div className={styles.info}>No inputs.</div>}
          {chapter.parameters.map((parameter, index) => (
            <InterfaceVariableRow
              key={parameter.variable.id}
              variable={parameter.variable}
              label={`Parameter ${index + 1}`}
              onChange={(variable) => replaceParameter(parameter.variable.id, variable)}
              onRemove={() =>
                updateSubstory(chapter.id, {
                  parameters: chapter.parameters.filter(
                    (item) => item.variable.id !== parameter.variable.id,
                  ),
                })
              }
            />
          ))}
          <div className={styles.groupHeader}>
            <div className={styles.groupLabel}>Output Parameters</div>
            <NamedCreateControl
              title="Add output parameter"
              placeholder="Output name"
              buttonLabel="Add Output"
              existingNames={[...usedNames]}
              onCreate={(name) => {
                const variable: VariableDefinition = {
                  id: createStableId('variable'),
                  name,
                  displayName: name,
                  scope: 'local',
                  valueType: { kind: 'string' },
                  defaultValue: '',
                };
                updateSubstory(chapter.id, {
                  outputs: [...chapter.outputs, { direction: 'output', variable }],
                });
              }}
            />
          </div>
          {chapter.outputs.length === 0 && <div className={styles.info}>No outputs.</div>}
          {chapter.outputs.map((output, index) => (
            <InterfaceVariableRow
              key={output.variable.id}
              variable={output.variable}
              label={`Output ${index + 1}`}
              showDefault={false}
              onChange={(variable) => replaceOutput(output.variable.id, variable)}
              onRemove={() =>
                updateSubstory(chapter.id, {
                  outputs: chapter.outputs.filter(
                    (item) => item.variable.id !== output.variable.id,
                  ),
                })
              }
            />
          ))}
          <div className={styles.groupHeader}>
            <div className={styles.groupLabel}>Local Variables</div>
            <NamedCreateControl
              title="Add local variable"
              placeholder="Local name"
              buttonLabel="Add Local"
              existingNames={[...usedNames]}
              onCreate={(name) => {
                updateSubstory(chapter.id, {
                  localVariables: [
                    ...chapter.localVariables,
                    {
                      id: createStableId('variable'),
                      name,
                      displayName: name,
                      scope: 'local',
                      valueType: { kind: 'string' },
                      defaultValue: '',
                    },
                  ],
                });
              }}
            />
          </div>
          {chapter.localVariables.length === 0 && <div className={styles.info}>No locals.</div>}
          {chapter.localVariables.map((variable, index) => (
            <InterfaceVariableRow
              key={variable.id}
              variable={variable}
              label={`Local ${index + 1}`}
              onChange={(next) => replaceLocal(variable.id, next)}
              onRemove={() =>
                updateSubstory(chapter.id, {
                  localVariables: chapter.localVariables.filter((item) => item.id !== variable.id),
                })
              }
            />
          ))}
        </section>
      </div>
    </div>
  );
}

export function Inspector() {
  const {
    hasActiveStory,
    document,
    nodes,
    availableVariables,
    projectVariables,
    characters,
    events,
    signals,
    engineTypes,
    chapters,
    activeGraphId,
    checkpoint,
    updateNode,
    updateNodeData,
    updateSubstory,
    updateStory,
    mergeSelectedDialogues,
    storyDataSelection,
    revealWorkspaceItem,
  } = useStoryGraphStore();
  const [multiNodeError, setMultiNodeError] = useState<string>();
  const [inkSourceError, setInkSourceError] = useState<string>();
  const selected = nodes.filter((node) => node.selected);
  const selectedNodeKey = selected.map((node) => node.id).join('|');
  useEffect(() => {
    setMultiNodeError(undefined);
    setInkSourceError(undefined);
  }, [selectedNodeKey]);

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
    if (selected.length === 0 && activeGraphId !== 'root') {
      return <SubstoryInterfaceEditor />;
    }
    if (selected.length === 0 && hasActiveStory && activeGraphId === 'root') {
      return (
        <div className={panelStyles.panel}>
          <div className={`${panelStyles.body} ${styles.body}`}>
            <section className={styles.section}>
              <div className={styles.sectionTitle}>Story</div>
              <MetadataTitleField
                value={document.displayName}
                onCommit={(displayName) => updateStory({ displayName })}
              />
              <div className={styles.readonlyField}>
                <span>Internal Name</span>
                <code>{document.name}</code>
              </div>
              <div className={styles.readonlyField}>
                <span>ID</span>
                <code title={document.id}>{document.id}</code>
              </div>
            </section>
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
  if (node.type === StoryNodeType.Start && activeGraphId !== 'root') {
    return <SubstoryInterfaceEditor />;
  }
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
      case StoryNodeType.InkBlock: {
        const data = node.data as InkBlockNodeData;
        const scalarKinds: readonly ValueType['kind'][] = ['boolean', 'number', 'string', 'enum'];
        const scalarVariables = [
          ...availableVariables,
          ...projectVariables,
          ...characters.flatMap((character) => character.fields ?? []),
        ].filter((variable) => scalarKinds.includes(variable.valueType.kind));
        const variableBindings = [...(data.variableBindings ?? [])];
        const setVariableBindings = (next: typeof variableBindings) => {
          checkpoint();
          updateNodeData(node.id, StoryNodeType.InkBlock, { variableBindings: next });
        };
        const addVariableBinding = () => {
          const variable = scalarVariables[0];
          if (!variable) {
            setInkSourceError('Create a Boolean, Number, String, or Enum variable first.');
            return;
          }
          const baseName = variable.name.replace(/[^A-Za-z0-9_]/g, '_') || 'ink_variable';
          let inkName = /^[A-Za-z_]/.test(baseName) ? baseName : `_${baseName}`;
          let suffix = 2;
          while (variableBindings.some((binding) => binding.inkName === inkName)) {
            inkName = `${baseName}_${suffix++}`;
          }
          setVariableBindings([
            ...variableBindings,
            { inkName, variableId: variable.id, direction: 'two-way' },
          ]);
        };
        const changeInkSourceMode = async (sourceMode: InkBlockNodeData['sourceMode']) => {
          if ((sourceMode === data.sourceMode && sourceMode !== 'linked') || !window.electronAPI)
            return;
          setInkSourceError(undefined);
          try {
            if (sourceMode === 'linked') {
              const picked = await window.electronAPI.pickWorkspaceInkFile();
              if (picked.canceled) return;
              checkpoint();
              updateNodeData(node.id, StoryNodeType.InkBlock, {
                sourceMode: 'linked',
                path: picked.relativePath,
                entryKnot: data.entryKnot,
              });
            } else {
              if (data.sourceMode !== 'linked') return;
              const loaded = await window.electronAPI.readWorkspaceInkFile(data.path);
              if (loaded.canceled) return;
              checkpoint();
              updateNodeData(node.id, StoryNodeType.InkBlock, {
                sourceMode: 'embedded',
                source: loaded.content,
                entryKnot: data.entryKnot,
              });
            }
          } catch (error) {
            setInkSourceError(error instanceof Error ? error.message : String(error));
          }
        };
        return (
          <>
            <div className={styles.info}>
              Ink runs as one resumable block. Embed it in the Story or link a project .ink file.
              Its choices stay inside the block. Dialogue metadata uses stable IDs on the same
              output line: # speaker:c_id # voice:a_id # emotion:happy # text-id:t_id. Other Ink
              tags are forwarded to the adapter unchanged.
            </div>
            <label className={styles.field}>
              <span>Source Mode</span>
              <select
                value={data.sourceMode}
                onChange={(event) =>
                  void changeInkSourceMode(event.target.value as InkBlockNodeData['sourceMode'])
                }
              >
                <option value="embedded">Embedded</option>
                <option value="linked">Linked .ink file</option>
              </select>
            </label>
            <PropertyField
              label="Entry knot (optional)"
              value={data.entryKnot ?? ''}
              onBeginEdit={checkpoint}
              onChange={(entryKnot) =>
                updateNodeData(node.id, StoryNodeType.InkBlock, {
                  entryKnot: entryKnot.trim() || undefined,
                })
              }
            />
            <div className={styles.groupHeader}>
              <div className={styles.groupLabel}>Variable Bridge</div>
              <button type="button" onClick={addVariableBinding}>
                + Add Mapping
              </button>
            </div>
            {variableBindings.length === 0 && (
              <div className={styles.info}>
                No variables are shared. Add an explicit mapping to pass scalar values between Story
                and Ink.
              </div>
            )}
            {variableBindings.map((binding, index) => (
              <div className={styles.inkVariableBinding} key={`${binding.inkName}:${index}`}>
                <PropertyField
                  label="Ink Variable"
                  value={binding.inkName}
                  onBeginEdit={checkpoint}
                  onChange={(inkName) =>
                    updateNodeData(node.id, StoryNodeType.InkBlock, {
                      variableBindings: variableBindings.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, inkName } : candidate,
                      ),
                    })
                  }
                />
                <VariableSelect
                  label="Story Variable"
                  value={binding.variableId}
                  allowedKinds={scalarKinds}
                  onBeginEdit={checkpoint}
                  onChange={(variableId) => {
                    if (!variableId) return;
                    updateNodeData(node.id, StoryNodeType.InkBlock, {
                      variableBindings: variableBindings.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, variableId } : candidate,
                      ),
                    });
                  }}
                />
                <label className={styles.field}>
                  <span>Direction</span>
                  <select
                    value={binding.direction}
                    onFocus={() => checkpoint()}
                    onChange={(event) =>
                      updateNodeData(node.id, StoryNodeType.InkBlock, {
                        variableBindings: variableBindings.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                direction: event.target.value as InkVariableDirection,
                              }
                            : candidate,
                        ),
                      })
                    }
                  >
                    <option value="story-to-ink">Story → Ink</option>
                    <option value="ink-to-story">Ink → Story</option>
                    <option value="two-way">Two-way</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.removeInkVariableBinding}
                  onClick={() =>
                    setVariableBindings(variableBindings.filter((_, item) => item !== index))
                  }
                >
                  Remove Mapping
                </button>
              </div>
            ))}
            {data.sourceMode === 'embedded' ? (
              <PropertyField
                label="Ink Source"
                value={data.source}
                multiline
                onBeginEdit={checkpoint}
                onChange={(source) =>
                  updateNodeData(node.id, StoryNodeType.InkBlock, {
                    sourceMode: 'embedded',
                    source,
                  })
                }
              />
            ) : (
              <>
                <div className={styles.readonlyField}>
                  <span>Linked File</span>
                  <code title={data.path}>{data.path}</code>
                </div>
                <div className={styles.linkedInkActions}>
                  <button type="button" onClick={() => void changeInkSourceMode('linked')}>
                    Relink…
                  </button>
                  <button type="button" onClick={() => void revealWorkspaceItem(data.path)}>
                    Show in Explorer
                  </button>
                  <button type="button" onClick={() => void changeInkSourceMode('embedded')}>
                    Embed Copy
                  </button>
                </div>
              </>
            )}
            {inkSourceError && <div className={styles.warning}>{inkSourceError}</div>}
          </>
        );
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
            expectedType={{ kind: 'boolean' }}
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
        const selectedVariable = [...availableVariables, ...projectVariables].find(
          (candidate) => candidate.id === data.variableId,
        );
        const selectedJsonType =
          selectedVariable?.valueType.kind === 'json' ? selectedVariable.valueType : undefined;
        const schema = selectedJsonType
          ? engineTypes.find((candidate) => candidate.name === selectedJsonType.name)
          : undefined;
        const indexedOutputType =
          selectedVariable?.valueType.kind === 'array'
            ? selectedVariable.valueType.elementType ?? { kind: 'any' as const }
            : selectedVariable?.valueType.kind === 'map'
              ? selectedVariable.valueType.valueType ?? { kind: 'any' as const }
              : { kind: 'any' as const };
        const fieldValueType = (field: EngineTypeDefinition['fields'][number]): ValueType => {
          const type = field.type;
          if (type.kind === 'object') return { kind: 'json', name: type.typeName, nullable: field.nullable };
          if (type.kind === 'array' || type.kind === 'map' || type.kind === 'boolean' || type.kind === 'number' || type.kind === 'string' || type.kind === 'any') {
            return { kind: type.kind, nullable: field.nullable } as ValueType;
          }
          if (type.kind === 'enum') {
            return {
              kind: 'enum',
              name: `${schema?.name ?? 'EngineObject'}.${field.name}`,
              values: type.values,
              nullable: field.nullable,
            };
          }
          return { kind: 'string', nullable: field.nullable };
        };
        return (
          <>
            <VariableSelect
              label="Variable"
              value={data.variableId}
              onBeginEdit={checkpoint}
              onChange={(variableId) =>
                updateNodeData(node.id, StoryNodeType.GetVariable, {
                  variableId,
                  accessor: undefined,
                  exposedFields: [],
                  outputValueType: [...availableVariables, ...projectVariables].find(
                    (candidate) => candidate.id === variableId,
                  )?.valueType,
                })
              }
            />
            {schema && (
              <div className={styles.exposedFields}>
                <div className={styles.groupLabel}>Output Pins</div>
                <div className={styles.info}>
                  The whole object is always available. Expose only fields that need their own Pin.
                </div>
                {schema.fields.map((field) => {
                  const exposed = (data.exposedFields ?? []).some(
                    (candidate) => candidate.fieldId === field.id,
                  );
                  return (
                    <label key={field.id} className={styles.exposedFieldRow}>
                      <input
                        type="checkbox"
                        checked={exposed}
                        onChange={() => {
                          checkpoint();
                          const next = exposed
                            ? (data.exposedFields ?? []).filter(
                                (candidate) => candidate.fieldId !== field.id,
                              )
                            : [
                                ...(data.exposedFields ?? []),
                                {
                                  fieldId: field.id,
                                  member: field.name,
                                  displayName: field.displayName,
                                  valueType: fieldValueType(field),
                                },
                              ];
                          updateNodeData(node.id, StoryNodeType.GetVariable, {
                            accessor: undefined,
                            exposedFields: next,
                            outputValueType: selectedVariable?.valueType,
                          });
                        }}
                      />
                      <span>{field.displayName}</span>
                      <em>{field.type.kind}</em>
                    </label>
                  );
                })}
              </div>
            )}
            {(selectedVariable?.valueType.kind === 'array' || selectedVariable?.valueType.kind === 'map') && (
              <PropertyField
                label={selectedVariable.valueType.kind === 'array' ? 'Index' : 'Key'}
                value={data.accessor?.kind === 'index' ? data.accessor.index.source : selectedVariable.valueType.kind === 'array' ? '0' : '"key"'}
                variableMode="expression"
                expectedType={
                  selectedVariable.valueType.kind === 'array' ||
                  selectedVariable.valueType.keyType !== 'number'
                    ? { kind: selectedVariable.valueType.kind === 'array' ? 'number' : 'string' }
                    : { kind: 'number' }
                }
                onBeginEdit={checkpoint}
                onChange={(source) => updateNodeData(node.id, StoryNodeType.GetVariable, {
                  accessor: {
                    kind: 'index',
                    index: { source, bindings: {} },
                    valueType: indexedOutputType,
                  },
                  outputValueType: indexedOutputType,
                })}
              />
            )}
          </>
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
                                : parameter.valueType.kind === 'json'
                                  ? '{}'
                                  : '0',
                          bindings: {},
                        },
                      ]),
                    ),
                    resultVariableIds: {},
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
                kind={parameter.valueType.kind as 'boolean' | 'number' | 'string' | 'json'}
                typeName={
                  parameter.valueType.kind === 'json' ? parameter.valueType.name : undefined
                }
                value={data.arguments[parameter.name]}
                argumentsByName={data.arguments}
              />
            ))}
            {(selectedEvent?.outputs ?? []).map((output) => {
              const compatibleVariables = [...availableVariables, ...projectVariables].filter(
                (variable) =>
                  variable.valueType.kind === output.valueType.kind &&
                  (variable.valueType.kind !== 'json' ||
                    (output.valueType.kind === 'json' &&
                      variable.valueType.name === output.valueType.name)),
              );
              return (
                <label className={styles.field} key={output.id}>
                  <span>Store {output.displayName}</span>
                  <select
                    value={data.resultVariableIds?.[output.id] ?? ''}
                    onChange={(event) => {
                      checkpoint();
                      const variableId = event.target.value;
                      updateNodeData(node.id, StoryNodeType.CallEvent, {
                        resultVariableIds: {
                          ...(data.resultVariableIds ?? {}),
                          [output.id]: variableId || undefined,
                        },
                      });
                    }}
                  >
                    <option value="">Do not store</option>
                    {compatibleVariables.map((variable) => (
                      <option value={variable.id} key={variable.id}>
                        {variable.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            <div className={styles.info}>
              {(selectedEvent?.outputs?.length ?? 0) > 0
                ? 'Waits for the engine result, validates every return value, then continues.'
                : 'Dispatches the event to the engine and continues when the adapter resolves.'}
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
                kind={parameter.valueType.kind as 'boolean' | 'number' | 'string' | 'json'}
                typeName={
                  parameter.valueType.kind === 'json' ? parameter.valueType.name : undefined
                }
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
        const selectedChapter = chapters.find((candidate) => candidate.id === data.chapterId);
        return (
          <>
            <label className={styles.field}>
              <span>Substory</span>
              <select
                value={data.chapterId ?? ''}
                onChange={(event) => {
                  checkpoint();
                  updateNodeData(node.id, StoryNodeType.CallSubstory, {
                    chapterId: (event.target.value ||
                      undefined) as CallSubstoryNodeData['chapterId'],
                    arguments: {},
                    resultVariableIds: {},
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
            {selectedChapter?.parameters.map((parameter) => {
              const current = (data.arguments ?? {})[parameter.variable.id];
              const source =
                current?.source ?? expressionForDefault(parameter.variable.defaultValue).source;
              if (parameter.variable.valueType.kind === 'json') {
                return (
                  <EngineJsonSourceEditor
                    key={parameter.variable.id}
                    label={`${parameter.variable.displayName} · JSON or ${parameter.variable.valueType.name} variable`}
                    typeName={parameter.variable.valueType.name}
                    source={source}
                    onBeginEdit={checkpoint}
                    onChange={(nextSource) =>
                      updateNodeData(node.id, StoryNodeType.CallSubstory, {
                        arguments: {
                          ...(data.arguments ?? {}),
                          [parameter.variable.id]: { source: nextSource, bindings: {} },
                        },
                      })
                    }
                  />
                );
              }
              return (
                <PropertyField
                  key={parameter.variable.id}
                  label={`${parameter.variable.displayName} · ${parameter.variable.valueType.kind}`}
                  value={source}
                  variableMode="expression"
                  expectedType={parameter.variable.valueType}
                  onBeginEdit={checkpoint}
                  onChange={(source) =>
                    updateNodeData(node.id, StoryNodeType.CallSubstory, {
                      arguments: {
                        ...(data.arguments ?? {}),
                        [parameter.variable.id]: { source, bindings: {} },
                      },
                    })
                  }
                />
              );
            })}
            {selectedChapter?.outputs.map((output) => (
              <VariableSelect
                key={output.variable.id}
                label={
                  output.variable.valueType.kind === 'json'
                    ? `Output · ${output.variable.displayName} · JSON or ${output.variable.valueType.name} variable`
                    : `Output · ${output.variable.displayName} · ${output.variable.valueType.kind}`
                }
                value={(data.resultVariableIds ?? {})[output.variable.id]}
                valueType={output.variable.valueType}
                onBeginEdit={checkpoint}
                onChange={(resultVariableId) =>
                  updateNodeData(node.id, StoryNodeType.CallSubstory, {
                    resultVariableIds: resultVariableId
                      ? {
                          ...(data.resultVariableIds ?? {}),
                          [output.variable.id]: resultVariableId,
                        }
                      : Object.fromEntries(
                          Object.entries(data.resultVariableIds ?? {}).filter(
                            ([id]) => id !== output.variable.id,
                          ),
                        ),
                  })
                }
              />
            ))}
            {selectedChapter && (
              <div className={styles.info}>
                Unchanged inputs use their defaults. The result target is optional.
              </div>
            )}
          </>
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
      case StoryNodeType.Return: {
        const data = node.data as ReturnNodeData;
        const chapter = chapters.find((candidate) => candidate.id === activeGraphId);
        if (!chapter) return <div className={styles.info}>Return requires a substory.</div>;
        return (
          <>
            <div className={styles.groupHeader}>
              <div className={styles.groupLabel}>Function Outputs</div>
              <NamedCreateControl
                title="Add function output"
                placeholder="Output name"
                buttonLabel="Add Output"
                existingNames={[
                  ...chapter.parameters.map((parameter) => parameter.variable.name),
                  ...chapter.outputs.map((output) => output.variable.name),
                  ...chapter.localVariables.map((variable) => variable.name),
                ]}
                onCreate={(name) => {
                  updateSubstory(chapter.id, {
                    outputs: [
                      ...chapter.outputs,
                      {
                        direction: 'output',
                        variable: {
                          id: createStableId('variable'),
                          name,
                          displayName: name,
                          scope: 'local',
                          valueType: { kind: 'string' },
                          defaultValue: '',
                        },
                      },
                    ],
                  });
                }}
              />
            </div>
            {chapter.outputs.length === 0 && (
              <div className={styles.info}>No outputs. This returns execution only.</div>
            )}
            {chapter.outputs.map((output, index) => (
              <InterfaceVariableRow
                key={output.variable.id}
                variable={output.variable}
                label={`Output ${index + 1}`}
                showDefault={false}
                onChange={(variable) =>
                  updateSubstory(chapter.id, {
                    outputs: chapter.outputs.map((candidate) =>
                      candidate.variable.id === output.variable.id
                        ? { ...candidate, variable }
                        : candidate,
                    ),
                  })
                }
                onRemove={() =>
                  updateSubstory(chapter.id, {
                    outputs: chapter.outputs.filter(
                      (candidate) => candidate.variable.id !== output.variable.id,
                    ),
                  })
                }
              />
            ))}
            {chapter.outputs.map((output) =>
              output.variable.valueType.kind === 'json' ? (
                <EngineJsonSourceEditor
                  key={output.variable.id}
                  label={`Output · ${output.variable.displayName} · JSON or ${output.variable.valueType.name} variable`}
                  typeName={output.variable.valueType.name}
                  source={
                    data.values?.[output.variable.id]?.source ??
                    expressionForDefault(output.variable.defaultValue).source
                  }
                  onBeginEdit={checkpoint}
                  onChange={(source) =>
                    updateNodeData(node.id, StoryNodeType.Return, {
                      values: {
                        ...(data.values ?? {}),
                        [output.variable.id]: { source, bindings: {} },
                      },
                    })
                  }
                />
              ) : (
                <PropertyField
                  key={output.variable.id}
                  label={`Output · ${output.variable.displayName} · ${output.variable.valueType.kind}`}
                  value={
                    data.values?.[output.variable.id]?.source ??
                    expressionForDefault(output.variable.defaultValue).source
                  }
                  variableMode="expression"
                  expectedType={output.variable.valueType}
                  onBeginEdit={checkpoint}
                  onChange={(source) =>
                    updateNodeData(node.id, StoryNodeType.Return, {
                      values: {
                        ...(data.values ?? {}),
                        [output.variable.id]: { source, bindings: {} },
                      },
                    })
                  }
                />
              ),
            )}
            <div className={styles.info}>Returns these outputs to the Call Substory node.</div>
          </>
        );
      }
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
          {availableVariables.length === 0 &&
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
