import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createStableId, engineValueMatchesFieldType } from '@story-blueprint/common';
import type {
  CharacterSource,
  CharacterId,
  EventSource,
  EngineFieldType,
  EngineMapKeyType,
  EngineTypeDefinition,
  SignalSource,
  AssetId,
  AssetSource,
  RuntimeValue,
  ValueType,
  VariableDefinition,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import type { StoryResourceReference } from '../../graph/resourceReferences';
import { writeStoryDataDrag } from '../../graph/storyDataDrag';
import { CopyButton } from './CopyButton';
import { CommitTextarea } from './CommitTextarea';
import { matchesCharacterSearch } from './storyDataSearch';
import { BUILTIN_CHARACTER_TEMPLATES, updateCharacterTags } from '../../graph/characterManagement';
import panelStyles from './Panel.module.css';
import styles from './StoryData.module.css';

type ScalarKind = 'boolean' | 'number' | 'string';
type EditableKind = ScalarKind | 'json';

function engineTypeName(valueType: ValueType): string {
  return valueType.kind === 'json' ? valueType.name : 'EnginePayload';
}

function defaultForType(kind: ScalarKind): RuntimeValue {
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  return '';
}

function defaultForEngineFieldType(
  type: EngineFieldType,
  engineTypes: readonly EngineTypeDefinition[],
): RuntimeValue {
  if (type.kind === 'boolean') return false;
  if (type.kind === 'number') return 0;
  if (type.kind === 'string') return '';
  if (type.kind === 'character-ref' || type.kind === 'asset-ref') return null;
  if (type.kind === 'enum') return type.values[0] ?? '';
  if (type.kind === 'array') return [];
  if (type.kind === 'map') return {};
  const definition = engineTypes.find((item) => item.name === type.typeName);
  return Object.fromEntries(
    (definition?.fields ?? []).map((field) => [field.name, structuredClone(field.defaultValue)]),
  );
}

function mapKeyMatchesType(key: string, type: EngineMapKeyType): boolean {
  if (!key) return false;
  if (type.kind === 'string') return true;
  if (type.kind === 'number') return Number.isFinite(Number(key));
  return type.values.includes(key);
}

function MapKeyInput({
  value,
  type,
  usedKeys,
  onCommit,
}: {
  value: string;
  type: EngineMapKeyType;
  usedKeys: readonly string[];
  onCommit: (key: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (type.kind === 'enum') {
    return (
      <select value={value} onChange={(event) => onCommit(event.target.value)}>
        {type.values.map((option) => (
          <option key={option} value={option} disabled={option !== value && usedKeys.includes(option)}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  const finish = () => {
    if (
      draft !== value &&
      mapKeyMatchesType(draft, type) &&
      !usedKeys.some((key) => key !== value && key === draft)
    ) {
      onCommit(draft);
    } else {
      setDraft(value);
    }
  };
  return (
    <input
      type={type.kind === 'number' ? 'number' : 'text'}
      value={draft}
      aria-label="Map key"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function StructuredJsonFields({
  type,
  value,
  engineTypes,
  characters,
  assets,
  onChange,
}: {
  type: EngineFieldType;
  value: RuntimeValue;
  engineTypes: readonly EngineTypeDefinition[];
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  onChange: (value: RuntimeValue) => void;
}) {
  if (type.kind === 'boolean') {
    return (
      <select value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}>
        <option value="false">False</option>
        <option value="true">True</option>
      </select>
    );
  }
  if (type.kind === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }
  if (type.kind === 'string') {
    return (
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (type.kind === 'character-ref') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">None</option>
        {characters.map((character) => (
          <option key={character.id} value={character.id}>
            {character.displayName}
          </option>
        ))}
      </select>
    );
  }
  if (type.kind === 'asset-ref') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">None</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.displayName} · {asset.kind}
          </option>
        ))}
      </select>
    );
  }
  if (type.kind === 'enum') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {type.values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (type.kind === 'array') {
    const items = Array.isArray(value) ? [...value] : [];
    return (
      <div className={styles.structuredArray}>
        {items.map((item, index) => (
          <div className={styles.structuredArrayItem} key={index}>
            <StructuredJsonFields
              type={type.elementType}
              value={item}
              engineTypes={engineTypes}
              characters={characters}
              assets={assets}
              onChange={(next) => {
                const updated = [...items];
                updated[index] = next;
                onChange(updated);
              }}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              −
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() =>
            onChange([...items, defaultForEngineFieldType(type.elementType, engineTypes)])
          }
        >
          + Add Item
        </button>
      </div>
    );
  }
  if (type.kind === 'map') {
    const record =
      !Array.isArray(value) && typeof value === 'object' && value !== null
        ? ({ ...value } as Record<string, RuntimeValue>)
        : {};
    const keys = Object.keys(record);
    const nextKey = (() => {
      if (type.keyType.kind === 'enum') {
        return type.keyType.values.find((candidate) => !keys.includes(candidate));
      }
      if (type.keyType.kind === 'number') {
        let index = 0;
        while (keys.includes(String(index))) index += 1;
        return String(index);
      }
      let index = keys.length + 1;
      let candidate = `key${index}`;
      while (keys.includes(candidate)) candidate = `key${++index}`;
      return candidate;
    })();
    return (
      <div className={styles.structuredMap}>
        {keys.map((key) => (
          <div className={styles.structuredMapItem} key={key}>
            <MapKeyInput
              value={key}
              type={type.keyType}
              usedKeys={keys}
              onCommit={(nextKey) =>
                onChange(
                  Object.fromEntries(
                    Object.entries(record).map(([candidate, item]) => [
                      candidate === key ? nextKey : candidate,
                      item,
                    ]),
                  ),
                )
              }
            />
            <StructuredJsonFields
              type={type.valueType}
              value={record[key]!}
              engineTypes={engineTypes}
              characters={characters}
              assets={assets}
              onChange={(next) => onChange({ ...record, [key]: next })}
            />
            <button
              type="button"
              aria-label={`Remove Map item ${key}`}
              onClick={() => onChange(Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key)))}
            >
              −
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!nextKey}
          onClick={() =>
            nextKey &&
            onChange({
              ...record,
              [nextKey]: defaultForEngineFieldType(type.valueType, engineTypes),
            })
          }
        >
          + Add Entry
        </button>
      </div>
    );
  }
  const definition = engineTypes.find((item) => item.name === type.typeName);
  const sourceRecord =
    !Array.isArray(value) && typeof value === 'object' && value !== null
      ? (value as Readonly<Record<string, RuntimeValue>>)
      : {};
  const record: Readonly<Record<string, RuntimeValue>> = Object.fromEntries(
    (definition?.fields ?? []).map((field) => [
      field.name,
      sourceRecord[field.name] ?? structuredClone(field.defaultValue),
    ]),
  );
  return (
    <div className={styles.structuredObject}>
      {(definition?.fields ?? []).map((field) => (
        <label key={field.name} title={field.description}>
          <span>{field.displayName}</span>
          <StructuredJsonFields
            type={field.type}
            value={record[field.name] ?? field.defaultValue}
            engineTypes={engineTypes}
            characters={characters}
            assets={assets}
            onChange={(next) => onChange({ ...record, [field.name]: next })}
          />
        </label>
      ))}
      {!definition && <small className={styles.warning}>Missing Engine Type {type.typeName}</small>}
    </div>
  );
}

export function JsonValueInput({
  value,
  onCommit,
  schema,
  fieldType,
  nullable = false,
  engineTypes = [],
}: {
  value: RuntimeValue;
  onCommit: (value: RuntimeValue) => void;
  schema?: EngineTypeDefinition;
  fieldType?: EngineFieldType;
  nullable?: boolean;
  engineTypes?: readonly EngineTypeDefinition[];
}) {
  const { characters, assets } = useStoryGraphStore();
  const canonical = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(canonical);
  const [error, setError] = useState<string>();
  const [raw, setRaw] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'pasting'>('idle');
  useEffect(() => {
    setDraft(canonical);
    setError(undefined);
  }, [canonical]);
  const commit = () => {
    try {
      const parsed = JSON.parse(draft) as RuntimeValue;
      const expectedType =
        fieldType ?? (schema ? { kind: 'object' as const, typeName: schema.name } : undefined);
      if (
        expectedType &&
        !(parsed === null && nullable) &&
        !engineValueMatchesFieldType(parsed, expectedType, engineTypes)
      ) {
        setError('Value does not match the Engine Type Schema.');
        return;
      }
      onCommit(parsed);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const expectedType =
    fieldType ?? (schema ? { kind: 'object' as const, typeName: schema.name } : undefined);
  const resetValue = expectedType
    ? defaultForEngineFieldType(expectedType, engineTypes)
    : structuredClone(value);
  const paste = async () => {
    setPasteStatus('pasting');
    try {
      const text = window.electronAPI?.readClipboardText
        ? await window.electronAPI.readClipboardText()
        : await navigator.clipboard?.readText?.();
      if (!text) throw new Error('Clipboard does not contain JSON.');
      const parsed = JSON.parse(text) as RuntimeValue;
      if (
        expectedType &&
        !(parsed === null && nullable) &&
        !engineValueMatchesFieldType(parsed, expectedType, engineTypes)
      ) {
        throw new Error('Clipboard JSON does not match the Engine Type Schema.');
      }
      onCommit(parsed);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPasteStatus('idle');
    }
  };
  return (
    <>
      {(schema || fieldType) && (
        <div className={styles.jsonValueToolbar}>
          <button
            type="button"
            className={styles.rawToggle}
            onClick={() => setRaw((current) => !current)}
          >
            {raw ? 'Structured Fields' : 'Raw JSON'}
          </button>
          <CopyButton text={canonical} label="Copy JSON" />
          <button
            type="button"
            className={styles.rawToggle}
            disabled={pasteStatus === 'pasting'}
            onClick={() => void paste()}
          >
            {pasteStatus === 'pasting' ? 'Pasting…' : 'Paste JSON'}
          </button>
          <button
            type="button"
            className={styles.rawToggle}
            onClick={() => onCommit(structuredClone(resetValue))}
          >
            Reset
          </button>
        </div>
      )}
      {(schema || fieldType) && !raw ? (
        <StructuredJsonFields
          type={fieldType ?? { kind: 'object', typeName: schema!.name }}
          value={value}
          engineTypes={engineTypes}
          characters={characters}
          assets={assets}
          onChange={onCommit}
        />
      ) : (
        <textarea
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              setDraft(canonical);
              setError(undefined);
              event.currentTarget.blur();
            }
          }}
        />
      )}
      {error && <small className={styles.warning}>Invalid JSON: {error}</small>}
    </>
  );
}

function ScriptNameInput({
  value,
  onCommit,
  disabled = false,
}: {
  value: string;
  onCommit: (value: string) => void | boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const beforeEdit = useRef(value);
  const editing = useRef(false);
  const canceling = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  const finishEditing = () => {
    editing.current = false;
    if (canceling.current) {
      canceling.current = false;
      setDraft(beforeEdit.current);
      return;
    }
    if (!draft) {
      setDraft(beforeEdit.current);
      return;
    }
    if (draft !== value && onCommit(draft) === false) setDraft(beforeEdit.current);
  };

  return (
    <input
      disabled={disabled}
      value={draft}
      onFocus={() => {
        beforeEdit.current = value;
        editing.current = true;
      }}
      onChange={(event) => setDraft(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
      onBlur={finishEditing}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          canceling.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function NamedCreateControl({
  title,
  placeholder = 'Name',
  existingNames,
  onCreate,
  buttonLabel = '+',
}: {
  title: string;
  placeholder?: string;
  existingNames: readonly string[];
  onCreate: (name: string) => void;
  buttonLabel?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const duplicate = existingNames.includes(draft);
  const validFormat = /^[A-Za-z_][A-Za-z0-9_]*$/.test(draft);
  const valid = validFormat && !duplicate;
  const confirm = () => {
    if (!valid) return;
    onCreate(draft);
    setDraft('');
    setCreating(false);
  };
  return (
    <>
      <button type="button" title={title} onClick={() => setCreating(true)}>
        {buttonLabel}
      </button>
      {creating &&
        createPortal(
          <div
            className={styles.namedCreateBackdrop}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return;
              setDraft('');
              setCreating(false);
            }}
          >
            <div
              className={styles.namedCreateDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="named-create-title"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  setDraft('');
                  setCreating(false);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div id="named-create-title" className={styles.namedCreateTitle}>
                {title}
              </div>
              <label>
                <span>Name</span>
                <input
                  autoFocus
                  value={draft}
                  placeholder={placeholder}
                  aria-label={title}
                  onChange={(event) =>
                    setDraft(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))
                  }
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') confirm();
                    if (event.key === 'Escape') {
                      setDraft('');
                      setCreating(false);
                    }
                  }}
                />
              </label>
              <div className={styles.namedCreateHint}>
                {!draft
                  ? 'Enter a name to create this item.'
                  : duplicate
                    ? 'This name already exists.'
                    : !validFormat
                      ? 'Use letters, numbers, and underscores; the first character cannot be a number.'
                      : 'The display name will initially use the same value.'}
              </div>
              <div className={styles.namedCreateActions}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft('');
                    setCreating(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!valid}
                  onClick={confirm}
                >
                  Create
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function CommitInput({
  value,
  onCommit,
  type = 'text',
}: {
  value: string;
  onCommit: (value: string) => void;
  type?: 'text' | 'number';
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const canceling = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  const commit = () => {
    editing.current = false;
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      type={type}
      value={draft}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (canceling.current) {
          canceling.current = false;
          editing.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          canceling.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ResourceReferenceSection({
  references,
  emptyMessage,
  onShow,
}: {
  references: readonly StoryResourceReference[];
  emptyMessage: string;
  onShow: (reference: StoryResourceReference) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleReferences = expanded ? references : references.slice(0, 30);
  useEffect(() => setExpanded(false), [references]);
  return (
    <div className={styles.referenceSection}>
      <div className={styles.referenceHeader}>
        <span>References</span>
        <strong>{references.length}</strong>
      </div>
      {references.length === 0 ? (
        <div className={styles.referenceEmpty}>{emptyMessage}</div>
      ) : (
        <div className={styles.referenceList}>
          {visibleReferences.map((reference) => (
            <button type="button" key={reference.id} onClick={() => onShow(reference)}>
              <span>
                <strong>{reference.label}</strong>
                <small>
                  {reference.location} · {reference.field}
                </small>
              </span>
              <em>Show</em>
            </button>
          ))}
        </div>
      )}
      {references.length > 30 && (
        <button
          className={styles.referenceMoreButton}
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show First 30' : `Show All ${references.length}`}
        </button>
      )}
    </div>
  );
}

function ReplaceResourceReferencesButton({
  kind,
  sourceId,
  sourceLabel,
  options,
}: {
  kind: 'character' | 'asset';
  sourceId: string;
  sourceLabel: string;
  options: readonly { id: string; label: string }[];
}) {
  const { replaceProjectResourceReferences } = useStoryGraphStore();
  const [open, setOpen] = useState(false);
  const [replacementId, setReplacementId] = useState(options[0]?.id ?? '');
  const [preview, setPreview] = useState<{ count: number; locations: readonly string[] }>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!options.some((option) => option.id === replacementId)) {
      setReplacementId(options[0]?.id ?? '');
    }
  }, [options, replacementId]);
  const close = () => {
    setOpen(false);
    setPreview(undefined);
  };
  return (
    <>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={options.length === 0}
        onClick={() => setOpen(true)}
      >
        Replace References…
      </button>
      {open &&
        createPortal(
          <div className={styles.namedCreateBackdrop} role="presentation">
            <div className={styles.schemaMigrationDialog} role="dialog" aria-modal="true">
              <div className={styles.detailsTitle}>Replace {sourceLabel}</div>
              <label>
                <span>Replacement {kind}</span>
                <select
                  value={replacementId}
                  onChange={(event) => {
                    setReplacementId(event.target.value);
                    setPreview(undefined);
                  }}
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {preview ? (
                <>
                  <p>{preview.count} reference(s) will be replaced.</p>
                  <div className={styles.schemaMigrationLocations}>
                    {preview.locations.map((location, index) => (
                      <div key={`${location}:${index}`}>{location}</div>
                    ))}
                  </div>
                </>
              ) : (
                <p>Preview scans saved and unopened Story files before any change is written.</p>
              )}
              <div className={styles.schemaMigrationActions}>
                <button type="button" disabled={loading} onClick={close}>
                  Cancel
                </button>
                {!preview ? (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={loading || !replacementId}
                    onClick={() => {
                      setLoading(true);
                      void replaceProjectResourceReferences(
                        kind,
                        sourceId,
                        replacementId,
                        true,
                      ).then((result) => {
                        if (result) setPreview(result);
                        setLoading(false);
                      });
                    }}
                  >
                    {loading ? 'Scanning…' : 'Preview'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={loading || preview.count === 0}
                    onClick={() => {
                      setLoading(true);
                      void replaceProjectResourceReferences(
                        kind,
                        sourceId,
                        replacementId,
                        false,
                      ).then((result) => {
                        setLoading(false);
                        if (result) close();
                      });
                    }}
                  >
                    {loading ? 'Replacing…' : 'Replace All'}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function VariableEditor({ variable }: { variable: VariableDefinition }) {
  const {
    variables,
    projectVariables,
    chapters,
    findVariableReferences,
    variableReferencesLoading,
    variableReferencesError,
    refreshProjectVariableReferences,
    focusVariableReference,
    updateVariable,
    removeVariable,
    engineTypes,
    addEngineType,
    selectStoryData,
  } = useStoryGraphStore();
  const substory = chapters.find((chapter) =>
    [
      ...chapter.parameters.map((parameter) => parameter.variable),
      ...chapter.outputs.map((output) => output.variable),
      ...chapter.localVariables,
    ].some((candidate) => candidate.id === variable.id),
  );
  const substoryVariableKind = substory?.parameters.some(
    (parameter) => parameter.variable.id === variable.id,
  )
    ? 'Input Parameter'
    : substory?.outputs.some((output) => output.variable.id === variable.id)
      ? 'Output Parameter'
      : substory
        ? 'Local Variable'
        : undefined;
  const [showAllReferences, setShowAllReferences] = useState(false);
  const references = findVariableReferences(variable.id);
  const visibleReferences = showAllReferences ? references : references.slice(0, 30);
  useEffect(() => setShowAllReferences(false), [variable.id]);
  const duplicate = [
    ...variables,
    ...projectVariables,
    ...(substory?.parameters.map((parameter) => parameter.variable) ?? []),
    ...(substory?.outputs.map((output) => output.variable) ?? []),
    ...(substory?.localVariables ?? []),
  ].some((candidate) => candidate.id !== variable.id && candidate.name === variable.name);
  const kind = variable.valueType.kind as EditableKind;
  const selectedEngineTypeName = engineTypeName(variable.valueType);
  const projectIndexUnavailable =
    variable.scope === 'project' &&
    (variableReferencesLoading || variableReferencesError !== undefined);
  return (
    <div
      className={styles.details}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className={styles.detailsTitle}>Variable</div>
      <label>
        <span>Name</span>
        <ScriptNameInput
          value={variable.name}
          disabled={projectIndexUnavailable}
          onCommit={(name) => updateVariable(variable.id, { name, displayName: name })}
        />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <CommitInput
          value={variable.displayName}
          onCommit={(displayName) => updateVariable(variable.id, { displayName })}
        />
      </label>
      <label>
        <span>Type</span>
        <select
          disabled={projectIndexUnavailable || references.length > 0}
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value as EditableKind;
            const nextEngineTypeName =
              nextKind === 'json' ? (engineTypes[0]?.name ?? addEngineType()) : undefined;
            if (nextKind === 'json' && !nextEngineTypeName) return;
            updateVariable(variable.id, {
              valueType:
                nextKind === 'json'
                  ? { kind: 'json', name: nextEngineTypeName! }
                  : ({ kind: nextKind } as ValueType),
              defaultValue:
                nextKind === 'json'
                  ? defaultForEngineFieldType(
                      { kind: 'object', typeName: nextEngineTypeName! },
                      engineTypes,
                    )
                  : defaultForType(nextKind),
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
        <div className={styles.engineTypeBinding}>
          <label>
            <span>Engine Type</span>
            <select
              value={variable.valueType.name}
              onChange={(event) =>
                updateVariable(variable.id, {
                  valueType: { kind: 'json', name: event.target.value },
                  defaultValue: defaultForEngineFieldType(
                    { kind: 'object', typeName: event.target.value },
                    engineTypes,
                  ),
                })
              }
            >
              {!engineTypes.some((item) => item.name === engineTypeName(variable.valueType)) && (
                <option value={engineTypeName(variable.valueType)} disabled>
                  Missing: {engineTypeName(variable.valueType)}
                </option>
              )}
              {engineTypes.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.engineTypeBindingActions}>
            {engineTypes.some((item) => item.name === selectedEngineTypeName) ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  selectStoryData({ kind: 'engine-type', name: selectedEngineTypeName })
                }
              >
                Edit Type Fields…
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  const name = addEngineType();
                  if (!name) return;
                  updateVariable(variable.id, {
                    valueType: { kind: 'json', name },
                    defaultValue: {},
                  });
                  selectStoryData({ kind: 'engine-type', name });
                }}
              >
                Create Type and Edit Fields…
              </button>
            )}
          </div>
        </div>
      )}
      <label>
        <span>Scope</span>
        {substoryVariableKind ? (
          <input value={`${substory!.displayName} · ${substoryVariableKind}`} readOnly />
        ) : variable.scope === 'project' ? (
          <input value="Project" readOnly />
        ) : (
          <select
            value={variable.scope}
            onChange={(event) =>
              updateVariable(variable.id, {
                scope: event.target.value as VariableDefinition['scope'],
              })
            }
          >
            <option value="story">Story</option>
            <option value="chapter">Chapter</option>
            <option value="local">Local</option>
          </select>
        )}
      </label>
      <label>
        <span>Default</span>
        {kind === 'json' ? (
          <JsonValueInput
            value={variable.defaultValue}
            schema={engineTypes.find((item) => item.name === engineTypeName(variable.valueType))}
            engineTypes={engineTypes}
            onCommit={(defaultValue) => updateVariable(variable.id, { defaultValue })}
          />
        ) : kind === 'boolean' ? (
          <select
            value={String(variable.defaultValue)}
            onChange={(event) =>
              updateVariable(variable.id, { defaultValue: event.target.value === 'true' })
            }
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        ) : (
          <CommitInput
            type={kind === 'number' ? 'number' : 'text'}
            value={String(variable.defaultValue ?? '')}
            onCommit={(value) =>
              updateVariable(variable.id, {
                defaultValue: kind === 'number' ? Number(value) : value,
              })
            }
          />
        )}
      </label>
      <div className={styles.referenceSection}>
        <div className={styles.referenceHeader}>
          <span>References</span>
          <strong>{references.length}</strong>
        </div>
        {variableReferencesLoading ? (
          <div className={styles.referenceEmpty}>Scanning all project Stories…</div>
        ) : variableReferencesError ? (
          <div className={styles.referenceError}>
            <div className={styles.warning}>{variableReferencesError}</div>
            <button
              className={styles.referenceMoreButton}
              type="button"
              onClick={refreshProjectVariableReferences}
            >
              Rescan Project Stories
            </button>
          </div>
        ) : references.length === 0 ? (
          <div className={styles.referenceEmpty}>This variable is not used by any node.</div>
        ) : (
          <div className={styles.referenceList}>
            {visibleReferences.map((reference) => (
              <button
                type="button"
                key={`${reference.storyId ?? 'active'}:${reference.graphId}:${reference.nodeId}:${reference.field}:${reference.kind}`}
                onClick={() => void focusVariableReference(reference)}
              >
                <span>
                  <strong>{reference.nodeLabel}</strong>
                  <small>
                    {reference.graphLabel} · {reference.field}
                  </small>
                </span>
                <em>Show</em>
              </button>
            ))}
          </div>
        )}
        {references.length > 30 && (
          <button
            className={styles.referenceMoreButton}
            type="button"
            onClick={() => setShowAllReferences((current) => !current)}
          >
            {showAllReferences ? 'Show First 30' : `Show All ${references.length}`}
          </button>
        )}
      </div>
      {references.length > 0 && (
        <div className={styles.warning}>
          Remove or migrate these references before deleting the variable
          {variable.scope === 'project' ? ' or changing its type' : ''}.
        </div>
      )}
      <button
        className={styles.dangerButton}
        type="button"
        disabled={references.length > 0 || projectIndexUnavailable}
        onClick={() => {
          if (window.confirm(`Delete variable ${variable.name}?`)) removeVariable(variable.id);
        }}
      >
        Delete {substoryVariableKind ?? 'Variable'}
      </button>
    </div>
  );
}

function CharacterEditor({ character }: { character: CharacterSource }) {
  const {
    characters,
    assets,
    workspace,
    workspaceError,
    selectStoryData,
    updateCharacter,
    engineTypes,
    findCharacterReferences,
    findEmotionReferences,
    findCharacterFieldReferences,
    focusStoryResourceReference,
    renameCharacterEmotion,
    removeCharacterEmotion,
    removeCharacter,
    saveCharacterAsTemplate,
    revealWorkspaceItem,
  } = useStoryGraphStore();
  const resourcePath = workspace?.characterResources.find(
    (candidate) => candidate.character.id === character.id,
  )?.relativePath;
  const duplicate = characters.some(
    (candidate) => candidate.id !== character.id && candidate.name === character.name,
  );
  const portraitAssets = assets.filter((asset) => asset.kind === 'portrait');
  const references = findCharacterReferences(character.id);
  const relationships = character.relationships ?? {};
  const metadata = character.metadata ?? {};
  const updateMetadata = (next: Record<string, string | number | boolean>) =>
    updateCharacter(character.id, {
      metadata: Object.keys(next).length > 0 ? next : undefined,
    });
  const availableRelationshipTarget = characters.find(
    (candidate) => candidate.id !== character.id && !relationships[candidate.id],
  );
  const updateRelationships = (next: Record<string, { label: string; description?: string }>) =>
    updateCharacter(character.id, {
      relationships:
        Object.keys(next).length > 0
          ? (next as NonNullable<CharacterSource['relationships']>)
          : undefined,
    });
  const addEmotion = (key: string) => {
    updateCharacter(character.id, {
      emotions: {
        ...character.emotions,
        [key]: { displayName: key },
      },
    });
  };
  const fields = character.fields ?? [];
  const updateField = (id: VariableDefinition['id'], patch: Partial<VariableDefinition>) =>
    updateCharacter(character.id, {
      fields: fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  const addField = (name: string) => {
    updateCharacter(character.id, {
      fields: [
        ...fields,
        {
          id: createStableId('variable'),
          name,
          displayName: name,
          scope: 'character',
          valueType: { kind: 'string' },
          defaultValue: '',
        },
      ],
    });
  };
  return (
    <div className={styles.details}>
      <div className={styles.detailsTitle}>Character</div>
      <label>
        <span>Name</span>
        <ScriptNameInput
          value={character.name}
          onCommit={(name) => updateCharacter(character.id, { name, displayName: name })}
        />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <CommitInput
          value={character.displayName}
          onCommit={(displayName) => updateCharacter(character.id, { displayName })}
        />
      </label>
      <CommitTextarea
        label="Description"
        rows={4}
        placeholder="Biography, role in the story, goals, and important background."
        value={character.description ?? ''}
        saveError={workspaceError}
        onCommit={(value) => updateCharacter(character.id, { description: value || undefined })}
      />
      <CommitTextarea
        label="Dialogue Style"
        rows={3}
        placeholder="Tone, vocabulary, verbal habits, and dialogue guidance for writers and AI."
        value={character.dialogueStyle ?? ''}
        saveError={workspaceError}
        onCommit={(value) => updateCharacter(character.id, { dialogueStyle: value || undefined })}
      />
      <CommitTextarea
        label="Tags"
        rows={2}
        placeholder="protagonist, merchant, faction:royal"
        value={(character.tags ?? []).join(', ')}
        saveError={workspaceError}
        onCommit={(value) => {
          const tags = [
            ...new Set(
              value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ];
          updateCharacter(character.id, { tags: tags.length > 0 ? tags : undefined });
        }}
      />
      <div className={styles.infoText}>
        Tags are searchable authoring labels. Separate them with commas.
      </div>
      <div className={styles.parameterHeader}>
        <span>Metadata</span>
        <NamedCreateControl
          title="Add metadata"
          placeholder="Metadata name"
          buttonLabel="Add Metadata"
          existingNames={Object.keys(metadata)}
          onCreate={(key) => updateMetadata({ ...metadata, [key]: '' })}
        />
      </div>
      <div className={styles.relationshipList}>
        {Object.entries(metadata).map(([key, value]) => {
          const kind = typeof value as ScalarKind;
          return (
            <div className={styles.metadataRow} key={key}>
              <label>
                <span>Key</span>
                <ScriptNameInput
                  value={key}
                  onCommit={(nextKey) => {
                    if (nextKey !== key && Object.hasOwn(metadata, nextKey)) return false;
                    updateMetadata(
                      Object.fromEntries(
                        Object.entries(metadata).map(([candidate, item]) => [
                          candidate === key ? nextKey : candidate,
                          item,
                        ]),
                      ),
                    );
                  }}
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  value={kind}
                  onChange={(event) => {
                    const nextKind = event.target.value as ScalarKind;
                    updateMetadata({
                      ...metadata,
                      [key]: defaultForType(nextKind) as string | number | boolean,
                    });
                  }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                </select>
              </label>
              <label>
                <span>Value</span>
                {kind === 'boolean' ? (
                  <select
                    value={String(value)}
                    onChange={(event) =>
                      updateMetadata({ ...metadata, [key]: event.target.value === 'true' })
                    }
                  >
                    <option value="false">False</option>
                    <option value="true">True</option>
                  </select>
                ) : (
                  <CommitInput
                    type={kind === 'number' ? 'number' : 'text'}
                    value={String(value)}
                    onCommit={(nextValue) =>
                      updateMetadata({
                        ...metadata,
                        [key]: kind === 'number' ? Number(nextValue) : nextValue,
                      })
                    }
                  />
                )}
              </label>
              <button
                className={styles.emotionRemoveButton}
                type="button"
                aria-label={`Delete metadata ${key}`}
                onClick={() =>
                  updateMetadata(
                    Object.fromEntries(
                      Object.entries(metadata).filter(([candidate]) => candidate !== key),
                    ),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
        {Object.keys(metadata).length === 0 && (
          <div className={styles.infoText}>No project-specific metadata.</div>
        )}
      </div>
      <label>
        <span>Default Portrait</span>
        <select
          value={character.defaultPortraitId ?? ''}
          onChange={(event) =>
            updateCharacter(character.id, {
              defaultPortraitId: (event.target.value || undefined) as AssetId | undefined,
            })
          }
        >
          <option value="">None</option>
          {portraitAssets.map((asset) => (
            <option value={asset.id} key={asset.id}>
              {asset.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.parameterHeader}>
        <span>Relationships</span>
        <button
          type="button"
          disabled={!availableRelationshipTarget}
          title={
            availableRelationshipTarget
              ? 'Add a directed character relationship'
              : 'Every other character already has a relationship'
          }
          onClick={() => {
            if (!availableRelationshipTarget) return;
            updateRelationships({
              ...relationships,
              [availableRelationshipTarget.id]: { label: 'Relationship' },
            });
          }}
        >
          Add Relationship
        </button>
      </div>
      <div className={styles.relationshipList}>
        {Object.entries(relationships).map(([targetId, relationship]) => {
          const target = characters.find((candidate) => candidate.id === targetId);
          return (
            <div className={styles.relationshipBlock} key={targetId}>
              <label>
                <span>Character</span>
                <select
                  value={targetId}
                  onChange={(event) => {
                    const nextTargetId = event.target.value as CharacterId;
                    updateRelationships({
                      ...Object.fromEntries(
                        Object.entries(relationships).filter(
                          ([candidateId]) => candidateId !== targetId,
                        ),
                      ),
                      [nextTargetId]: relationship,
                    });
                  }}
                >
                  {characters
                    .filter(
                      (candidate) =>
                        candidate.id !== character.id &&
                        (candidate.id === targetId || !relationships[candidate.id]),
                    )
                    .map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {candidate.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <CommitTextarea
                label="Relationship"
                rows={1}
                value={relationship.label}
                saveError={workspaceError}
                onCommit={(value) => {
                  if (!value.trim()) return;
                  updateRelationships({
                    ...relationships,
                    [targetId]: { ...relationship, label: value },
                  });
                }}
              />
              <CommitTextarea
                label="Description"
                rows={2}
                placeholder="How this character sees and treats the other character."
                value={relationship.description ?? ''}
                saveError={workspaceError}
                onCommit={(value) =>
                  updateRelationships({
                    ...relationships,
                    [targetId]: { ...relationship, description: value || undefined },
                  })
                }
              />
              <div className={styles.relationshipActions}>
                {target && (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => selectStoryData({ kind: 'character', id: target.id })}
                  >
                    Show {target.displayName}
                  </button>
                )}
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={() =>
                    updateRelationships(
                      Object.fromEntries(
                        Object.entries(relationships).filter(
                          ([candidateId]) => candidateId !== targetId,
                        ),
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {Object.keys(relationships).length === 0 && (
          <div className={styles.infoText}>No static character relationships.</div>
        )}
      </div>
      <div className={styles.parameterHeader}>
        <span>Fields</span>
        <NamedCreateControl
          title="Add character field"
          placeholder="Field name"
          buttonLabel="Add Field"
          existingNames={fields.map((field) => field.name)}
          onCreate={addField}
        />
      </div>
      <div className={styles.emotionList}>
        {fields.map((field) => {
          const kind = field.valueType.kind as EditableKind;
          const fieldReferences = findCharacterFieldReferences(field.id);
          return (
            <div className={styles.characterFieldBlock} key={field.id}>
              <div className={styles.emotionRow}>
                <label>
                  <span>Name</span>
                  <ScriptNameInput
                    value={field.name}
                    onCommit={(name) => {
                      if (
                        fields.some(
                          (candidate) => candidate.id !== field.id && candidate.name === name,
                        )
                      )
                        return false;
                      updateField(field.id, { name, displayName: name });
                    }}
                  />
                </label>
                <label>
                  <span>Type</span>
                  <select
                    value={kind}
                    disabled={fieldReferences.length > 0}
                    title={
                      fieldReferences.length > 0
                        ? 'Remove field references before changing its type.'
                        : undefined
                    }
                    onChange={(event) => {
                      const nextKind = event.target.value as EditableKind;
                      updateField(field.id, {
                        valueType:
                          nextKind === 'json'
                            ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
                            : { kind: nextKind },
                        defaultValue: nextKind === 'json' ? {} : defaultForType(nextKind),
                      });
                    }}
                  >
                    <option value="boolean">Boolean</option>
                    <option value="number">Number</option>
                    <option value="string">String</option>
                    <option value="json">Engine JSON</option>
                  </select>
                </label>
                {field.valueType.kind === 'json' && (
                  <label>
                    <span>Engine Type</span>
                    <select
                      value={field.valueType.name}
                      onChange={(event) =>
                        updateField(field.id, {
                          valueType: { kind: 'json', name: event.target.value },
                          defaultValue: defaultForEngineFieldType(
                            { kind: 'object', typeName: event.target.value },
                            engineTypes,
                          ),
                        })
                      }
                    >
                      {!engineTypes.some(
                        (item) => item.name === engineTypeName(field.valueType),
                      ) && (
                        <option value={engineTypeName(field.valueType)}>
                          {engineTypeName(field.valueType)} (undefined)
                        </option>
                      )}
                      {engineTypes.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>Default</span>
                  {kind === 'json' ? (
                    <JsonValueInput
                      value={field.defaultValue}
                      schema={engineTypes.find(
                        (item) => item.name === engineTypeName(field.valueType),
                      )}
                      engineTypes={engineTypes}
                      onCommit={(defaultValue) => updateField(field.id, { defaultValue })}
                    />
                  ) : kind === 'boolean' ? (
                    <select
                      value={String(field.defaultValue)}
                      onChange={(event) =>
                        updateField(field.id, { defaultValue: event.target.value === 'true' })
                      }
                    >
                      <option value="false">False</option>
                      <option value="true">True</option>
                    </select>
                  ) : (
                    <CommitInput
                      type={kind === 'number' ? 'number' : 'text'}
                      value={String(field.defaultValue)}
                      onCommit={(nextValue) =>
                        updateField(field.id, {
                          defaultValue: kind === 'number' ? Number(nextValue) : nextValue,
                        })
                      }
                    />
                  )}
                </label>
                <button
                  className={styles.emotionRemoveButton}
                  type="button"
                  title={`Delete ${field.displayName}`}
                  disabled={fieldReferences.length > 0}
                  onClick={() =>
                    updateCharacter(character.id, {
                      fields: fields.filter((candidate) => candidate.id !== field.id),
                    })
                  }
                >
                  ×
                </button>
              </div>
              <ResourceReferenceSection
                references={fieldReferences}
                emptyMessage="This character field is not used by any open Story."
                onShow={focusStoryResourceReference}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.parameterHeader}>
        <span>Emotions</span>
        <NamedCreateControl
          title="Add emotion"
          placeholder="Emotion name"
          buttonLabel="Add Emotion"
          existingNames={Object.keys(character.emotions)}
          onCreate={addEmotion}
        />
      </div>
      <div className={styles.emotionList}>
        {Object.entries(character.emotions).map(([key, emotion]) => {
          const emotionReferences = findEmotionReferences(character.id, key);
          return (
            <div className={styles.emotionRow} key={key}>
              <label>
                <span>Key</span>
                <ScriptNameInput
                  value={key}
                  onCommit={(nextKey) => {
                    if (nextKey !== key && character.emotions[nextKey]) return false;
                    renameCharacterEmotion(character.id, key, nextKey);
                  }}
                />
              </label>
              <label>
                <span>Display Name</span>
                <CommitInput
                  value={emotion.displayName}
                  onCommit={(displayName) =>
                    updateCharacter(character.id, {
                      emotions: {
                        ...character.emotions,
                        [key]: { ...emotion, displayName },
                      },
                    })
                  }
                />
              </label>
              <label>
                <span>Portrait</span>
                <select
                  value={emotion.portraitId ?? ''}
                  onChange={(event) =>
                    updateCharacter(character.id, {
                      emotions: {
                        ...character.emotions,
                        [key]: {
                          ...emotion,
                          portraitId: (event.target.value || undefined) as AssetId | undefined,
                        },
                      },
                    })
                  }
                >
                  <option value="">Use Default</option>
                  {portraitAssets.map((asset) => (
                    <option value={asset.id} key={asset.id}>
                      {asset.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.emotionRemoveButton}
                type="button"
                disabled={emotionReferences.length > 0}
                title={`Delete ${emotion.displayName}`}
                aria-label={`Delete ${emotion.displayName}`}
                onClick={() => {
                  if (window.confirm(`Delete emotion "${emotion.displayName}"?`)) {
                    removeCharacterEmotion(character.id, key);
                  }
                }}
              >
                ×
              </button>
              {emotionReferences.length > 0 && (
                <div className={styles.emotionReferences}>
                  <ResourceReferenceSection
                    references={emotionReferences}
                    emptyMessage="This emotion is not used."
                    onShow={focusStoryResourceReference}
                  />
                  <div className={styles.warning}>
                    Remove these Dialogue references before deleting this emotion.
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {Object.keys(character.emotions).length === 0 && (
          <div className={styles.infoText}>
            No emotions. Dialogue will use the default portrait.
          </div>
        )}
      </div>
      <ResourceReferenceSection
        references={references}
        emptyMessage="This character is not used by any Story, relationship, or Engine JSON value."
        onShow={focusStoryResourceReference}
      />
      {references.length > 0 && (
        <div className={styles.warning}>
          Remove these Dialogue references before deleting the character.
        </div>
      )}
      <div className={styles.detailActions}>
        {workspace?.project && (
          <ReplaceResourceReferencesButton
            kind="character"
            sourceId={character.id}
            sourceLabel={character.displayName}
            options={characters
              .filter((candidate) => candidate.id !== character.id)
              .map((candidate) => ({ id: candidate.id, label: candidate.displayName }))}
          />
        )}
        {workspace?.project && (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void saveCharacterAsTemplate(character.id)}
          >
            Save as Template
          </button>
        )}
        {resourcePath && (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void revealWorkspaceItem(resourcePath)}
          >
            Show in File Explorer
          </button>
        )}
        <button
          className={styles.dangerButton}
          type="button"
          disabled={references.length > 0}
          onClick={() => removeCharacter(character.id)}
        >
          Delete Character
        </button>
      </div>
    </div>
  );
}

function EngineMapKeyTypeEditor({
  value,
  onChange,
}: {
  value: EngineMapKeyType;
  onChange: (value: EngineMapKeyType) => void;
}) {
  return (
    <div className={styles.engineFieldType}>
      <select
        value={value.kind}
        onChange={(event) => {
          const kind = event.target.value as EngineMapKeyType['kind'];
          onChange(kind === 'enum' ? { kind, values: ['Key'] } : { kind });
        }}
      >
        <option value="string">String</option>
        <option value="number">Number</option>
        <option value="enum">Enum</option>
      </select>
      {value.kind === 'enum' && (
        <CommitInput
          value={value.values.join(', ')}
          onCommit={(text) =>
            onChange({
              kind: 'enum',
              values: [
                ...new Set(
                  text
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ],
            })
          }
        />
      )}
    </div>
  );
}

function EngineFieldTypeEditor({
  value,
  engineTypes,
  ownerName,
  onChange,
  depth = 0,
}: {
  value: EngineFieldType;
  engineTypes: readonly EngineTypeDefinition[];
  ownerName: string;
  onChange: (value: EngineFieldType) => void;
  depth?: number;
}) {
  const kind = value.kind;
  const changeKind = (nextKind: EngineFieldType['kind']) => {
    if (nextKind === 'enum') onChange({ kind: 'enum', values: ['Value'] });
    else if (nextKind === 'object') {
      onChange({
        kind: 'object',
        typeName: engineTypes.find((item) => item.name !== ownerName)?.name ?? ownerName,
      });
    } else if (nextKind === 'array') onChange({ kind: 'array', elementType: { kind: 'string' } });
    else if (nextKind === 'map') {
      onChange({ kind: 'map', keyType: { kind: 'string' }, valueType: { kind: 'string' } });
    }
    else onChange({ kind: nextKind });
  };
  return (
    <div className={styles.engineFieldType}>
      <select
        value={kind}
        onChange={(event) => changeKind(event.target.value as EngineFieldType['kind'])}
      >
        <option value="boolean">Boolean</option>
        <option value="number">Number</option>
        <option value="string">String</option>
        <option value="character-ref">Character Reference</option>
        <option value="asset-ref">Asset Reference</option>
        <option value="enum">Enum</option>
        <option value="object" disabled={!engineTypes.some((item) => item.name !== ownerName)}>
          Object
        </option>
        <option value="array">Array</option>
        <option value="map">Map / Dictionary</option>
      </select>
      {value.kind === 'enum' && (
        <CommitInput
          value={value.values.join(', ')}
          onCommit={(text) =>
            onChange({
              kind: 'enum',
              values: [
                ...new Set(
                  text
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ],
            })
          }
        />
      )}
      {value.kind === 'object' && (
        <select
          value={value.typeName}
          onChange={(event) => onChange({ kind: 'object', typeName: event.target.value })}
        >
          {engineTypes
            .filter((item) => item.name !== ownerName)
            .map((item) => (
              <option key={item.name} value={item.name}>
                {item.displayName}
              </option>
            ))}
        </select>
      )}
      {value.kind === 'array' && depth < 3 && (
        <div className={styles.arrayElementType}>
          <span>Item</span>
          <EngineFieldTypeEditor
            value={value.elementType}
            engineTypes={engineTypes}
            ownerName={ownerName}
            depth={depth + 1}
            onChange={(elementType) => onChange({ kind: 'array', elementType })}
          />
        </div>
      )}
      {value.kind === 'map' && depth < 3 && (
        <div className={styles.mapTypeEditor}>
          <label>
            <span>Key</span>
            <EngineMapKeyTypeEditor
              value={value.keyType}
              onChange={(keyType) => onChange({ ...value, keyType })}
            />
          </label>
          <label>
            <span>Value</span>
            <EngineFieldTypeEditor
              value={value.valueType}
              engineTypes={engineTypes}
              ownerName={ownerName}
              depth={depth + 1}
              onChange={(valueType) => onChange({ ...value, valueType })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function EngineTypeEditor({ definition }: { definition: EngineTypeDefinition }) {
  const {
    engineTypes,
    updateEngineType,
    removeEngineType,
    engineTypeMigrationPreview,
    confirmEngineTypeMigration,
    cancelEngineTypeMigration,
  } = useStoryGraphStore();
  const update = (next: EngineTypeDefinition) => updateEngineType(definition.name, next);
  const updateField = (index: number, next: EngineTypeDefinition['fields'][number]) =>
    update({
      ...definition,
      fields: definition.fields.map((field, fieldIndex) => (fieldIndex === index ? next : field)),
    });
  const changeFieldType = (index: number, type: EngineFieldType) => {
    const field = definition.fields[index]!;
    updateField(index, {
      ...field,
      type,
      nullable:
        type.kind === 'character-ref' || type.kind === 'asset-ref' ? true : field.nullable,
      defaultValue: defaultForEngineFieldType(type, engineTypes),
    });
  };
  const addField = (name: string) => {
    update({
      ...definition,
      fields: [
        ...definition.fields,
        {
          id: createStableId('engineField'),
          name,
          displayName: name,
          type: { kind: 'string' },
          defaultValue: '',
        },
      ],
    });
  };
  return (
    <>
      <div className={styles.details}>
        <div className={styles.detailsTitle}>Engine Type</div>
        <label>
          <span>Internal Name</span>
          <ScriptNameInput
            value={definition.name}
            onCommit={(name) =>
              update({
                ...definition,
                name,
                displayName:
                  definition.displayName === definition.name ? name : definition.displayName,
              })
            }
          />
        </label>
        <label>
          <span>Display Name</span>
          <CommitInput
            value={definition.displayName}
            onCommit={(displayName) => update({ ...definition, displayName })}
          />
        </label>
        <CommitTextarea
          label="Description"
          rows={3}
          value={definition.description ?? ''}
          onCommit={(description) =>
            update({ ...definition, description: description || undefined })
          }
        />
        <div className={styles.sectionHeader}>
          <span>Serialized Fields</span>
          <NamedCreateControl
            title="Add serialized field"
            placeholder="Field name"
            existingNames={definition.fields.map((field) => field.name)}
            onCreate={addField}
          />
        </div>
        {definition.fields.length === 0 && <div className={styles.empty}>No fields</div>}
        <div className={styles.engineFields}>
          {definition.fields.map((field, index) => (
            <div className={styles.engineFieldCard} key={field.id}>
              <div className={styles.engineFieldHeader}>
                <strong>{field.displayName}</strong>
                <div>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      const fields = [...definition.fields];
                      [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!];
                      update({ ...definition, fields });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === definition.fields.length - 1}
                    onClick={() => {
                      const fields = [...definition.fields];
                      [fields[index], fields[index + 1]] = [fields[index + 1]!, fields[index]!];
                      update({ ...definition, fields });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        ...definition,
                        fields: definition.fields.filter((_, fieldIndex) => fieldIndex !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
              <label>
                <span>Name</span>
                <ScriptNameInput
                  value={field.name}
                  onCommit={(name) =>
                    updateField(index, {
                      ...field,
                      name,
                      displayName: field.displayName === field.name ? name : field.displayName,
                    })
                  }
                />
              </label>
              <label>
                <span>Display Name</span>
                <CommitInput
                  value={field.displayName}
                  onCommit={(displayName) => updateField(index, { ...field, displayName })}
                />
              </label>
              <label>
                <span>Type</span>
                <EngineFieldTypeEditor
                  value={field.type}
                  engineTypes={engineTypes}
                  ownerName={definition.name}
                  onChange={(type) => changeFieldType(index, type)}
                />
              </label>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  disabled={
                    field.type.kind === 'character-ref' || field.type.kind === 'asset-ref'
                  }
                  checked={field.nullable ?? false}
                  onChange={(event) =>
                    updateField(index, { ...field, nullable: event.target.checked || undefined })
                  }
                />
                <span>Nullable</span>
              </label>
              <label>
                <span>Default</span>
                <JsonValueInput
                  value={field.defaultValue}
                  engineTypes={engineTypes}
                  fieldType={field.type}
                  nullable={field.nullable}
                  onCommit={(defaultValue) => updateField(index, { ...field, defaultValue })}
                />
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => removeEngineType(definition.name)}
        >
          Delete Engine Type
        </button>
      </div>
      {engineTypeMigrationPreview && (
        <div className={styles.schemaMigrationBackdrop} role="presentation">
          <div className={styles.schemaMigrationDialog} role="dialog" aria-modal="true">
            <div className={styles.detailsTitle}>Migrate {engineTypeMigrationPreview.typeName}</div>
            <p>{engineTypeMigrationPreview.affectedValues} stored JSON value(s) will change.</p>
            <div className={styles.schemaMigrationSummary}>
              {engineTypeMigrationPreview.summary.addedFields.length > 0 && (
                <div>
                  <strong>Added</strong>
                  <span>{engineTypeMigrationPreview.summary.addedFields.join(', ')}</span>
                </div>
              )}
              {engineTypeMigrationPreview.summary.removedFields.length > 0 && (
                <div>
                  <strong>Removed</strong>
                  <span>{engineTypeMigrationPreview.summary.removedFields.join(', ')}</span>
                </div>
              )}
              {engineTypeMigrationPreview.summary.renamedFields.length > 0 && (
                <div>
                  <strong>Renamed</strong>
                  <span>
                    {engineTypeMigrationPreview.summary.renamedFields
                      .map((item) => `${item.from} → ${item.to}`)
                      .join(', ')}
                  </span>
                </div>
              )}
              {engineTypeMigrationPreview.summary.changedTypeFields.length > 0 && (
                <div>
                  <strong>Type changed</strong>
                  <span>{engineTypeMigrationPreview.summary.changedTypeFields.join(', ')}</span>
                </div>
              )}
            </div>
            {engineTypeMigrationPreview.affectedLocations.length > 0 && (
              <div className={styles.schemaMigrationLocations}>
                {engineTypeMigrationPreview.affectedLocations.map((location) => (
                  <div key={location}>{location}</div>
                ))}
              </div>
            )}
            <div className={styles.schemaMigrationActions}>
              <button type="button" onClick={cancelEngineTypeMigration}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={confirmEngineTypeMigration}
              >
                Migrate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AssetEditor({ asset }: { asset: AssetSource }) {
  const {
    assets,
    workspace,
    findAssetReferences,
    focusStoryResourceReference,
    updateAsset,
    removeAsset,
    revealWorkspaceItem,
  } = useStoryGraphStore();
  const resourcePath = workspace?.assetResources.find(
    (candidate) => candidate.asset.id === asset.id,
  )?.relativePath;
  const duplicate = assets.some(
    (candidate) => candidate.id !== asset.id && candidate.name === asset.name,
  );
  const references = findAssetReferences(asset.id);
  return (
    <div className={styles.details}>
      <div className={styles.detailsTitle}>Asset</div>
      <label>
        <span>Name</span>
        <ScriptNameInput value={asset.name} onCommit={(name) => updateAsset(asset.id, { name })} />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <CommitInput
          value={asset.displayName}
          onCommit={(displayName) => updateAsset(asset.id, { displayName })}
        />
      </label>
      <label>
        <span>Kind</span>
        <select
          value={asset.kind}
          onChange={(event) =>
            updateAsset(asset.id, { kind: event.target.value as AssetSource['kind'] })
          }
        >
          <option value="audio">Voice</option>
          <option value="portrait">Portrait</option>
          <option value="other">Other</option>
        </select>
      </label>
      <CommitTextarea
        label="Locale Paths"
        rows={4}
        value={Object.entries(asset.locales ?? {})
          .map(([locale, path]) => `${locale}=${path}`)
          .join('\n')}
        placeholder={'default=Audio/voice.wav\nzh-CN=Audio/voice.zh-CN.wav'}
        onCommit={(value) => {
          const locales = Object.fromEntries(
            value
              .split('\n')
              .map((line) => line.split('='))
              .filter((parts) => parts.length >= 2 && parts[0].trim())
              .map(([locale, ...path]) => [locale.trim(), path.join('=').trim()]),
          );
          updateAsset(asset.id, { locales });
        }}
      />
      <ResourceReferenceSection
        references={references}
        emptyMessage="This asset is not used by any Story or Character."
        onShow={focusStoryResourceReference}
      />
      {references.length > 0 && (
        <div className={styles.warning}>
          Remove these Story or Character references before deleting the asset.
        </div>
      )}
      <div className={styles.detailActions}>
        {workspace?.project && (
          <ReplaceResourceReferencesButton
            kind="asset"
            sourceId={asset.id}
            sourceLabel={asset.displayName}
            options={assets
              .filter((candidate) => candidate.id !== asset.id && candidate.kind === asset.kind)
              .map((candidate) => ({ id: candidate.id, label: candidate.displayName }))}
          />
        )}
        {resourcePath && (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void revealWorkspaceItem(resourcePath)}
          >
            Show in File Explorer
          </button>
        )}
        <button
          className={styles.dangerButton}
          type="button"
          disabled={references.length > 0}
          onClick={() => {
            if (window.confirm(`Delete asset ${asset.displayName}?`)) removeAsset(asset.id);
          }}
        >
          Delete Asset
        </button>
      </div>
    </div>
  );
}

function EventEditor({ event }: { event: EventSource }) {
  const { events, engineTypes, workspaceError, updateEvent, removeEvent } = useStoryGraphStore();
  const duplicate = events.some(
    (candidate) => candidate.id !== event.id && candidate.name === event.name,
  );
  return (
    <div className={styles.details}>
      <div className={styles.detailsTitle}>Project Event</div>
      <label>
        <span>Name</span>
        <ScriptNameInput
          value={event.name}
          onCommit={(name) => updateEvent(event.id, { name, displayName: name })}
        />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <CommitInput
          value={event.displayName}
          onCommit={(displayName) => updateEvent(event.id, { displayName })}
        />
      </label>
      <CommitTextarea
        label="Description"
        rows={4}
        value={event.description ?? ''}
        saveError={workspaceError}
        placeholder="Explain when this event is called and what the engine handler should do."
        onCommit={(value) => updateEvent(event.id, { description: value || undefined })}
      />
      <div className={styles.parameterHeader}>
        <span>Parameters</span>
        <NamedCreateControl
          title="Add event parameter"
          placeholder="Parameter name"
          buttonLabel="Add"
          existingNames={event.parameters.map((parameter) => parameter.name)}
          onCreate={(name) => {
            updateEvent(event.id, {
              parameters: [...event.parameters, { name, valueType: { kind: 'string' } }],
            });
          }}
        />
      </div>
      {event.parameters.length === 0 && <div className={styles.empty}>No parameters</div>}
      {event.parameters.map((parameter, index) => (
        <div className={styles.parameterRow} key={`${index}-${parameter.name}`}>
          <ScriptNameInput
            value={parameter.name}
            onCommit={(name) =>
              updateEvent(event.id, {
                parameters: event.parameters.map((candidate, candidateIndex) =>
                  candidateIndex === index ? { ...candidate, name } : candidate,
                ),
              })
            }
          />
          <select
            value={parameter.valueType.kind}
            onChange={(change) =>
              updateEvent(event.id, {
                parameters: event.parameters.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? {
                        ...candidate,
                        valueType:
                          change.target.value === 'json'
                            ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
                            : { kind: change.target.value as ScalarKind },
                      }
                    : candidate,
                ),
              })
            }
          >
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="json">Engine JSON</option>
          </select>
          {parameter.valueType.kind === 'json' && (
            <select
              value={parameter.valueType.name}
              onChange={(change) =>
                updateEvent(event.id, {
                  parameters: event.parameters.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? {
                          ...candidate,
                          valueType: { ...parameter.valueType, name: change.target.value },
                        }
                      : candidate,
                  ),
                })
              }
            >
              {!engineTypes.some((item) => item.name === engineTypeName(parameter.valueType)) && (
                <option value={engineTypeName(parameter.valueType)}>
                  {engineTypeName(parameter.valueType)} (undefined)
                </option>
              )}
              {engineTypes.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            title="Remove parameter"
            onClick={() =>
              updateEvent(event.id, {
                parameters: event.parameters.filter(
                  (_, candidateIndex) => candidateIndex !== index,
                ),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <div className={styles.infoText}>
        Call Event dispatches to the engine and immediately continues.
      </div>
      <button className={styles.dangerButton} type="button" onClick={() => removeEvent(event.id)}>
        Delete Event
      </button>
    </div>
  );
}

function SignalEditor({ signal }: { signal: SignalSource }) {
  const { signals, engineTypes, workspaceError, updateSignal, removeSignal } = useStoryGraphStore();
  const duplicate = signals.some(
    (candidate) => candidate.id !== signal.id && candidate.name === signal.name,
  );
  return (
    <div className={styles.details}>
      <div className={styles.detailsTitle}>Project Signal</div>
      <label>
        <span>Name</span>
        <ScriptNameInput
          value={signal.name}
          onCommit={(name) => updateSignal(signal.id, { name, displayName: name })}
        />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <CommitInput
          value={signal.displayName}
          onCommit={(displayName) => updateSignal(signal.id, { displayName })}
        />
      </label>
      <CommitTextarea
        label="Description"
        rows={4}
        value={signal.description ?? ''}
        saveError={workspaceError}
        placeholder="Explain when the engine sends this signal."
        onCommit={(value) => updateSignal(signal.id, { description: value || undefined })}
      />
      <div className={styles.parameterHeader}>
        <span>Parameters</span>
        <NamedCreateControl
          title="Add signal parameter"
          placeholder="Parameter name"
          buttonLabel="Add"
          existingNames={signal.parameters.map((parameter) => parameter.name)}
          onCreate={(name) => {
            updateSignal(signal.id, {
              parameters: [...signal.parameters, { name, valueType: { kind: 'string' } }],
            });
          }}
        />
      </div>
      {signal.parameters.length === 0 && <div className={styles.empty}>No parameters</div>}
      {signal.parameters.map((parameter, index) => (
        <div className={styles.parameterRow} key={`${index}-${parameter.name}`}>
          <ScriptNameInput
            value={parameter.name}
            onCommit={(name) =>
              updateSignal(signal.id, {
                parameters: signal.parameters.map((candidate, candidateIndex) =>
                  candidateIndex === index ? { ...candidate, name } : candidate,
                ),
              })
            }
          />
          <select
            value={parameter.valueType.kind}
            onChange={(change) =>
              updateSignal(signal.id, {
                parameters: signal.parameters.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? {
                        ...candidate,
                        valueType:
                          change.target.value === 'json'
                            ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
                            : { kind: change.target.value as ScalarKind },
                      }
                    : candidate,
                ),
              })
            }
          >
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="json">Engine JSON</option>
          </select>
          {parameter.valueType.kind === 'json' && (
            <select
              value={parameter.valueType.name}
              onChange={(change) =>
                updateSignal(signal.id, {
                  parameters: signal.parameters.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? {
                          ...candidate,
                          valueType: { ...parameter.valueType, name: change.target.value },
                        }
                      : candidate,
                  ),
                })
              }
            >
              {!engineTypes.some((item) => item.name === engineTypeName(parameter.valueType)) && (
                <option value={engineTypeName(parameter.valueType)}>
                  {engineTypeName(parameter.valueType)} (undefined)
                </option>
              )}
              {engineTypes.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            title="Remove parameter"
            onClick={() =>
              updateSignal(signal.id, {
                parameters: signal.parameters.filter(
                  (_, candidateIndex) => candidateIndex !== index,
                ),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <div className={styles.infoText}>
        Wait for Signal pauses story execution until this notification arrives.
      </div>
      <button className={styles.dangerButton} type="button" onClick={() => removeSignal(signal.id)}>
        Delete Signal
      </button>
    </div>
  );
}

function eventSignature(event: EventSource): string {
  const parameters = event.parameters
    .map((parameter) => `${parameter.name}: ${parameter.valueType.kind}`)
    .join(', ');
  return `${event.name}(${parameters}): ${event.returnType?.kind ?? 'void'}`;
}

function signalSignature(signal: SignalSource): string {
  const parameters = signal.parameters
    .map((parameter) => `${parameter.name}: ${parameter.valueType.kind}`)
    .join(', ');
  return `${signal.name}(${parameters})`;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function EventTable({
  events,
  signals,
}: {
  events: readonly EventSource[];
  signals: readonly SignalSource[];
}) {
  const { selectStoryData } = useStoryGraphStore();
  const markdown = [
    '## Events',
    '',
    '| Event | Stable ID | Description |',
    '| --- | --- | --- |',
    ...events.map(
      (event) =>
        `| \`${markdownCell(eventSignature(event))}\` | \`${event.id}\` | ${markdownCell(event.description ?? '')} |`,
    ),
    '',
    '## Signals',
    '',
    '| Signal | Stable ID | Description |',
    '| --- | --- | --- |',
    ...signals.map(
      (signal) =>
        `| \`${markdownCell(signalSignature(signal))}\` | \`${signal.id}\` | ${markdownCell(signal.description ?? '')} |`,
    ),
  ].join('\n');
  return (
    <div className={styles.eventTableDetails}>
      <div className={styles.eventTableTitleRow}>
        <div>
          <div className={styles.detailsTitle}>Project Interface Table</div>
          <p>Human-readable event and signal contract for engine programmers.</p>
        </div>
        <CopyButton text={markdown} label="Copy Markdown" />
      </div>
      {events.length === 0 ? (
        <div className={styles.empty}>No project events</div>
      ) : (
        <div className={styles.eventTableScroll}>
          <table className={styles.eventTable}>
            <thead>
              <tr>
                <th>Event / Signature</th>
                <th>Stable ID</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} onClick={() => selectStoryData({ kind: 'event', id: event.id })}>
                  <td>
                    <strong>{event.displayName}</strong>
                    <code>{eventSignature(event)}</code>
                  </td>
                  <td>
                    <code>{event.id}</code>
                  </td>
                  <td>{event.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.detailsTitle}>Signals</div>
      {signals.length === 0 ? (
        <div className={styles.empty}>No project signals</div>
      ) : (
        <div className={styles.eventTableScroll}>
          <table className={styles.eventTable}>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Stable ID</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <tr
                  key={signal.id}
                  onClick={() => selectStoryData({ kind: 'signal', id: signal.id })}
                >
                  <td>
                    <strong>{signal.displayName}</strong>
                    <code>{signalSignature(signal)}</code>
                  </td>
                  <td>
                    <code>{signal.id}</code>
                  </td>
                  <td>{signal.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function StoryDataInspector() {
  const {
    storyDataSelection,
    variables,
    projectVariables,
    chapters,
    characters,
    assets,
    events,
    signals,
    engineTypes,
  } = useStoryGraphStore();
  if (!storyDataSelection) return null;
  if (storyDataSelection.kind === 'event-table')
    return <EventTable events={events} signals={signals} />;
  if (storyDataSelection.kind === 'variable') {
    const variable = [
      ...variables,
      ...projectVariables,
      ...chapters.flatMap((chapter) => [
        ...chapter.parameters.map((parameter) => parameter.variable),
        ...chapter.outputs.map((output) => output.variable),
        ...chapter.localVariables,
      ]),
    ].find((item) => item.id === storyDataSelection.id);
    return variable ? <VariableEditor variable={variable} /> : null;
  }
  if (storyDataSelection.kind === 'character') {
    const character = characters.find((item) => item.id === storyDataSelection.id);
    return character ? <CharacterEditor character={character} /> : null;
  }
  if (storyDataSelection.kind === 'event') {
    const event = events.find((item) => item.id === storyDataSelection.id);
    return event ? <EventEditor event={event} /> : null;
  }
  if (storyDataSelection.kind === 'signal') {
    const signal = signals.find((item) => item.id === storyDataSelection.id);
    return signal ? <SignalEditor signal={signal} /> : null;
  }
  if (storyDataSelection.kind === 'engine-type') {
    const definition = engineTypes.find((item) => item.name === storyDataSelection.name);
    return definition ? <EngineTypeEditor definition={definition} /> : null;
  }
  const asset = assets.find((item) => item.id === storyDataSelection.id);
  return asset ? <AssetEditor asset={asset} /> : null;
}

export function StoryData() {
  const {
    hasActiveStory,
    workspace,
    variables,
    projectVariables,
    chapters,
    activeGraphId,
    characters,
    assets,
    events,
    signals,
    engineTypes,
    addVariable,
    addProjectVariable,
    updateSubstory,
    addCharacter,
    duplicateCharacter,
    addCharacterFromTemplate,
    updateCharacter,
    findCharacterReferences,
    addAsset,
    addEvent,
    addSignal,
    addEngineType,
    checkpoint,
    storyDataSelection,
    selectStoryData,
  } = useStoryGraphStore();
  const activeChapter = chapters.find((chapter) => chapter.id === activeGraphId);
  const addSubstoryVariable = (kind: 'parameter' | 'local', name: string) => {
    if (!activeChapter) return;
    const used = new Set(
      [
        ...variables,
        ...projectVariables,
        ...activeChapter.parameters.map((parameter) => parameter.variable),
        ...activeChapter.outputs.map((output) => output.variable),
        ...activeChapter.localVariables,
      ].map((variable) => variable.name),
    );
    if (used.has(name)) return;
    const variable: VariableDefinition = {
      id: createStableId('variable'),
      name,
      displayName: name,
      scope: 'local',
      valueType: { kind: 'string' },
      defaultValue: '',
    };
    updateSubstory(activeChapter.id, {
      ...(kind === 'parameter'
        ? {
            parameters: [...activeChapter.parameters, { direction: 'input' as const, variable }],
          }
        : { localVariables: [...activeChapter.localVariables, variable] }),
    });
    selectStoryData({ kind: 'variable', id: variable.id });
  };
  const [resourceSearch, setResourceSearch] = useState('');
  const [characterTagFilter, setCharacterTagFilter] = useState<string>();
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<CharacterId>>(new Set());
  const [batchTag, setBatchTag] = useState('');
  const [characterTemplateName, setCharacterTemplateName] = useState('blank');
  const characterTemplates = useMemo(
    () => [
      ...BUILTIN_CHARACTER_TEMPLATES.map((template) => ({ template, source: 'Built-in' })),
      ...(workspace?.characterTemplates ?? []).map(({ template }) => ({
        template,
        source: 'Project',
      })),
    ],
    [workspace?.characterTemplates],
  );
  const characterTags = useMemo(
    () => [...new Set(characters.flatMap((character) => character.tags ?? []))].sort(),
    [characters],
  );
  const filteredCharacters = useMemo(() => {
    return characters.filter(
      (character) =>
        (!characterTagFilter || character.tags?.includes(characterTagFilter)) &&
        matchesCharacterSearch(character, resourceSearch),
    );
  }, [characterTagFilter, characters, resourceSearch]);
  useEffect(() => {
    setSelectedCharacterIds(
      (current) => new Set([...current].filter((id) => characters.some((item) => item.id === id))),
    );
    if (characterTagFilter && !characterTags.includes(characterTagFilter)) {
      setCharacterTagFilter(undefined);
    }
  }, [characterTagFilter, characterTags, characters]);
  const applyBatchTag = (mode: 'add' | 'remove') => {
    const tag = batchTag.trim();
    if (!tag || selectedCharacterIds.size === 0) return;
    const changes = characters.flatMap((character) => {
      if (!selectedCharacterIds.has(character.id)) return [];
      const tags = updateCharacterTags(character.tags, tag, mode);
      if (JSON.stringify(tags) === JSON.stringify(character.tags)) return [];
      return [{ character, tags }];
    });
    if (changes.length === 0) return;
    checkpoint(undefined, mode === 'add' ? 'Add Character Tags' : 'Remove Character Tags');
    for (const { character, tags } of changes) {
      updateCharacter(
        character.id,
        {
          tags,
        },
        { recordHistory: false },
      );
    }
  };
  const filteredAssets = useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    return query
      ? assets.filter((item) =>
          `${item.name} ${item.displayName} ${item.kind}`.toLowerCase().includes(query),
        )
      : assets;
  }, [assets, resourceSearch]);
  const filteredEvents = useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    return query
      ? events.filter((item) =>
          `${item.name} ${item.displayName} ${item.description ?? ''} ${item.parameters
            .map((parameter) => `${parameter.name} ${parameter.valueType.kind}`)
            .join(' ')}`
            .toLowerCase()
            .includes(query),
        )
      : events;
  }, [events, resourceSearch]);
  const filteredSignals = useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    return query
      ? signals.filter((item) =>
          `${item.name} ${item.displayName} ${item.description ?? ''} ${item.parameters
            .map((parameter) => `${parameter.name} ${parameter.valueType.kind}`)
            .join(' ')}`
            .toLowerCase()
            .includes(query),
        )
      : signals;
  }, [signals, resourceSearch]);
  if (!hasActiveStory && !workspace?.project) {
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>Open a Story to edit its data</p>
        </div>
      </div>
    );
  }

  return (
    <div className={panelStyles.panel}>
      <div className={`${panelStyles.body} ${styles.body}`}>
        {workspace?.project && (
          <div className={styles.resourceSearch}>
            <input
              value={resourceSearch}
              placeholder="Search project resources…"
              onChange={(event) => setResourceSearch(event.target.value)}
            />
          </div>
        )}
        {hasActiveStory && activeChapter && (
          <>
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>Substory Inputs</span>
                <NamedCreateControl
                  title="Add input parameter"
                  placeholder="Input name"
                  existingNames={[
                    ...variables,
                    ...projectVariables,
                    ...activeChapter.parameters.map((item) => item.variable),
                    ...activeChapter.outputs.map((item) => item.variable),
                    ...activeChapter.localVariables,
                  ].map((variable) => variable.name)}
                  onCreate={(name) => addSubstoryVariable('parameter', name)}
                />
              </div>
              {activeChapter.parameters.length === 0 && (
                <div className={styles.empty}>No input parameters</div>
              )}
              {activeChapter.parameters.map(({ variable }) => (
                <div
                  key={variable.id}
                  className={`${styles.item} ${storyDataSelection?.kind === 'variable' && storyDataSelection.id === variable.id ? styles.selected : ''}`}
                  draggable
                  onClick={() => selectStoryData({ kind: 'variable', id: variable.id })}
                  onDragStart={(event) =>
                    writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'get' })
                  }
                >
                  <span className={`${styles.typeDot} ${styles[variable.valueType.kind]}`} />
                  <span className={styles.itemName}>{variable.name}</span>
                  <span className={styles.itemType}>{variable.valueType.kind}</span>
                  <span
                    className={styles.setDrag}
                    draggable
                    title="Drag to create Set Variable"
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      writeStoryDataDrag(event, {
                        kind: 'variable',
                        id: variable.id,
                        action: 'set',
                      });
                    }}
                  >
                    S
                  </span>
                </div>
              ))}
            </section>
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>Substory Locals</span>
                <NamedCreateControl
                  title="Add local variable"
                  placeholder="Local name"
                  existingNames={[
                    ...variables,
                    ...projectVariables,
                    ...activeChapter.parameters.map((item) => item.variable),
                    ...activeChapter.outputs.map((item) => item.variable),
                    ...activeChapter.localVariables,
                  ].map((variable) => variable.name)}
                  onCreate={(name) => addSubstoryVariable('local', name)}
                />
              </div>
              {activeChapter.localVariables.length === 0 && (
                <div className={styles.empty}>No local variables</div>
              )}
              {activeChapter.localVariables.map((variable) => (
                <div
                  key={variable.id}
                  className={`${styles.item} ${storyDataSelection?.kind === 'variable' && storyDataSelection.id === variable.id ? styles.selected : ''}`}
                  draggable
                  onClick={() => selectStoryData({ kind: 'variable', id: variable.id })}
                  onDragStart={(event) =>
                    writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'get' })
                  }
                >
                  <span className={`${styles.typeDot} ${styles[variable.valueType.kind]}`} />
                  <span className={styles.itemName}>{variable.name}</span>
                  <span className={styles.itemType}>{variable.valueType.kind}</span>
                  <span
                    className={styles.setDrag}
                    draggable
                    title="Drag to create Set Variable"
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      writeStoryDataDrag(event, {
                        kind: 'variable',
                        id: variable.id,
                        action: 'set',
                      });
                    }}
                  >
                    S
                  </span>
                </div>
              ))}
            </section>
          </>
        )}
        {hasActiveStory && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Variables</span>
              <NamedCreateControl
                title="Add variable"
                placeholder="Variable name"
                existingNames={variables.map((variable) => variable.name)}
                onCreate={(name) =>
                  selectStoryData({ kind: 'variable', id: addVariable(name) })
                }
              />
            </div>
            {variables.length === 0 && <div className={styles.empty}>No variables</div>}
            {variables.map((variable) => (
              <div
                key={variable.id}
                className={`${styles.item} ${storyDataSelection?.kind === 'variable' && storyDataSelection.id === variable.id ? styles.selected : ''}`}
                draggable
                onClick={() => selectStoryData({ kind: 'variable', id: variable.id })}
                onDragStart={(event) =>
                  writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'get' })
                }
              >
                <span className={`${styles.typeDot} ${styles[variable.valueType.kind]}`} />
                <span className={styles.itemName}>{variable.name}</span>
                <span className={styles.itemType}>{variable.valueType.kind}</span>
                <span
                  className={styles.setDrag}
                  draggable
                  title="Drag to create Set Variable"
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'set' });
                  }}
                >
                  S
                </span>
              </div>
            ))}
          </section>
        )}

        {workspace?.project && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Engine Types</span>
              <NamedCreateControl
                title="Add Engine Type"
                placeholder="Type name"
                existingNames={engineTypes.map((item) => item.name)}
                onCreate={(requestedName) => {
                  const name = addEngineType(requestedName);
                  if (name) selectStoryData({ kind: 'engine-type', name });
                }}
              />
            </div>
            {engineTypes.length === 0 && <div className={styles.empty}>No Engine Types</div>}
            {engineTypes.map((engineType) => (
              <div
                key={engineType.name}
                className={`${styles.item} ${storyDataSelection?.kind === 'engine-type' && storyDataSelection.name === engineType.name ? styles.selected : ''}`}
                onClick={() => selectStoryData({ kind: 'engine-type', name: engineType.name })}
              >
                <span className={`${styles.typeDot} ${styles.json}`} />
                <span className={styles.itemName}>{engineType.displayName}</span>
                <span className={styles.itemType}>{engineType.fields.length} fields</span>
              </div>
            ))}
          </section>
        )}

        {workspace?.project && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Project Variables</span>
              <NamedCreateControl
                title="Add project variable"
                placeholder="Variable name"
                existingNames={[...variables, ...projectVariables].map((item) => item.name)}
                onCreate={(name) => {
                  const id = addProjectVariable(name);
                  if (id) selectStoryData({ kind: 'variable', id });
                }}
              />
            </div>
            {projectVariables.length === 0 && (
              <div className={styles.empty}>No project variables</div>
            )}
            {projectVariables.map((variable) => (
              <div
                key={variable.id}
                className={`${styles.item} ${storyDataSelection?.kind === 'variable' && storyDataSelection.id === variable.id ? styles.selected : ''}`}
                draggable
                onClick={() => selectStoryData({ kind: 'variable', id: variable.id })}
                onDragStart={(event) =>
                  writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'get' })
                }
              >
                <span className={`${styles.typeDot} ${styles[variable.valueType.kind]}`} />
                <span className={styles.itemName}>{variable.name}</span>
                <span className={styles.itemType}>{variable.valueType.kind}</span>
                <span
                  className={styles.setDrag}
                  draggable
                  title="Drag to create Set Variable"
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    writeStoryDataDrag(event, { kind: 'variable', id: variable.id, action: 'set' });
                  }}
                >
                  S
                </span>
              </div>
            ))}
          </section>
        )}

        {workspace?.project && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Project Events</span>
              <div className={styles.sectionHeaderActions}>
                <button
                  type="button"
                  title="Open event interface table"
                  onClick={() => selectStoryData({ kind: 'event-table' })}
                >
                  ≡
                </button>
                <NamedCreateControl
                  title="Add event"
                  placeholder="Event name"
                  existingNames={events.map((item) => item.name)}
                  onCreate={(name) => {
                    const id = addEvent(name);
                    if (id) selectStoryData({ kind: 'event', id });
                  }}
                />
              </div>
            </div>
            {events.length === 0 && <div className={styles.empty}>No events</div>}
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className={`${styles.item} ${styles.eventTableRow} ${storyDataSelection?.kind === 'event' && storyDataSelection.id === event.id ? styles.selected : ''}`}
                draggable
                onClick={() => selectStoryData({ kind: 'event', id: event.id })}
                onDragStart={(drag) => writeStoryDataDrag(drag, { kind: 'event', id: event.id })}
              >
                <span className={`${styles.typeDot} ${styles.event}`} />
                <span className={styles.eventTableSummary}>
                  <strong>{event.displayName}</strong>
                  <code>
                    {event.name}(
                    {event.parameters
                      .map((parameter) => `${parameter.name}: ${parameter.valueType.kind}`)
                      .join(', ')}
                    )
                  </code>
                  {event.description && <small>{event.description}</small>}
                </span>
              </div>
            ))}
          </section>
        )}

        {workspace?.project && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Project Signals</span>
              <div className={styles.sectionHeaderActions}>
                <button
                  type="button"
                  title="Open project interface table"
                  onClick={() => selectStoryData({ kind: 'event-table' })}
                >
                  ≡
                </button>
                <NamedCreateControl
                  title="Add signal"
                  placeholder="Signal name"
                  existingNames={signals.map((item) => item.name)}
                  onCreate={(name) => {
                    const id = addSignal(name);
                    if (id) selectStoryData({ kind: 'signal', id });
                  }}
                />
              </div>
            </div>
            {signals.length === 0 && <div className={styles.empty}>No signals</div>}
            {filteredSignals.map((signal) => (
              <div
                key={signal.id}
                className={`${styles.item} ${styles.eventTableRow} ${storyDataSelection?.kind === 'signal' && storyDataSelection.id === signal.id ? styles.selected : ''}`}
                draggable
                onClick={() => selectStoryData({ kind: 'signal', id: signal.id })}
                onDragStart={(drag) => writeStoryDataDrag(drag, { kind: 'signal', id: signal.id })}
              >
                <span className={`${styles.typeDot} ${styles.event}`} />
                <span className={styles.eventTableSummary}>
                  <strong>{signal.displayName}</strong>
                  <code>{signalSignature(signal)}</code>
                  {signal.description && <small>{signal.description}</small>}
                </span>
              </div>
            ))}
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{workspace?.project ? 'Project Assets' : 'Assets'}</span>
            <NamedCreateControl
              title="Add asset"
              placeholder="Asset name"
              existingNames={assets.map((item) => item.name)}
              onCreate={(name) => selectStoryData({ kind: 'asset', id: addAsset(name) })}
            />
          </div>
          {assets.length === 0 && <div className={styles.empty}>No assets</div>}
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className={`${styles.item} ${storyDataSelection?.kind === 'asset' && storyDataSelection.id === asset.id ? styles.selected : ''}`}
              draggable
              onClick={() => selectStoryData({ kind: 'asset', id: asset.id })}
              onDragStart={(event) => writeStoryDataDrag(event, { kind: 'asset', id: asset.id })}
            >
              <span className={`${styles.typeDot} ${styles.asset}`} />
              <span className={styles.itemName}>{asset.displayName}</span>
              <span className={styles.itemType}>{asset.kind}</span>
            </div>
          ))}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{workspace?.project ? 'Project Characters' : 'Characters'}</span>
            <div className={styles.characterCreateControls}>
              <select
                value={characterTemplateName}
                title="Character template"
                onChange={(event) => setCharacterTemplateName(event.target.value)}
              >
                <option value="blank">Blank</option>
                {characterTemplates.map(({ template, source }) => (
                  <option value={`${source}:${template.name}`} key={`${source}:${template.name}`}>
                    {template.displayName} ({source})
                  </option>
                ))}
              </select>
              <NamedCreateControl
                title="Add character"
                placeholder="Character name"
                existingNames={characters.map((item) => item.name)}
                onCreate={(name) => {
                  const selected = characterTemplates.find(
                    ({ template, source }) =>
                      `${source}:${template.name}` === characterTemplateName,
                  );
                  const id = selected
                    ? addCharacterFromTemplate(selected.template, name)
                    : addCharacter(name);
                  selectStoryData({ kind: 'character', id });
                }}
              />
            </div>
          </div>
          {characterTags.length > 0 && (
            <div className={styles.tagFilters}>
              <button
                type="button"
                className={!characterTagFilter ? styles.activeTagFilter : undefined}
                onClick={() => setCharacterTagFilter(undefined)}
              >
                All
              </button>
              {characterTags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={characterTagFilter === tag ? styles.activeTagFilter : undefined}
                  onClick={() => setCharacterTagFilter(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          {selectedCharacterIds.size > 0 && (
            <div className={styles.batchBar}>
              <strong>{selectedCharacterIds.size} selected</strong>
              <input
                value={batchTag}
                placeholder="Tag"
                onChange={(event) => setBatchTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyBatchTag('add');
                }}
              />
              <button
                type="button"
                disabled={!batchTag.trim()}
                onClick={() => applyBatchTag('add')}
              >
                Add
              </button>
              <button
                type="button"
                disabled={!batchTag.trim()}
                onClick={() => applyBatchTag('remove')}
              >
                Remove
              </button>
              <button type="button" onClick={() => setSelectedCharacterIds(new Set())}>
                Clear
              </button>
            </div>
          )}
          {characters.length === 0 && <div className={styles.empty}>No characters</div>}
          {characters.length > 0 && filteredCharacters.length === 0 && (
            <div className={styles.empty}>No matching characters</div>
          )}
          {filteredCharacters.map((character) => (
            <div
              key={character.id}
              className={`${styles.item} ${styles.characterTableRow} ${storyDataSelection?.kind === 'character' && storyDataSelection.id === character.id ? styles.selected : ''}`}
              draggable
              onClick={() => selectStoryData({ kind: 'character', id: character.id })}
              onDragStart={(event) =>
                writeStoryDataDrag(event, { kind: 'character', id: character.id })
              }
            >
              <input
                className={styles.characterCheckbox}
                type="checkbox"
                checked={selectedCharacterIds.has(character.id)}
                aria-label={`Select ${character.displayName}`}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  setSelectedCharacterIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(character.id);
                    else next.delete(character.id);
                    return next;
                  });
                }}
              />
              <span
                className={`${styles.characterAvatar} ${character.defaultPortraitId ? styles.hasPortrait : ''}`}
                title={
                  character.defaultPortraitId
                    ? `Portrait: ${assets.find((asset) => asset.id === character.defaultPortraitId)?.displayName ?? character.defaultPortraitId}`
                    : 'No default portrait'
                }
              >
                {character.displayName.trim().charAt(0).toLocaleUpperCase() || '?'}
              </span>
              <span className={styles.characterSummary}>
                <strong>{character.displayName}</strong>
                <code>{character.name}</code>
                {(character.tags?.length ?? 0) > 0 && (
                  <span className={styles.characterTags}>
                    {character.tags!.slice(0, 3).map((tag) => (
                      <em key={tag}>{tag}</em>
                    ))}
                    {character.tags!.length > 3 && <em>+{character.tags!.length - 3}</em>}
                  </span>
                )}
                {(character.description || character.dialogueStyle) && (
                  <small>{character.description || character.dialogueStyle}</small>
                )}
              </span>
              <span className={styles.referenceCount} title="References in loaded Stories">
                {findCharacterReferences(character.id).length}
              </span>
              <button
                className={styles.inlineAction}
                type="button"
                title={`Duplicate ${character.displayName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const id = duplicateCharacter(character.id);
                  if (id) selectStoryData({ kind: 'character', id });
                }}
              >
                ⧉
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
