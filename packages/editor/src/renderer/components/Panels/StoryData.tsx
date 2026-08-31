import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ENGINE_OBJECT_TYPE_MARKER,
  createStableId,
  engineObjectTypeId,
  engineValueMatchesFieldType,
  stripEngineObjectTypeMarkers,
  tagEngineObject,
} from '@story-blueprint/common';
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

const JsonMonacoEditor = lazy(() =>
  import('./JsonMonacoEditor').then((module) => ({ default: module.JsonMonacoEditor })),
);

type ScalarKind = 'boolean' | 'number' | 'string';
type EditableKind = ScalarKind | 'json';
type VariableEditableKind = EditableKind | 'array' | 'map';

const stopInspectorEvent = (event: { stopPropagation: () => void }) => event.stopPropagation();

function engineTypeName(valueType: ValueType): string {
  return valueType.kind === 'json' ? valueType.name : 'EnginePayload';
}

function defaultForType(kind: ScalarKind): RuntimeValue {
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  return '';
}

function containerTypeSelection(type: ValueType | undefined): string {
  if (!type) return 'any';
  return type.kind === 'json' ? `json:${type.name}` : type.kind;
}

function containerValueType(selection: string): ValueType {
  return selection.startsWith('json:')
    ? { kind: 'json', name: selection.slice(5) }
    : ({ kind: selection } as ValueType);
}

function valueTypeToEngineFieldType(type: ValueType | undefined): EngineFieldType {
  if (!type || type.kind === 'any') return { kind: 'any' };
  if (type.kind === 'json') return { kind: 'object', typeName: type.name };
  if (type.kind === 'array') {
    return { kind: 'array', elementType: valueTypeToEngineFieldType(type.elementType) };
  }
  if (type.kind === 'map') {
    return {
      kind: 'map',
      keyType: { kind: type.keyType ?? 'string' },
      valueType: valueTypeToEngineFieldType(type.valueType),
    };
  }
  if (type.kind === 'enum') return { kind: 'enum', values: type.values };
  if (type.kind === 'struct') return { kind: 'any' };
  return { kind: type.kind };
}

function defaultForEngineFieldType(
  type: EngineFieldType,
  engineTypes: readonly EngineTypeDefinition[],
): RuntimeValue {
  if (type.kind === 'any') return null;
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
  if (type.kind === 'character-ref' || type.kind === 'asset-ref') return Boolean(key);
  return type.values.includes(key);
}

function MapKeyInput({
  value,
  type,
  usedKeys,
  characters,
  assets,
  onCommit,
}: {
  value: string;
  type: EngineMapKeyType;
  usedKeys: readonly string[];
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  onCommit: (key: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (type.kind === 'enum') {
    return (
      <select value={value} onChange={(event) => onCommit(event.target.value)}>
        {type.values.map((option) => (
          <option
            key={option}
            value={option}
            disabled={option !== value && usedKeys.includes(option)}
          >
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (type.kind === 'character-ref' || type.kind === 'asset-ref') {
    const options =
      type.kind === 'character-ref'
        ? characters.map((character) => ({ id: character.id, label: character.displayName }))
        : assets.map((asset) => ({ id: asset.id, label: `${asset.displayName} · ${asset.kind}` }));
    return (
      <select value={value} onChange={(event) => onCommit(event.target.value)}>
        {options.map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={option.id !== value && usedKeys.includes(option.id)}
          >
            {option.label}
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

type AnyJsonKind =
  'null' | 'boolean' | 'number' | 'string' | 'character-ref' | 'asset-ref' | 'array' | 'object';

function anyJsonKind(
  value: RuntimeValue,
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
): AnyJsonKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (characters.some((character) => character.id === value)) return 'character-ref';
  if (assets.some((asset) => asset.id === value)) return 'asset-ref';
  return 'string';
}

function defaultAnyJsonValue(kind: AnyJsonKind): RuntimeValue {
  if (kind === 'null') return null;
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  if (kind === 'string') return '';
  if (kind === 'array') return [];
  return {};
}

const ARRAY_REORDER_MIME = 'application/x-story-blueprint-array-index';

function reorderArrayItems(
  items: readonly RuntimeValue[],
  fromIndex: number,
  targetIndex: number,
  side: 'before' | 'after',
): RuntimeValue[] {
  const reordered = [...items];
  if (
    fromIndex < 0 ||
    targetIndex < 0 ||
    fromIndex >= reordered.length ||
    targetIndex >= reordered.length
  ) {
    return reordered;
  }
  const [moved] = reordered.splice(fromIndex, 1);
  let insertionIndex = targetIndex + (side === 'after' ? 1 : 0);
  if (fromIndex < insertionIndex) insertionIndex -= 1;
  reordered.splice(insertionIndex, 0, moved!);
  return reordered;
}

function readArrayDragIndex(data: string, ownerId: string): number | undefined {
  try {
    const payload = JSON.parse(data) as { ownerId?: unknown; index?: unknown };
    return payload.ownerId === ownerId && Number.isInteger(payload.index)
      ? (payload.index as number)
      : undefined;
  } catch {
    return undefined;
  }
}

function ConfirmDeleteButton({
  title,
  message,
  ariaLabel,
  buttonText = '−',
  buttonTitle = 'Delete',
  confirmText = 'Delete',
  disabled = false,
  onConfirm,
}: {
  title: string;
  message: string;
  ariaLabel: string;
  buttonText?: ReactNode;
  buttonTitle?: string;
  confirmText?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={buttonTitle}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {buttonText}
      </button>
      {open &&
        createPortal(
          <div
            className={styles.namedCreateBackdrop}
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              className={styles.schemaMigrationDialog}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className={styles.detailsTitle}>{title}</div>
              <p>{message}</p>
              <div className={styles.schemaMigrationActions}>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => {
                    setOpen(false);
                    onConfirm();
                  }}
                >
                  {confirmText}
                </button>
                <button type="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5.5 2.5h5l.5 1.5h2v1H3V4h2l.5-1.5ZM4.5 6h7l-.45 7H4.95L4.5 6Zm2 1v4.5h1V7h-1Zm2 0v4.5h1V7h-1Z" />
    </svg>
  );
}

const MAP_REORDER_MIME = 'application/x-story-blueprint-map-key';
const COLLECTION_WINDOW_SIZE = 50;
const COLLECTION_SEARCH_THRESHOLD = 20;

function reorderMapEntries(
  record: Readonly<Record<string, RuntimeValue>>,
  fromKey: string,
  targetKey: string,
  side: 'before' | 'after',
): Record<string, RuntimeValue> {
  if (fromKey === targetKey || !(fromKey in record) || !(targetKey in record)) return { ...record };
  const entries = Object.entries(record);
  const fromIndex = entries.findIndex(([key]) => key === fromKey);
  const targetIndex = entries.findIndex(([key]) => key === targetKey);
  const [moved] = entries.splice(fromIndex, 1);
  let insertionIndex = targetIndex + (side === 'after' ? 1 : 0);
  if (fromIndex < insertionIndex) insertionIndex -= 1;
  entries.splice(insertionIndex, 0, moved!);
  return Object.fromEntries(entries);
}

function readMapDragKey(data: string, ownerId: string): string | undefined {
  try {
    const payload = JSON.parse(data) as { ownerId?: unknown; key?: unknown };
    return payload.ownerId === ownerId && typeof payload.key === 'string' ? payload.key : undefined;
  } catch {
    return undefined;
  }
}

function collectionValueMatches(
  query: string,
  key: string,
  value: RuntimeValue,
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  if (key.toLocaleLowerCase().includes(normalized)) return true;
  try {
    const serialized = JSON.stringify(stripEngineObjectTypeMarkers(value)).toLocaleLowerCase();
    if (serialized.includes(normalized)) return true;
    if (
      characters.some(
        (character) =>
          character.displayName.toLocaleLowerCase().includes(normalized) &&
          serialized.includes(character.id.toLocaleLowerCase()),
      )
    )
      return true;
    return assets.some(
      (asset) =>
        asset.displayName.toLocaleLowerCase().includes(normalized) &&
        serialized.includes(asset.id.toLocaleLowerCase()),
    );
  } catch {
    return false;
  }
}

function CollectionWindowControls({
  noun,
  total,
  matched,
  visible,
  query,
  onQueryChange,
  onShowMore,
}: {
  noun: string;
  total: number;
  matched: number;
  visible: number;
  query: string;
  onQueryChange: (query: string) => void;
  onShowMore: () => void;
}) {
  if (total < COLLECTION_SEARCH_THRESHOLD && visible >= matched) return null;
  return (
    <div className={styles.collectionWindowControls}>
      {total >= COLLECTION_SEARCH_THRESHOLD && (
        <input
          type="search"
          value={query}
          placeholder={`Search ${noun}…`}
          aria-label={`Search ${noun}`}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      )}
      <small>
        Showing {Math.min(visible, matched)} of {matched}
        {matched !== total ? ` matched · ${total} total` : ''}
      </small>
      {visible < matched && (
        <button type="button" onClick={onShowMore}>
          Show {Math.min(COLLECTION_WINDOW_SIZE, matched - visible)} more
        </button>
      )}
    </div>
  );
}

function containsEngineObjectMarker(value: RuntimeValue): boolean {
  if (Array.isArray(value)) return value.some(containsEngineObjectMarker);
  if (value !== null && typeof value === 'object') {
    if (ENGINE_OBJECT_TYPE_MARKER in value) return true;
    return Object.values(value).some(containsEngineObjectMarker);
  }
  return false;
}

function restoreEngineObjectMarkers(
  edited: RuntimeValue,
  original: RuntimeValue,
  type: EngineFieldType | undefined,
  engineTypes: readonly EngineTypeDefinition[],
): RuntimeValue {
  if (Array.isArray(edited)) {
    const originalItems = Array.isArray(original) ? original : [];
    const elementType =
      type?.kind === 'array' ? type.elementType : type?.kind === 'any' ? type : undefined;
    return edited.map((item, index) =>
      restoreEngineObjectMarkers(item, originalItems[index] ?? null, elementType, engineTypes),
    );
  }
  if (edited === null || typeof edited !== 'object') return edited;
  const originalRecord: Readonly<Record<string, RuntimeValue>> =
    original !== null && typeof original === 'object' && !Array.isArray(original)
      ? (original as Readonly<Record<string, RuntimeValue>>)
      : {};
  let fieldTypes = new Map<string, EngineFieldType>();
  let typeId = type?.kind === 'any' ? engineObjectTypeId(original) : undefined;
  if (type?.kind === 'object') {
    const definition = engineTypes.find((candidate) => candidate.name === type.typeName);
    typeId = definition?.id;
    fieldTypes = new Map(definition?.fields.map((field) => [field.name, field.type]) ?? []);
  }
  const valueType = type?.kind === 'map' ? type.valueType : type?.kind === 'any' ? type : undefined;
  const restored = Object.fromEntries(
    Object.entries(edited).map(([key, item]) => [
      key,
      restoreEngineObjectMarkers(
        item,
        originalRecord[key] ?? null,
        fieldTypes.get(key) ?? valueType,
        engineTypes,
      ),
    ]),
  );
  return typeId ? tagEngineObject(restored, typeId) : restored;
}

function validateMarkedEngineObjects(
  value: RuntimeValue,
  engineTypes: readonly EngineTypeDefinition[],
  path = '$',
): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const error = validateMarkedEngineObjects(value[index]!, engineTypes, `${path}[${index}]`);
      if (error) return error;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  const typeId = engineObjectTypeId(value);
  if (typeId) {
    const definition = engineTypes.find((candidate) => candidate.id === typeId);
    if (!definition)
      return `${path}.${ENGINE_OBJECT_TYPE_MARKER} references missing Engine Type ${typeId}.`;
    if (
      !engineValueMatchesFieldType(
        value,
        { kind: 'object', typeName: definition.name },
        engineTypes,
      )
    ) {
      return `${path} does not match Engine Type ${definition.displayName}.`;
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === ENGINE_OBJECT_TYPE_MARKER) continue;
    const error = validateMarkedEngineObjects(item, engineTypes, `${path}.${key}`);
    if (error) return error;
  }
  return undefined;
}

interface StructuredValueDiagnostic {
  readonly path: string;
  readonly message: string;
}

function collectStructuredValueDiagnostics(
  value: RuntimeValue,
  type: EngineFieldType,
  engineTypes: readonly EngineTypeDefinition[],
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
  path = '$',
  nullable = false,
): StructuredValueDiagnostic[] {
  if (value === null) {
    return nullable || type.kind === 'any'
      ? []
      : [{ path, message: `Expected ${type.kind}, but the value is Null.` }];
  }
  if (type.kind === 'any') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return [{ path, message: 'Number must be finite.' }];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        collectStructuredValueDiagnostics(
          item,
          type,
          engineTypes,
          characters,
          assets,
          `${path}[${index}]`,
        ),
      );
    }
    if (typeof value === 'object') {
      const markedType = engineObjectTypeId(value);
      if (markedType) {
        const definition = engineTypes.find((candidate) => candidate.id === markedType);
        if (!definition)
          return [{ path, message: `Referenced Engine Type ${markedType} is missing.` }];
        return collectStructuredValueDiagnostics(
          value,
          { kind: 'object', typeName: definition.name },
          engineTypes,
          characters,
          assets,
          path,
        );
      }
      return Object.entries(value).flatMap(([key, item]) =>
        key === ENGINE_OBJECT_TYPE_MARKER
          ? []
          : collectStructuredValueDiagnostics(
              item,
              type,
              engineTypes,
              characters,
              assets,
              `${path}.${key}`,
            ),
      );
    }
    return [];
  }
  if (type.kind === 'boolean')
    return typeof value === 'boolean' ? [] : [{ path, message: 'Expected Boolean.' }];
  if (type.kind === 'number')
    return typeof value === 'number' && Number.isFinite(value)
      ? []
      : [{ path, message: 'Expected a finite Number.' }];
  if (type.kind === 'string')
    return typeof value === 'string' ? [] : [{ path, message: 'Expected String.' }];
  if (type.kind === 'character-ref') {
    if (typeof value !== 'string') return [{ path, message: 'Expected Character Reference.' }];
    return characters.some((character) => character.id === value)
      ? []
      : [{ path, message: `Character ${value} does not exist.` }];
  }
  if (type.kind === 'asset-ref') {
    if (typeof value !== 'string') return [{ path, message: 'Expected Asset Reference.' }];
    return assets.some((asset) => asset.id === value)
      ? []
      : [{ path, message: `Asset ${value} does not exist.` }];
  }
  if (type.kind === 'enum')
    return typeof value === 'string' && type.values.includes(value)
      ? []
      : [{ path, message: `Expected one of: ${type.values.join(', ') || '(no values)'}.` }];
  if (type.kind === 'array') {
    if (!Array.isArray(value)) return [{ path, message: 'Expected Array.' }];
    return value.flatMap((item, index) =>
      collectStructuredValueDiagnostics(
        item,
        type.elementType,
        engineTypes,
        characters,
        assets,
        `${path}[${index}]`,
      ),
    );
  }
  if (type.kind === 'map') {
    if (Array.isArray(value) || typeof value !== 'object')
      return [{ path, message: 'Expected Map.' }];
    return Object.entries(value).flatMap(([key, item]) => {
      const keyValid =
        type.keyType.kind === 'string'
          ? key.length > 0
          : type.keyType.kind === 'number'
            ? key.trim() !== '' && Number.isFinite(Number(key))
            : type.keyType.kind === 'character-ref'
              ? characters.some((character) => character.id === key)
              : type.keyType.kind === 'asset-ref'
                ? assets.some((asset) => asset.id === key)
                : type.keyType.values.includes(key);
      return [
        ...(keyValid ? [] : [{ path: `${path}.${key}`, message: `Map key ${key} is invalid.` }]),
        ...collectStructuredValueDiagnostics(
          item,
          type.valueType,
          engineTypes,
          characters,
          assets,
          `${path}.${key}`,
        ),
      ];
    });
  }
  if (Array.isArray(value) || typeof value !== 'object')
    return [{ path, message: `Expected Object ${type.typeName}.` }];
  const definition = engineTypes.find((candidate) => candidate.name === type.typeName);
  if (!definition) return [{ path, message: `Engine Type ${type.typeName} does not exist.` }];
  const record = value as Readonly<Record<string, RuntimeValue>>;
  return definition.fields.flatMap((field) => {
    const fieldValue = record[field.name];
    if (fieldValue === undefined)
      return [{ path: `${path}.${field.name}`, message: 'Required field is missing.' }];
    return collectStructuredValueDiagnostics(
      fieldValue,
      field.type,
      engineTypes,
      characters,
      assets,
      `${path}.${field.name}`,
      field.nullable === true,
    );
  });
}

function FocusedValueEditor({
  label,
  errorCount = 0,
  children,
}: {
  label: string;
  errorCount?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return (
    <>
      <button type="button" className={styles.focusValueButton} onClick={() => setOpen(true)}>
        Open {label}…
        {errorCount > 0 && <em className={styles.structuredErrorBadge}>{errorCount}</em>}
      </button>
      {open &&
        createPortal(
          <div
            className={styles.focusValueBackdrop}
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              className={styles.focusValueDialog}
              role="dialog"
              aria-modal="true"
              aria-label={`Edit ${label}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <header className={styles.focusValueHeader}>
                <div>
                  <small>Focused value</small>
                  <strong>{label}</strong>
                </div>
                <button type="button" onClick={() => setOpen(false)}>
                  Done
                </button>
              </header>
              <div className={styles.focusValueContent}>{children}</div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

function AnyJsonFields({
  value,
  engineTypes,
  characters,
  assets,
  depth = 0,
  nullable = false,
  onChange,
}: {
  value: RuntimeValue;
  engineTypes: readonly EngineTypeDefinition[];
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  depth?: number;
  nullable?: boolean;
  onChange: (value: RuntimeValue) => void;
}) {
  const arrayOwnerId = useId();
  const [arrayDropTarget, setArrayDropTarget] = useState<{
    index: number;
    side: 'before' | 'after';
  }>();
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionLimit, setCollectionLimit] = useState(COLLECTION_WINDOW_SIZE);
  const kind = anyJsonKind(value, characters, assets);
  const markedObjectType = engineTypes.find(
    (definition) => definition.id === engineObjectTypeId(value),
  );
  const matchingObjectType =
    kind === 'object'
      ? (markedObjectType ??
        engineTypes.find((definition) => {
          if (definition.fields.length === 0) return false;
          const keys = Object.keys(value as Readonly<Record<string, RuntimeValue>>).filter(
            (key) => key !== ENGINE_OBJECT_TYPE_MARKER,
          );
          return (
            keys.length === definition.fields.length &&
            definition.fields.every((field) => keys.includes(field.name)) &&
            engineValueMatchesFieldType(
              value,
              { kind: 'object', typeName: definition.name },
              engineTypes,
            )
          );
        }))
      : undefined;
  if (depth >= 3 && (kind === 'array' || kind === 'object')) {
    const label =
      kind === 'array'
        ? `Array · ${(value as readonly RuntimeValue[]).length} items`
        : (matchingObjectType?.displayName ?? 'Free Object');
    return (
      <FocusedValueEditor label={label}>
        <AnyJsonFields
          value={value}
          engineTypes={engineTypes}
          characters={characters}
          assets={assets}
          depth={0}
          onChange={onChange}
        />
      </FocusedValueEditor>
    );
  }
  const editor = (() => {
    if (kind === 'null') return <span className={styles.anyJsonNull}>null</span>;
    if (kind === 'boolean') {
      return (
        <select value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}>
          <option value="false">False</option>
          <option value="true">True</option>
        </select>
      );
    }
    if (kind === 'number') {
      return (
        <input
          type="number"
          value={value as number}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      );
    }
    if (kind === 'string') {
      return <input value={value as string} onChange={(event) => onChange(event.target.value)} />;
    }
    if (kind === 'character-ref') {
      return (
        <select value={value as string} onChange={(event) => onChange(event.target.value)}>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.displayName}
            </option>
          ))}
        </select>
      );
    }
    if (kind === 'asset-ref') {
      return (
        <select value={value as string} onChange={(event) => onChange(event.target.value)}>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.displayName} · {asset.kind}
            </option>
          ))}
        </select>
      );
    }
    if (kind === 'array') {
      const items = [...(value as readonly RuntimeValue[])];
      const matchingIndices = items
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) =>
          collectionValueMatches(collectionQuery, String(index), item, characters, assets),
        )
        .map(({ index }) => index);
      const visibleIndices = matchingIndices.slice(0, collectionLimit);
      return (
        <details className={styles.structuredTreeGroup} open>
          <summary>
            <span>Items · {items.length}</span>
            <button
              type="button"
              aria-label="Add Array item"
              title="Add Item"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange([...items, null]);
                setCollectionQuery('');
                setCollectionLimit(items.length + 1);
              }}
            >
              +
            </button>
            <ConfirmDeleteButton
              title="Clear all Array items?"
              message="Every item and all nested values in this Array will be removed."
              ariaLabel="Clear all Array items"
              buttonText={<TrashIcon />}
              buttonTitle="Clear All"
              confirmText="Clear All"
              disabled={items.length === 0}
              onConfirm={() => onChange([])}
            />
          </summary>
          <div className={styles.structuredArray}>
            <CollectionWindowControls
              noun="items"
              total={items.length}
              matched={matchingIndices.length}
              visible={visibleIndices.length}
              query={collectionQuery}
              onQueryChange={(query) => {
                setCollectionQuery(query);
                setCollectionLimit(COLLECTION_WINDOW_SIZE);
              }}
              onShowMore={() => setCollectionLimit((current) => current + COLLECTION_WINDOW_SIZE)}
            />
            {items.length === 0 && (
              <div className={styles.structuredEmpty}>No items. Use + to add the first item.</div>
            )}
            {visibleIndices.map((index) => {
              const item = items[index]!;
              return (
                <div
                  className={`${styles.structuredArrayItem} ${
                    arrayDropTarget?.index === index ? styles.structuredArrayDropTarget : ''
                  }`}
                  data-drop-side={
                    arrayDropTarget?.index === index ? arrayDropTarget.side : undefined
                  }
                  key={index}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(ARRAY_REORDER_MIME)) {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setArrayDropTarget({
                        index,
                        side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                      });
                    }
                  }}
                  onDrop={(event) => {
                    const fromIndex = readArrayDragIndex(
                      event.dataTransfer.getData(ARRAY_REORDER_MIME),
                      arrayOwnerId,
                    );
                    if (fromIndex === undefined) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(
                      reorderArrayItems(
                        items,
                        fromIndex,
                        index,
                        arrayDropTarget?.index === index ? arrayDropTarget.side : 'before',
                      ),
                    );
                    setArrayDropTarget(undefined);
                  }}
                >
                  <span
                    className={styles.structuredItemLabel}
                    draggable
                    title="Drag to reorder"
                    onDragStart={(event) => {
                      event.stopPropagation();
                      setArrayDropTarget(undefined);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(
                        ARRAY_REORDER_MIME,
                        JSON.stringify({ ownerId: arrayOwnerId, index }),
                      );
                    }}
                    onDragEnd={() => setArrayDropTarget(undefined)}
                  >
                    [{index}]
                  </span>
                  <AnyJsonFields
                    value={item}
                    engineTypes={engineTypes}
                    characters={characters}
                    assets={assets}
                    depth={depth + 1}
                    onChange={(next) => {
                      const updated = [...items];
                      updated[index] = next;
                      onChange(updated);
                    }}
                  />
                  <span className={styles.structuredArrayActions}>
                    <button
                      type="button"
                      title="Insert Above"
                      aria-label={`Insert item above ${index}`}
                      onClick={() => {
                        const updated = [...items];
                        updated.splice(index, 0, null);
                        onChange(updated);
                      }}
                    >
                      +↑
                    </button>
                    <button
                      type="button"
                      title="Insert Below"
                      aria-label={`Insert item below ${index}`}
                      onClick={() => {
                        const updated = [...items];
                        updated.splice(index + 1, 0, null);
                        onChange(updated);
                      }}
                    >
                      +↓
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      aria-label={'Delete Array element ' + index}
                      onClick={() => onChange(items.filter((_, i) => i !== index))}
                    >
                      −
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      );
    }
    if (matchingObjectType) {
      return (
        <StructuredJsonFields
          type={{ kind: 'object', typeName: matchingObjectType.name }}
          value={value}
          engineTypes={engineTypes}
          characters={characters}
          assets={assets}
          depth={depth + 1}
          onChange={(next) => onChange(tagEngineObject(next, matchingObjectType.id))}
        />
      );
    }
    const record = Object.fromEntries(
      Object.entries(value as Readonly<Record<string, RuntimeValue>>).filter(
        ([key]) => key !== ENGINE_OBJECT_TYPE_MARKER,
      ),
    );
    const keys = Object.keys(record);
    const matchingKeys = keys.filter((key) =>
      collectionValueMatches(collectionQuery, key, record[key]!, characters, assets),
    );
    const visibleKeys = matchingKeys.slice(0, collectionLimit);
    let nextIndex = keys.length + 1;
    let nextKey = `field${nextIndex}`;
    while (keys.includes(nextKey)) nextKey = `field${++nextIndex}`;
    return (
      <details className={styles.structuredTreeGroup} open>
        <summary>
          <span>Fields · {keys.length}</span>
          <button
            type="button"
            aria-label="Add Object field"
            title="Add Field"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange({ ...record, [nextKey]: null });
              setCollectionQuery('');
              setCollectionLimit(keys.length + 1);
            }}
          >
            +
          </button>
        </summary>
        <div className={styles.structuredMap}>
          <CollectionWindowControls
            noun="fields"
            total={keys.length}
            matched={matchingKeys.length}
            visible={visibleKeys.length}
            query={collectionQuery}
            onQueryChange={(query) => {
              setCollectionQuery(query);
              setCollectionLimit(COLLECTION_WINDOW_SIZE);
            }}
            onShowMore={() => setCollectionLimit((current) => current + COLLECTION_WINDOW_SIZE)}
          />
          {keys.length === 0 && (
            <div className={styles.structuredEmpty}>No fields. Use + to add the first field.</div>
          )}
          {visibleKeys.map((key) => (
            <div className={styles.structuredMapItem} key={key}>
              <MapKeyInput
                value={key}
                type={{ kind: 'string' }}
                usedKeys={keys}
                characters={[]}
                assets={[]}
                onCommit={(renamed) =>
                  onChange(
                    Object.fromEntries(
                      Object.entries(record).map(([candidate, item]) => [
                        candidate === key ? renamed : candidate,
                        item,
                      ]),
                    ),
                  )
                }
              />
              <AnyJsonFields
                value={record[key]!}
                engineTypes={engineTypes}
                characters={characters}
                assets={assets}
                depth={depth + 1}
                onChange={(next) => onChange({ ...record, [key]: next })}
              />
              <ConfirmDeleteButton
                title={'Delete field ' + key + '?'}
                message="The field and its value will be removed."
                ariaLabel={'Delete Object field ' + key}
                onConfirm={() =>
                  onChange(
                    Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)),
                  )
                }
              />
            </div>
          ))}
        </div>
      </details>
    );
  })();
  return (
    <div className={styles.anyJsonValue}>
      <select
        aria-label="JSON item type"
        value={matchingObjectType ? `engine-object:${matchingObjectType.name}` : kind}
        onChange={(event) => {
          const selection = event.target.value;
          if (selection.startsWith('engine-object:')) {
            const definition = engineTypes.find(
              (candidate) => candidate.name === selection.slice('engine-object:'.length),
            );
            if (!definition) return;
            onChange(
              tagEngineObject(
                defaultForEngineFieldType(
                  { kind: 'object', typeName: selection.slice('engine-object:'.length) },
                  engineTypes,
                ),
                definition.id,
              ),
            );
            return;
          }
          if (selection === 'character-ref') {
            onChange(characters[0]?.id ?? null);
            return;
          }
          if (selection === 'asset-ref') {
            onChange(assets[0]?.id ?? null);
            return;
          }
          onChange(defaultAnyJsonValue(selection as AnyJsonKind));
        }}
      >
        <option value="null">Null</option>
        <option value="boolean">Boolean</option>
        <option value="number">Number</option>
        <option value="string">String</option>
        <option value="character-ref" disabled={characters.length === 0}>
          Character Reference
        </option>
        <option value="asset-ref" disabled={assets.length === 0}>
          Asset Reference
        </option>
        <option value="array">Array</option>
        <option value="object">Object · Free-form</option>
        {engineTypes.map((definition) => (
          <option key={definition.id} value={`engine-object:${definition.name}`}>
            Object · {definition.displayName}
          </option>
        ))}
      </select>
      {editor}
    </div>
  );
}

function StructuredJsonFields({
  type,
  value,
  engineTypes,
  characters,
  assets,
  depth = 0,
  nullable = false,
  onChange,
}: {
  type: EngineFieldType;
  value: RuntimeValue;
  engineTypes: readonly EngineTypeDefinition[];
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  depth?: number;
  nullable?: boolean;
  onChange: (value: RuntimeValue) => void;
}) {
  const arrayOwnerId = useId();
  const [arrayDropTarget, setArrayDropTarget] = useState<{
    index: number;
    side: 'before' | 'after';
  }>();
  const mapOwnerId = useId();
  const [mapDropTarget, setMapDropTarget] = useState<{
    key: string;
    side: 'before' | 'after';
  }>();
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionLimit, setCollectionLimit] = useState(COLLECTION_WINDOW_SIZE);
  const diagnostics = collectStructuredValueDiagnostics(
    value,
    type,
    engineTypes,
    characters,
    assets,
    '$',
    nullable,
  );
  if (depth >= 3 && (type.kind === 'array' || type.kind === 'map' || type.kind === 'object')) {
    const label =
      type.kind === 'array'
        ? `Array · ${Array.isArray(value) ? value.length : 0} items`
        : type.kind === 'map'
          ? `Map · ${value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0} entries`
          : (engineTypes.find((definition) => definition.name === type.typeName)?.displayName ??
            type.typeName);
    return (
      <FocusedValueEditor label={label} errorCount={diagnostics.length}>
        <StructuredJsonFields
          type={type}
          value={value}
          engineTypes={engineTypes}
          characters={characters}
          assets={assets}
          depth={0}
          onChange={onChange}
        />
      </FocusedValueEditor>
    );
  }
  if (type.kind === 'any')
    return (
      <AnyJsonFields
        value={value}
        engineTypes={engineTypes}
        characters={characters}
        assets={assets}
        depth={depth}
        onChange={onChange}
      />
    );
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
    const matchingIndices = items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) =>
        collectionValueMatches(collectionQuery, String(index), item, characters, assets),
      )
      .map(({ index }) => index);
    const visibleIndices = matchingIndices.slice(0, collectionLimit);
    return (
      <details className={styles.structuredTreeGroup} open>
        <summary>
          <span>
            Items · {items.length}
            {diagnostics.length > 0 && (
              <em className={styles.structuredErrorBadge}>{diagnostics.length}</em>
            )}
          </span>
          <button
            type="button"
            aria-label="Add Array item"
            title="Add Item"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange([...items, defaultForEngineFieldType(type.elementType, engineTypes)]);
              setCollectionQuery('');
              setCollectionLimit(items.length + 1);
            }}
          >
            +
          </button>
          <ConfirmDeleteButton
            title="Clear all Array items?"
            message="Every item and all nested values in this Array will be removed."
            ariaLabel="Clear all Array items"
            buttonText={<TrashIcon />}
            buttonTitle="Clear All"
            confirmText="Clear All"
            disabled={items.length === 0}
            onConfirm={() => onChange([])}
          />
        </summary>
        <div className={styles.structuredArray}>
          <CollectionWindowControls
            noun="items"
            total={items.length}
            matched={matchingIndices.length}
            visible={visibleIndices.length}
            query={collectionQuery}
            onQueryChange={(query) => {
              setCollectionQuery(query);
              setCollectionLimit(COLLECTION_WINDOW_SIZE);
            }}
            onShowMore={() => setCollectionLimit((current) => current + COLLECTION_WINDOW_SIZE)}
          />
          {items.length === 0 && (
            <div className={styles.structuredEmpty}>No items. Use + to add the first item.</div>
          )}
          {visibleIndices.map((index) => {
            const item = items[index]!;
            return (
              <div
                className={`${styles.structuredArrayItem} ${
                  arrayDropTarget?.index === index ? styles.structuredArrayDropTarget : ''
                }`}
                data-drop-side={arrayDropTarget?.index === index ? arrayDropTarget.side : undefined}
                key={index}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(ARRAY_REORDER_MIME)) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setArrayDropTarget({
                      index,
                      side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                    });
                  }
                }}
                onDrop={(event) => {
                  const fromIndex = readArrayDragIndex(
                    event.dataTransfer.getData(ARRAY_REORDER_MIME),
                    arrayOwnerId,
                  );
                  if (fromIndex === undefined) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(
                    reorderArrayItems(
                      items,
                      fromIndex,
                      index,
                      arrayDropTarget?.index === index ? arrayDropTarget.side : 'before',
                    ),
                  );
                  setArrayDropTarget(undefined);
                }}
              >
                <span
                  className={styles.structuredItemLabel}
                  draggable
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setArrayDropTarget(undefined);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      ARRAY_REORDER_MIME,
                      JSON.stringify({ ownerId: arrayOwnerId, index }),
                    );
                  }}
                  onDragEnd={() => setArrayDropTarget(undefined)}
                >
                  [{index}]
                </span>
                <StructuredJsonFields
                  type={type.elementType}
                  value={item}
                  engineTypes={engineTypes}
                  characters={characters}
                  assets={assets}
                  depth={depth + 1}
                  onChange={(next) => {
                    const updated = [...items];
                    updated[index] = next;
                    onChange(updated);
                  }}
                />
                {diagnostics
                  .filter((item) => item.path.startsWith(`$[${index}]`))
                  .map((item) => (
                    <small
                      className={styles.structuredFieldError}
                      key={`${item.path}:${item.message}`}
                    >
                      {item.message}
                    </small>
                  ))}
                <span className={styles.structuredArrayActions}>
                  <button
                    type="button"
                    title="Insert Above"
                    aria-label={`Insert item above ${index}`}
                    onClick={() => {
                      const updated = [...items];
                      updated.splice(
                        index,
                        0,
                        defaultForEngineFieldType(type.elementType, engineTypes),
                      );
                      onChange(updated);
                    }}
                  >
                    +↑
                  </button>
                  <button
                    type="button"
                    title="Insert Below"
                    aria-label={`Insert item below ${index}`}
                    onClick={() => {
                      const updated = [...items];
                      updated.splice(
                        index + 1,
                        0,
                        defaultForEngineFieldType(type.elementType, engineTypes),
                      );
                      onChange(updated);
                    }}
                  >
                    +↓
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    aria-label={'Delete Array element ' + index}
                    onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    −
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </details>
    );
  }
  if (type.kind === 'map') {
    const record =
      !Array.isArray(value) && typeof value === 'object' && value !== null
        ? ({ ...value } as Record<string, RuntimeValue>)
        : {};
    const keys = Object.keys(record);
    const matchingKeys = keys.filter((key) =>
      collectionValueMatches(collectionQuery, key, record[key]!, characters, assets),
    );
    const visibleKeys = matchingKeys.slice(0, collectionLimit);
    const nextKey = (() => {
      if (type.keyType.kind === 'enum') {
        return type.keyType.values.find((candidate) => !keys.includes(candidate));
      }
      if (type.keyType.kind === 'number') {
        let index = 0;
        while (keys.includes(String(index))) index += 1;
        return String(index);
      }
      if (type.keyType.kind === 'character-ref') {
        return characters.find((character) => !keys.includes(character.id))?.id;
      }
      if (type.keyType.kind === 'asset-ref') {
        return assets.find((asset) => !keys.includes(asset.id))?.id;
      }
      let index = keys.length + 1;
      let candidate = `key${index}`;
      while (keys.includes(candidate)) candidate = `key${++index}`;
      return candidate;
    })();
    return (
      <details className={styles.structuredTreeGroup} open>
        <summary>
          <span>
            Entries · {keys.length}
            {diagnostics.length > 0 && (
              <em className={styles.structuredErrorBadge}>{diagnostics.length}</em>
            )}
          </span>
          <button
            type="button"
            aria-label="Add Map entry"
            title="Add Entry"
            disabled={!nextKey}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!nextKey) return;
              onChange({
                ...record,
                [nextKey]: defaultForEngineFieldType(type.valueType, engineTypes),
              });
              setCollectionQuery('');
              setCollectionLimit(keys.length + 1);
            }}
          >
            +
          </button>
          <ConfirmDeleteButton
            title="Clear all Map entries?"
            message="Every key and value in this Map will be removed."
            ariaLabel="Clear all Map entries"
            buttonText={<TrashIcon />}
            buttonTitle="Clear All"
            confirmText="Clear All"
            disabled={keys.length === 0}
            onConfirm={() => onChange({})}
          />
        </summary>
        <div className={styles.structuredMap}>
          <CollectionWindowControls
            noun="entries"
            total={keys.length}
            matched={matchingKeys.length}
            visible={visibleKeys.length}
            query={collectionQuery}
            onQueryChange={(query) => {
              setCollectionQuery(query);
              setCollectionLimit(COLLECTION_WINDOW_SIZE);
            }}
            onShowMore={() => setCollectionLimit((current) => current + COLLECTION_WINDOW_SIZE)}
          />
          {keys.length === 0 && (
            <div className={styles.structuredEmpty}>No entries. Use + to add the first entry.</div>
          )}
          {visibleKeys.map((key) => (
            <div
              className={`${styles.structuredMapItem} ${styles.structuredMapEntry} ${
                mapDropTarget?.key === key ? styles.structuredMapDropTarget : ''
              }`}
              data-drop-side={mapDropTarget?.key === key ? mapDropTarget.side : undefined}
              key={key}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(MAP_REORDER_MIME)) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setMapDropTarget({
                  key,
                  side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                });
              }}
              onDrop={(event) => {
                const fromKey = readMapDragKey(
                  event.dataTransfer.getData(MAP_REORDER_MIME),
                  mapOwnerId,
                );
                if (!fromKey) return;
                event.preventDefault();
                event.stopPropagation();
                onChange(
                  reorderMapEntries(
                    record,
                    fromKey,
                    key,
                    mapDropTarget?.key === key ? mapDropTarget.side : 'before',
                  ),
                );
                setMapDropTarget(undefined);
              }}
            >
              <span
                className={styles.mapDragHandle}
                draggable
                title="Drag to reorder"
                onDragStart={(event) => {
                  event.stopPropagation();
                  setMapDropTarget(undefined);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(
                    MAP_REORDER_MIME,
                    JSON.stringify({ ownerId: mapOwnerId, key }),
                  );
                }}
                onDragEnd={() => setMapDropTarget(undefined)}
              >
                ⠿
              </span>
              <MapKeyInput
                value={key}
                type={type.keyType}
                usedKeys={keys}
                characters={characters}
                assets={assets}
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
                depth={depth + 1}
                onChange={(next) => onChange({ ...record, [key]: next })}
              />
              {diagnostics
                .filter((item) => item.path.startsWith(`$.${key}`))
                .map((item) => (
                  <small
                    className={styles.structuredFieldError}
                    key={`${item.path}:${item.message}`}
                  >
                    {item.message}
                  </small>
                ))}
              <button
                type="button"
                title="Delete"
                aria-label={'Delete Map entry ' + key}
                onClick={() =>
                  onChange(
                    Object.fromEntries(
                      Object.entries(record).filter(([candidate]) => candidate !== key),
                    ),
                  )
                }
              >
                −
              </button>
            </div>
          ))}
        </div>
      </details>
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
    <details className={styles.structuredTreeGroup} open>
      <summary>
        <span>
          {definition?.displayName ?? type.typeName}
          {diagnostics.length > 0 && (
            <em className={styles.structuredErrorBadge}>{diagnostics.length}</em>
          )}
        </span>
      </summary>
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
              depth={depth + 1}
              nullable={field.nullable === true}
              onChange={(next) => onChange({ ...record, [field.name]: next })}
            />
            {diagnostics
              .filter((item) => item.path.startsWith(`$.${field.name}`))
              .map((item) => (
                <small className={styles.structuredFieldError} key={`${item.path}:${item.message}`}>
                  {item.message}
                </small>
              ))}
          </label>
        ))}
        {!definition && (
          <small className={styles.warning}>Missing Engine Type {type.typeName}</small>
        )}
      </div>
    </details>
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
  const { characters, assets, saveAllStories } = useStoryGraphStore();
  const visibleValue = stripEngineObjectTypeMarkers(value);
  const canonical = JSON.stringify(visibleValue, null, 2);
  const [draft, setDraft] = useState(canonical);
  const [error, setError] = useState<string>();
  const [raw, setRaw] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'pasting'>('idle');
  const structuredEditorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setDraft(canonical);
    setError(undefined);
  }, [canonical]);
  const expectedType =
    fieldType ?? (schema ? { kind: 'object' as const, typeName: schema.name } : undefined);
  const usesComplexEditor =
    expectedType?.kind === 'object' ||
    expectedType?.kind === 'array' ||
    expectedType?.kind === 'map' ||
    expectedType?.kind === 'any';
  const restoreParsedValue = (parsed: unknown): RuntimeValue =>
    restoreEngineObjectMarkers(parsed as RuntimeValue, value, expectedType, engineTypes);
  const validateParsedValue = (parsed: unknown): string | undefined => {
    if (containsEngineObjectMarker(parsed as RuntimeValue)) {
      return '$storyBlueprintType is reserved editor metadata and must not appear in authored JSON.';
    }
    const runtimeValue = restoreParsedValue(parsed);
    const markerError = validateMarkedEngineObjects(runtimeValue, engineTypes);
    if (markerError) return markerError;
    if (
      expectedType &&
      !(runtimeValue === null && nullable) &&
      !engineValueMatchesFieldType(runtimeValue, expectedType, engineTypes)
    ) {
      return 'Value does not match the Engine Type Schema.';
    }
    return undefined;
  };
  const commit = () => {
    try {
      const parsed = JSON.parse(draft) as RuntimeValue;
      const validationError = validateParsedValue(parsed);
      if (validationError) throw new Error(validationError);
      onCommit(restoreParsedValue(parsed));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
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
      const validationError = validateParsedValue(parsed);
      if (validationError) throw new Error(validationError);
      onCommit(restoreParsedValue(parsed));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPasteStatus('idle');
    }
  };
  const formatDraft = () => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      const validationError = validateParsedValue(parsed);
      if (validationError) throw new Error(validationError);
      setDraft(JSON.stringify(parsed, null, 2));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <>
      {usesComplexEditor && (
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
          {raw && (
            <button type="button" className={styles.rawToggle} onClick={formatDraft}>
              Format JSON
            </button>
          )}
          {!raw && (
            <>
              <button
                type="button"
                className={styles.rawToggle}
                onClick={() =>
                  structuredEditorRef.current
                    ?.querySelectorAll('details')
                    .forEach((details) => details.removeAttribute('open'))
                }
              >
                Collapse All
              </button>
              <button
                type="button"
                className={styles.rawToggle}
                onClick={() =>
                  structuredEditorRef.current
                    ?.querySelectorAll('details')
                    .forEach((details) => details.setAttribute('open', ''))
                }
              >
                Expand All
              </button>
            </>
          )}
        </div>
      )}
      {(schema || fieldType) && !raw ? (
        usesComplexEditor ? (
          <div ref={structuredEditorRef} className={styles.jsonStructuredEditor}>
            <StructuredJsonFields
              type={fieldType ?? { kind: 'object', typeName: schema!.name }}
              value={value}
              engineTypes={engineTypes}
              characters={characters}
              assets={assets}
              nullable={nullable}
              onChange={onCommit}
            />
          </div>
        ) : (
          <StructuredJsonFields
            type={fieldType ?? { kind: 'object', typeName: schema!.name }}
            value={value}
            engineTypes={engineTypes}
            characters={characters}
            assets={assets}
            nullable={nullable}
            onChange={onCommit}
          />
        )
      ) : (
        <div className={styles.jsonRawEditor}>
          <Suspense fallback={<div className={styles.jsonEditorLoading}>Loading JSON editor…</div>}>
            <JsonMonacoEditor
              value={draft}
              onChange={setDraft}
              onCommit={commit}
              onRevert={() => {
                setDraft(canonical);
                setError(undefined);
              }}
              onDiagnostic={setError}
              validateValue={validateParsedValue}
              onSave={() => void saveAllStories()}
            />
          </Suspense>
        </div>
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
  typeOptions,
  defaultType,
}: {
  title: string;
  placeholder?: string;
  existingNames: readonly string[];
  onCreate: (name: string, type?: string) => void;
  buttonLabel?: string;
  typeOptions?: readonly { value: string; label: string }[];
  defaultType?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectedType, setSelectedType] = useState(defaultType ?? typeOptions?.[0]?.value ?? '');
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!creating) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [creating]);
  const duplicate = existingNames.includes(draft);
  const validFormat = /^[A-Za-z_][A-Za-z0-9_]*$/.test(draft);
  const valid = validFormat && !duplicate;
  const confirm = () => {
    if (!valid) return;
    onCreate(draft, selectedType || undefined);
    setDraft('');
    setCreating(false);
  };
  return (
    <>
      <button
        type="button"
        title={title}
        onClick={() => {
          setSelectedType(defaultType ?? typeOptions?.[0]?.value ?? '');
          setCreating(true);
        }}
      >
        {buttonLabel}
      </button>
      {creating &&
        createPortal(
          <div
            className={styles.namedCreateBackdrop}
            role="presentation"
            onPointerDown={(event) => {
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
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div id="named-create-title" className={styles.namedCreateTitle}>
                {title}
              </div>
              <label>
                <span>Name</span>
                <input
                  ref={nameInputRef}
                  value={draft}
                  placeholder={placeholder}
                  aria-label={title}
                  onChange={(event) => setDraft(event.target.value)}
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
              {typeOptions && typeOptions.length > 0 && (
                <label>
                  <span>Type</span>
                  <select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value)}
                  >
                    {typeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
  const [action, setAction] = useState<'replace' | 'clear'>('replace');
  const [replacementId, setReplacementId] = useState(options[0]?.id ?? '');
  const [preview, setPreview] = useState<{
    count: number;
    blocked: number;
    locations: readonly string[];
    blockedLocations: readonly string[];
  }>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!options.some((option) => option.id === replacementId)) {
      setReplacementId(options[0]?.id ?? '');
    }
    if (options.length === 0 && action === 'replace') setAction('clear');
  }, [action, options, replacementId]);
  const close = () => {
    setOpen(false);
    setPreview(undefined);
  };
  return (
    <>
      <button type="button" className={styles.secondaryButton} onClick={() => setOpen(true)}>
        Manage References…
      </button>
      {open &&
        createPortal(
          <div className={styles.namedCreateBackdrop} role="presentation">
            <div className={styles.schemaMigrationDialog} role="dialog" aria-modal="true">
              <div className={styles.detailsTitle}>Manage references to {sourceLabel}</div>
              <label>
                <span>Action</span>
                <select
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as 'replace' | 'clear');
                    setPreview(undefined);
                  }}
                >
                  <option value="replace" disabled={options.length === 0}>
                    Replace with another {kind}
                  </option>
                  <option value="clear">Clear safe references</option>
                </select>
              </label>
              {action === 'replace' && (
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
              )}
              {preview ? (
                <>
                  <p>
                    {preview.count} reference(s) will be{' '}
                    {action === 'clear' ? 'cleared' : 'replaced'}.
                  </p>
                  <div className={styles.schemaMigrationLocations}>
                    {preview.locations.map((location, index) => (
                      <div key={`${location}:${index}`}>{location}</div>
                    ))}
                  </div>
                  {preview.blocked > 0 && (
                    <>
                      <p>
                        {preview.blocked} required reference(s) cannot be cleared and will remain
                        unchanged.
                      </p>
                      <div className={styles.schemaMigrationLocations}>
                        {preview.blockedLocations.map((location, index) => (
                          <div key={`${location}:blocked:${index}`}>{location}</div>
                        ))}
                      </div>
                    </>
                  )}
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
                    disabled={loading || (action === 'replace' && !replacementId)}
                    onClick={() => {
                      setLoading(true);
                      void replaceProjectResourceReferences(
                        kind,
                        sourceId,
                        action,
                        action === 'replace' ? replacementId : undefined,
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
                        action,
                        action === 'replace' ? replacementId : undefined,
                        false,
                      ).then((result) => {
                        setLoading(false);
                        if (result) close();
                      });
                    }}
                  >
                    {loading
                      ? 'Applying…'
                      : action === 'clear'
                        ? 'Clear Safe References'
                        : 'Replace All'}
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

function DeleteResourceButton({
  kind,
  sourceId,
  sourceLabel,
  options,
  referenceCount,
  resourcePath,
}: {
  kind: 'character' | 'asset';
  sourceId: string;
  sourceLabel: string;
  options: readonly { id: string; label: string }[];
  referenceCount: number;
  resourcePath: string;
}) {
  const { replaceProjectResourceReferences } = useStoryGraphStore();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<'replace' | 'clear'>(options.length ? 'replace' : 'clear');
  const [replacementId, setReplacementId] = useState(options[0]?.id ?? '');
  const [preview, setPreview] = useState<{
    count: number;
    blocked: number;
    locations: readonly string[];
    blockedLocations: readonly string[];
  }>();
  const [loading, setLoading] = useState(false);
  const close = () => {
    setOpen(false);
    setPreview(undefined);
  };
  const scan = async () => {
    setLoading(true);
    const result = await replaceProjectResourceReferences(
      kind,
      sourceId,
      action,
      action === 'replace' ? replacementId : undefined,
      true,
    );
    if (result) setPreview(result);
    setLoading(false);
  };
  const applyAndDelete = async () => {
    if (!preview || (action === 'clear' && preview.blocked > 0)) return;
    setLoading(true);
    const result = await replaceProjectResourceReferences(
      kind,
      sourceId,
      action,
      action === 'replace' ? replacementId : undefined,
      false,
      resourcePath,
    );
    if (!result) {
      setLoading(false);
      return;
    }
    close();
  };
  return (
    <>
      <button
        className={styles.dangerButton}
        type="button"
        onClick={() => {
          if (referenceCount === 0) {
            if (!window.confirm(`Delete ${kind} ${sourceLabel}? This cannot be undone.`)) return;
            setLoading(true);
            void replaceProjectResourceReferences(
              kind,
              sourceId,
              'clear',
              undefined,
              false,
              resourcePath,
            ).then(() => setLoading(false));
            return;
          }
          setOpen(true);
        }}
      >
        Delete {kind === 'character' ? 'Character' : 'Asset'}
      </button>
      {open &&
        createPortal(
          <div className={styles.namedCreateBackdrop} role="presentation">
            <div className={styles.schemaMigrationDialog} role="dialog" aria-modal="true">
              <div className={styles.detailsTitle}>Delete {sourceLabel}</div>
              <p>{referenceCount} indexed reference(s) must be handled before deletion.</p>
              <label>
                <span>Reference handling</span>
                <select
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as 'replace' | 'clear');
                    setPreview(undefined);
                  }}
                >
                  <option value="replace" disabled={!options.length}>
                    Replace, then delete
                  </option>
                  <option value="clear">Clear safe references, then delete</option>
                </select>
              </label>
              {action === 'replace' && (
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
              )}
              {preview ? (
                <>
                  <p>{preview.count} reference(s) can be handled.</p>
                  <div className={styles.schemaMigrationLocations}>
                    {preview.locations.map((location, index) => (
                      <div key={`${location}:${index}`}>{location}</div>
                    ))}
                  </div>
                  {preview.blocked > 0 && (
                    <>
                      <p>{preview.blocked} required reference(s) block deletion.</p>
                      <div className={styles.schemaMigrationLocations}>
                        {preview.blockedLocations.map((location, index) => (
                          <div key={`${location}:blocked:${index}`}>{location}</div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p>Preview the complete project before deleting anything.</p>
              )}
              <div className={styles.schemaMigrationActions}>
                <button type="button" disabled={loading} onClick={close}>
                  Cancel
                </button>
                {!preview ? (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={loading || (action === 'replace' && !replacementId)}
                    onClick={() => void scan()}
                  >
                    {loading ? 'Scanning…' : 'Preview'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={loading || (action === 'clear' && preview.blocked > 0)}
                    onClick={() => void applyAndDelete()}
                  >
                    {loading
                      ? 'Applying…'
                      : action === 'replace'
                        ? 'Replace and Delete'
                        : 'Clear and Delete'}
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
  const kind = variable.valueType.kind as VariableEditableKind;
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
            const nextKind = event.target.value as VariableEditableKind;
            const nextEngineTypeName =
              nextKind === 'json' ? (engineTypes[0]?.name ?? addEngineType()) : undefined;
            if (nextKind === 'json' && !nextEngineTypeName) return;
            updateVariable(variable.id, {
              valueType:
                nextKind === 'json'
                  ? { kind: 'json', name: nextEngineTypeName! }
                  : nextKind === 'array'
                    ? { kind: 'array', elementType: { kind: 'any' } }
                    : nextKind === 'map'
                      ? { kind: 'map', keyType: 'string', valueType: { kind: 'any' } }
                      : ({ kind: nextKind } as ValueType),
              defaultValue:
                nextKind === 'json'
                  ? defaultForEngineFieldType(
                      { kind: 'object', typeName: nextEngineTypeName! },
                      engineTypes,
                    )
                  : nextKind === 'array'
                    ? []
                    : nextKind === 'map'
                      ? {}
                      : defaultForType(nextKind),
            });
          }}
        >
          <option value="boolean">Boolean</option>
          <option value="number">Number</option>
          <option value="string">String</option>
          <option value="array">Array</option>
          <option value="map">Map / Dictionary</option>
          <option value="json">Engine JSON</option>
        </select>
      </label>
      {variable.valueType.kind === 'array' && (
        <label>
          <span>Element Type</span>
          <select
            disabled={projectIndexUnavailable || references.length > 0}
            value={containerTypeSelection(variable.valueType.elementType)}
            onChange={(event) =>
              updateVariable(variable.id, {
                valueType: {
                  kind: 'array',
                  elementType: containerValueType(event.target.value),
                },
                defaultValue: [],
              })
            }
          >
            <option value="any">Any JSON</option>
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
            {engineTypes.map((item) => (
              <option value={`json:${item.name}`} key={item.id}>
                Object · {item.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {variable.valueType.kind === 'map' && (
        <>
          <label>
            <span>Key Type</span>
            <select
              disabled={projectIndexUnavailable || references.length > 0}
              value={variable.valueType.keyType ?? 'string'}
              onChange={(event) =>
                updateVariable(variable.id, {
                  valueType: {
                    kind: 'map',
                    keyType: event.target.value as NonNullable<
                      Extract<ValueType, { kind: 'map' }>['keyType']
                    >,
                    valueType:
                      variable.valueType.kind === 'map' ? variable.valueType.valueType : undefined,
                  },
                  defaultValue: {},
                })
              }
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="character-ref">Character Reference</option>
              <option value="asset-ref">Asset Reference</option>
            </select>
          </label>
          <label>
            <span>Value Type</span>
            <select
              disabled={projectIndexUnavailable || references.length > 0}
              value={containerTypeSelection(variable.valueType.valueType)}
              onChange={(event) =>
                updateVariable(variable.id, {
                  valueType: {
                    kind: 'map',
                    keyType:
                      variable.valueType.kind === 'map' ? variable.valueType.keyType : 'string',
                    valueType: containerValueType(event.target.value),
                  },
                  defaultValue: {},
                })
              }
            >
              <option value="any">Any JSON</option>
              <option value="boolean">Boolean</option>
              <option value="number">Number</option>
              <option value="string">String</option>
              {engineTypes.map((item) => (
                <option value={`json:${item.name}`} key={item.id}>
                  Object · {item.displayName}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
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
      <div className={styles.fieldGroup}>
        <span>Default</span>
        {kind === 'json' || kind === 'array' || kind === 'map' ? (
          <JsonValueInput
            value={variable.defaultValue}
            schema={engineTypes.find((item) => item.name === engineTypeName(variable.valueType))}
            fieldType={
              kind === 'array'
                ? {
                    kind: 'array',
                    elementType: valueTypeToEngineFieldType(
                      variable.valueType.kind === 'array'
                        ? variable.valueType.elementType
                        : undefined,
                    ),
                  }
                : kind === 'map'
                  ? {
                      kind: 'map',
                      keyType: {
                        kind:
                          variable.valueType.kind === 'map'
                            ? (variable.valueType.keyType ?? 'string')
                            : 'string',
                      },
                      valueType: valueTypeToEngineFieldType(
                        variable.valueType.kind === 'map'
                          ? variable.valueType.valueType
                          : undefined,
                      ),
                    }
                  : undefined
            }
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
      </div>
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
  const addField = (name: string, requestedKind?: string) => {
    const kind = (requestedKind ?? 'string') as EditableKind;
    updateCharacter(character.id, {
      fields: [
        ...fields,
        {
          id: createStableId('variable'),
          name,
          displayName: name,
          scope: 'character',
          valueType:
            kind === 'json'
              ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
              : { kind },
          defaultValue: kind === 'json' ? {} : defaultForType(kind),
        },
      ],
    });
  };
  return (
    <div
      className={styles.details}
      onKeyDown={stopInspectorEvent}
      onKeyUp={stopInspectorEvent}
      onPointerDown={stopInspectorEvent}
      onMouseDown={stopInspectorEvent}
      onWheel={stopInspectorEvent}
    >
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
          defaultType="string"
          typeOptions={[
            { value: 'boolean', label: 'Boolean' },
            { value: 'number', label: 'Number' },
            { value: 'string', label: 'String' },
            ...(engineTypes.length > 0 ? [{ value: 'json', label: 'Engine JSON' }] : []),
          ]}
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
                <div className={styles.fieldGroup}>
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
                </div>
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
          Deleting this character requires replacing or safely clearing these references.
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
        {workspace?.project && resourcePath ? (
          <DeleteResourceButton
            kind="character"
            sourceId={character.id}
            sourceLabel={character.displayName}
            options={characters
              .filter((candidate) => candidate.id !== character.id)
              .map((candidate) => ({ id: candidate.id, label: candidate.displayName }))}
            referenceCount={references.length}
            resourcePath={resourcePath}
          />
        ) : (
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => removeCharacter(character.id)}
          >
            Delete Character
          </button>
        )}
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
        <option value="character-ref">Character Reference</option>
        <option value="asset-ref">Asset Reference</option>
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

function engineFieldTypeForKind(
  kind: EngineFieldType['kind'],
  engineTypes: readonly EngineTypeDefinition[],
  ownerName: string,
): EngineFieldType {
  if (kind === 'enum') return { kind: 'enum', values: ['Value'] };
  if (kind === 'object') {
    return {
      kind: 'object',
      typeName:
        engineTypes.find(
          (item) =>
            item.name !== ownerName && !engineTypeReferencesName(item.name, ownerName, engineTypes),
        )?.name ?? ownerName,
    };
  }
  if (kind === 'array') return { kind: 'array', elementType: { kind: 'string' } };
  if (kind === 'map') {
    return { kind: 'map', keyType: { kind: 'string' }, valueType: { kind: 'string' } };
  }
  return { kind };
}

function engineTypeReferencesName(
  sourceName: string,
  targetName: string,
  engineTypes: readonly EngineTypeDefinition[],
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (sourceName === targetName) return true;
  if (visited.has(sourceName)) return false;
  const source = engineTypes.find((item) => item.name === sourceName);
  if (!source) return false;
  const nextVisited = new Set(visited).add(sourceName);
  const referencedNames = (type: EngineFieldType): readonly string[] =>
    type.kind === 'object'
      ? [type.typeName]
      : type.kind === 'array'
        ? referencedNames(type.elementType)
        : type.kind === 'map'
          ? referencedNames(type.valueType)
          : [];
  return source.fields.some((field) =>
    referencedNames(field.type).some((name) =>
      engineTypeReferencesName(name, targetName, engineTypes, nextVisited),
    ),
  );
}

function EngineFieldTypeEditor({
  value,
  engineTypes,
  ownerName,
  onChange,
  depth = 0,
  allowAny = false,
}: {
  value: EngineFieldType;
  engineTypes: readonly EngineTypeDefinition[];
  ownerName: string;
  onChange: (value: EngineFieldType) => void;
  depth?: number;
  allowAny?: boolean;
}) {
  const kind = value.kind;
  const changeKind = (nextKind: EngineFieldType['kind']) =>
    onChange(engineFieldTypeForKind(nextKind, engineTypes, ownerName));
  return (
    <div className={styles.engineFieldType}>
      <select
        value={kind}
        onChange={(event) => changeKind(event.target.value as EngineFieldType['kind'])}
      >
        {allowAny && <option value="any">Any JSON</option>}
        <option value="boolean">Boolean</option>
        <option value="number">Number</option>
        <option value="string">String</option>
        <option value="character-ref">Character Reference</option>
        <option value="asset-ref">Asset Reference</option>
        <option value="enum">Enum</option>
        <option
          value="object"
          disabled={
            !engineTypes.some(
              (item) =>
                item.name !== ownerName &&
                !engineTypeReferencesName(item.name, ownerName, engineTypes),
            )
          }
        >
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
            .filter((item) => !engineTypeReferencesName(item.name, ownerName, engineTypes))
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
            allowAny
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
      nullable: type.kind === 'character-ref' || type.kind === 'asset-ref' ? true : field.nullable,
      defaultValue: defaultForEngineFieldType(type, engineTypes),
    });
  };
  const addField = (name: string, requestedKind?: string) => {
    const type = requestedKind?.startsWith('object:')
      ? ({ kind: 'object', typeName: requestedKind.slice(7) } as const)
      : engineFieldTypeForKind(
          (requestedKind ?? 'string') as EngineFieldType['kind'],
          engineTypes,
          definition.name,
        );
    update({
      ...definition,
      fields: [
        ...definition.fields,
        {
          id: createStableId('engineField'),
          name,
          displayName: name,
          type,
          nullable: type.kind === 'character-ref' || type.kind === 'asset-ref' ? true : undefined,
          defaultValue: defaultForEngineFieldType(type, engineTypes),
        },
      ],
    });
  };
  return (
    <>
      <div
        className={styles.details}
        onKeyDown={stopInspectorEvent}
        onKeyUp={stopInspectorEvent}
        onPointerDown={stopInspectorEvent}
        onMouseDown={stopInspectorEvent}
        onWheel={stopInspectorEvent}
      >
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
            defaultType="string"
            typeOptions={[
              { value: 'boolean', label: 'Boolean' },
              { value: 'number', label: 'Number' },
              { value: 'string', label: 'String' },
              { value: 'character-ref', label: 'Character Reference' },
              { value: 'asset-ref', label: 'Asset Reference' },
              { value: 'enum', label: 'Enum' },
              ...engineTypes
                .filter((item) => item.name !== definition.name)
                .filter(
                  (item) => !engineTypeReferencesName(item.name, definition.name, engineTypes),
                )
                .map((item) => ({
                  value: `object:${item.name}`,
                  label: `Object · ${item.displayName}`,
                })),
              { value: 'array', label: 'Array' },
              { value: 'map', label: 'Map / Dictionary' },
            ]}
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
                  disabled={field.type.kind === 'character-ref' || field.type.kind === 'asset-ref'}
                  checked={field.nullable ?? false}
                  onChange={(event) =>
                    updateField(index, { ...field, nullable: event.target.checked || undefined })
                  }
                />
                <span>Nullable</span>
              </label>
              <div className={styles.fieldGroup}>
                <span>Default</span>
                <JsonValueInput
                  value={field.defaultValue}
                  engineTypes={engineTypes}
                  fieldType={field.type}
                  nullable={field.nullable}
                  onCommit={(defaultValue) => updateField(index, { ...field, defaultValue })}
                />
              </div>
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
            <div className={styles.schemaMigrationPlan}>
              <strong>Migration plan</strong>
              {engineTypeMigrationPreview.actions.map((action) => (
                <div
                  className={
                    action.kind === 'discard' || action.kind === 'reset'
                      ? styles.schemaMigrationDestructive
                      : undefined
                  }
                  key={`${action.kind}:${action.field}`}
                >
                  <span>{action.kind}</span>
                  <code>{action.field}</code>
                  <small>{action.detail}</small>
                </div>
              ))}
            </div>
            {engineTypeMigrationPreview.affectedLocations.length > 0 && (
              <div className={styles.schemaMigrationLocations}>
                {engineTypeMigrationPreview.affectedLocations.map((location) => (
                  <div key={location}>{location}</div>
                ))}
              </div>
            )}
            <div className={styles.schemaMigrationActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={confirmEngineTypeMigration}
              >
                Migrate
              </button>
              <button type="button" onClick={cancelEngineTypeMigration}>
                Cancel
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
    <div
      className={styles.details}
      onKeyDown={stopInspectorEvent}
      onKeyUp={stopInspectorEvent}
      onPointerDown={stopInspectorEvent}
      onMouseDown={stopInspectorEvent}
      onWheel={stopInspectorEvent}
    >
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
          Deleting this asset requires replacing or safely clearing these references.
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
        {workspace?.project && resourcePath ? (
          <DeleteResourceButton
            kind="asset"
            sourceId={asset.id}
            sourceLabel={asset.displayName}
            options={assets
              .filter((candidate) => candidate.id !== asset.id && candidate.kind === asset.kind)
              .map((candidate) => ({ id: candidate.id, label: candidate.displayName }))}
            referenceCount={references.length}
            resourcePath={resourcePath}
          />
        ) : (
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => removeAsset(asset.id)}
          >
            Delete Asset
          </button>
        )}
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
    <div
      className={styles.details}
      onKeyDown={stopInspectorEvent}
      onKeyUp={stopInspectorEvent}
      onPointerDown={stopInspectorEvent}
      onMouseDown={stopInspectorEvent}
      onWheel={stopInspectorEvent}
    >
      <div className={styles.detailsTitle}>External Function</div>
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
      <div className={styles.parameterHeader}>
        <span>Return Values</span>
        <NamedCreateControl
          title="Add event return value"
          placeholder="Return value name"
          buttonLabel="Add"
          existingNames={(event.outputs ?? []).map((output) => output.name)}
          onCreate={(name) =>
            updateEvent(event.id, {
              outputs: [
                ...(event.outputs ?? []),
                {
                  id: createStableId('eventOutput'),
                  name,
                  displayName: name,
                  valueType: { kind: 'string' },
                },
              ],
            })
          }
        />
      </div>
      {(event.outputs?.length ?? 0) === 0 && <div className={styles.empty}>No return values</div>}
      {(event.outputs ?? []).map((output, index) => (
        <div className={styles.parameterRow} key={output.id}>
          <ScriptNameInput
            value={output.name}
            onCommit={(name) =>
              updateEvent(event.id, {
                outputs: (event.outputs ?? []).map((candidate, candidateIndex) =>
                  candidateIndex === index ? { ...candidate, name, displayName: name } : candidate,
                ),
              })
            }
          />
          <select
            value={output.valueType.kind}
            onChange={(change) =>
              updateEvent(event.id, {
                outputs: (event.outputs ?? []).map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? {
                        ...candidate,
                        valueType:
                          change.target.value === 'json'
                            ? { kind: 'json', name: engineTypes[0]?.name ?? 'EnginePayload' }
                            : {
                                kind: change.target.value as
                                  'boolean' | 'number' | 'string' | 'array' | 'map',
                              },
                      }
                    : candidate,
                ),
              })
            }
          >
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="array">Array</option>
            <option value="map">Map</option>
            <option value="json">Engine JSON</option>
          </select>
          {output.valueType.kind === 'json' && (
            <select
              value={output.valueType.name}
              onChange={(change) =>
                updateEvent(event.id, {
                  outputs: (event.outputs ?? []).map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, valueType: { kind: 'json', name: change.target.value } }
                      : candidate,
                  ),
                })
              }
            >
              {engineTypes.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            title="Remove return value"
            onClick={() =>
              updateEvent(event.id, {
                outputs: (event.outputs ?? []).filter(
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
        External Functions with return values wait for the engine result before continuing.
      </div>
      <button className={styles.dangerButton} type="button" onClick={() => removeEvent(event.id)}>
        Delete External Function
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
    <div
      className={styles.details}
      onKeyDown={stopInspectorEvent}
      onKeyUp={stopInspectorEvent}
      onPointerDown={stopInspectorEvent}
      onMouseDown={stopInspectorEvent}
      onWheel={stopInspectorEvent}
    >
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
  const outputs = (event.outputs ?? [])
    .map((output) => `${output.name}: ${output.valueType.kind}`)
    .join(', ');
  return `${event.name}(${parameters}): ${outputs ? `{ ${outputs} }` : 'void'}`;
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
    '## External Functions',
    '',
    '| External Function | Stable ID | Description |',
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
          <p>Human-readable External Function and Signal contract for engine programmers.</p>
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
                <th>External Function / Signature</th>
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
  const variableTypeOptions = [
    { value: 'boolean', label: 'Boolean' },
    { value: 'number', label: 'Number' },
    { value: 'string', label: 'String' },
    { value: 'array', label: 'Array · Any JSON items' },
    { value: 'map', label: 'Map · String keys / Any JSON values' },
    ...engineTypes.map((engineType) => ({
      value: `json:${engineType.name}`,
      label: `Engine JSON · ${engineType.displayName}`,
    })),
  ];
  const variableTypeAndDefault = (selection?: string): [ValueType, RuntimeValue] => {
    if (selection === 'boolean') return [{ kind: 'boolean' }, false];
    if (selection === 'number') return [{ kind: 'number' }, 0];
    if (selection === 'array') return [{ kind: 'array', elementType: { kind: 'any' } }, []];
    if (selection === 'map')
      return [{ kind: 'map', keyType: 'string', valueType: { kind: 'any' } }, {}];
    if (selection?.startsWith('json:')) {
      const name = selection.slice(5);
      return [
        { kind: 'json', name },
        defaultForEngineFieldType({ kind: 'object', typeName: name }, engineTypes),
      ];
    }
    return [{ kind: 'string' }, ''];
  };
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
                defaultType="string"
                typeOptions={variableTypeOptions}
                onCreate={(name, selectedType) => {
                  const [valueType, defaultValue] = variableTypeAndDefault(selectedType);
                  selectStoryData({
                    kind: 'variable',
                    id: addVariable(name, valueType, defaultValue),
                  });
                }}
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
                defaultType="string"
                typeOptions={variableTypeOptions}
                onCreate={(name, selectedType) => {
                  const [valueType, defaultValue] = variableTypeAndDefault(selectedType);
                  const id = addProjectVariable(name, valueType, defaultValue);
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
              <span>External Functions</span>
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
                  placeholder="External Function name"
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
