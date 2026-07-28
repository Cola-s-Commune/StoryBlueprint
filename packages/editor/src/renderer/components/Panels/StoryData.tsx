import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterSource,
  EventSource,
  SignalSource,
  AssetId,
  AssetSource,
  RuntimeValue,
  ValueType,
  VariableDefinition,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { writeStoryDataDrag } from '../../graph/storyDataDrag';
import { CopyButton } from './CopyButton';
import panelStyles from './Panel.module.css';
import styles from './StoryData.module.css';

type ScalarKind = 'boolean' | 'number' | 'string';

function defaultForType(kind: ScalarKind): RuntimeValue {
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  return '';
}

function ScriptNameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
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
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
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

function VariableEditor({ variable }: { variable: VariableDefinition }) {
  const { variables, updateVariable, removeVariable } = useStoryGraphStore();
  const duplicate = variables.some(
    (candidate) => candidate.id !== variable.id && candidate.name === variable.name,
  );
  const kind = variable.valueType.kind as ScalarKind;
  return (
    <div className={styles.details}>
      <div className={styles.detailsTitle}>Variable</div>
      <label>
        <span>Name</span>
        <ScriptNameInput
          value={variable.name}
          onCommit={(name) => updateVariable(variable.id, { name, displayName: name })}
        />
      </label>
      {duplicate && <div className={styles.warning}>Name must be unique.</div>}
      <label>
        <span>Display Name</span>
        <input
          value={variable.displayName}
          onChange={(event) => updateVariable(variable.id, { displayName: event.target.value })}
        />
      </label>
      <label>
        <span>Type</span>
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value as ScalarKind;
            updateVariable(variable.id, {
              valueType: { kind: nextKind } as ValueType,
              defaultValue: defaultForType(nextKind),
            });
          }}
        >
          <option value="boolean">Boolean</option>
          <option value="number">Number</option>
          <option value="string">String</option>
        </select>
      </label>
      <label>
        <span>Scope</span>
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
      </label>
      <label>
        <span>Default</span>
        {kind === 'boolean' ? (
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
          <input
            type={kind === 'number' ? 'number' : 'text'}
            value={String(variable.defaultValue ?? '')}
            onChange={(event) =>
              updateVariable(variable.id, {
                defaultValue: kind === 'number' ? Number(event.target.value) : event.target.value,
              })
            }
          />
        )}
      </label>
      <button
        className={styles.dangerButton}
        type="button"
        onClick={() => {
          if (window.confirm(`Delete variable ${variable.name}?`)) removeVariable(variable.id);
        }}
      >
        Delete Variable
      </button>
    </div>
  );
}

function CharacterEditor({ character }: { character: CharacterSource }) {
  const { characters, assets, workspace, updateCharacter, removeCharacter, revealWorkspaceItem } =
    useStoryGraphStore();
  const resourcePath = workspace?.characterResources.find(
    (candidate) => candidate.character.id === character.id,
  )?.relativePath;
  const duplicate = characters.some(
    (candidate) => candidate.id !== character.id && candidate.name === character.name,
  );
  const emotions = Object.keys(character.emotions).join(', ');
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
        <input
          value={character.displayName}
          onChange={(event) => updateCharacter(character.id, { displayName: event.target.value })}
        />
      </label>
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
          {assets
            .filter((asset) => asset.kind === 'portrait')
            .map((asset) => (
              <option value={asset.id} key={asset.id}>
                {asset.displayName}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>Emotions</span>
        <input
          value={emotions}
          placeholder="neutral, happy, angry"
          onChange={(event) => {
            const keys = event.target.value
              .split(',')
              .map((key) => key.trim())
              .filter(Boolean);
            updateCharacter(character.id, {
              emotions: Object.fromEntries(
                keys.map((key) => [
                  key,
                  character.emotions[key] ?? { displayName: key[0]?.toUpperCase() + key.slice(1) },
                ]),
              ),
            });
          }}
        />
      </label>
      <div className={styles.detailActions}>
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
          onClick={() => removeCharacter(character.id)}
        >
          Delete Character
        </button>
      </div>
    </div>
  );
}

function AssetEditor({ asset }: { asset: AssetSource }) {
  const { assets, workspace, updateAsset, removeAsset, revealWorkspaceItem } = useStoryGraphStore();
  const resourcePath = workspace?.assetResources.find(
    (candidate) => candidate.asset.id === asset.id,
  )?.relativePath;
  const duplicate = assets.some(
    (candidate) => candidate.id !== asset.id && candidate.name === asset.name,
  );
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
        <input
          value={asset.displayName}
          onChange={(event) => updateAsset(asset.id, { displayName: event.target.value })}
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
      <label>
        <span>Locale Paths</span>
        <textarea
          rows={4}
          value={Object.entries(asset.locales ?? {})
            .map(([locale, path]) => `${locale}=${path}`)
            .join('\n')}
          placeholder={'default=Audio/voice.wav\nzh-CN=Audio/voice.zh-CN.wav'}
          onChange={(event) => {
            const locales = Object.fromEntries(
              event.target.value
                .split('\n')
                .map((line) => line.split('='))
                .filter((parts) => parts.length >= 2 && parts[0].trim())
                .map(([locale, ...path]) => [locale.trim(), path.join('=').trim()]),
            );
            updateAsset(asset.id, { locales });
          }}
        />
      </label>
      <div className={styles.detailActions}>
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
  const { events, updateEvent, removeEvent } = useStoryGraphStore();
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
        <input
          value={event.displayName}
          onChange={(change) => updateEvent(event.id, { displayName: change.target.value })}
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows={4}
          value={event.description ?? ''}
          placeholder="Explain when this event is called and what the engine handler should do."
          onChange={(change) =>
            updateEvent(event.id, { description: change.target.value || undefined })
          }
        />
      </label>
      <div className={styles.parameterHeader}>
        <span>Parameters</span>
        <button
          type="button"
          onClick={() => {
            const used = new Set(event.parameters.map((parameter) => parameter.name));
            let index = event.parameters.length + 1;
            let name = `argument${index}`;
            while (used.has(name)) name = `argument${++index}`;
            updateEvent(event.id, {
              parameters: [...event.parameters, { name, valueType: { kind: 'string' } }],
            });
          }}
        >
          Add
        </button>
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
                    ? { ...candidate, valueType: { kind: change.target.value as ScalarKind } }
                    : candidate,
                ),
              })
            }
          >
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="string">String</option>
          </select>
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
  const { signals, updateSignal, removeSignal } = useStoryGraphStore();
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
        <input
          value={signal.displayName}
          onChange={(change) => updateSignal(signal.id, { displayName: change.target.value })}
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows={4}
          value={signal.description ?? ''}
          placeholder="Explain when the engine sends this signal."
          onChange={(change) =>
            updateSignal(signal.id, { description: change.target.value || undefined })
          }
        />
      </label>
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
        `| \`${markdownCell(signal.name)}\` | \`${signal.id}\` | ${markdownCell(signal.description ?? '')} |`,
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
                    <code>{signal.name}</code>
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
  const { storyDataSelection, variables, characters, assets, events, signals } =
    useStoryGraphStore();
  if (!storyDataSelection) return null;
  if (storyDataSelection.kind === 'event-table')
    return <EventTable events={events} signals={signals} />;
  if (storyDataSelection.kind === 'variable') {
    const variable = variables.find((item) => item.id === storyDataSelection.id);
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
  const asset = assets.find((item) => item.id === storyDataSelection.id);
  return asset ? <AssetEditor asset={asset} /> : null;
}

export function StoryData() {
  const {
    hasActiveStory,
    workspace,
    variables,
    characters,
    assets,
    events,
    signals,
    addVariable,
    addCharacter,
    addAsset,
    addEvent,
    addSignal,
    storyDataSelection,
    selectStoryData,
  } = useStoryGraphStore();
  const [resourceSearch, setResourceSearch] = useState('');
  const filteredCharacters = useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    return query
      ? characters.filter((item) =>
          `${item.name} ${item.displayName}`.toLowerCase().includes(query),
        )
      : characters;
  }, [characters, resourceSearch]);
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
          `${item.name} ${item.displayName} ${item.description ?? ''}`
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
        {hasActiveStory && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Variables</span>
              <button
                type="button"
                title="Add variable"
                onClick={() => selectStoryData({ kind: 'variable', id: addVariable() })}
              >
                +
              </button>
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
              <span>Project Events</span>
              <div className={styles.sectionHeaderActions}>
                <button
                  type="button"
                  title="Open event interface table"
                  onClick={() => selectStoryData({ kind: 'event-table' })}
                >
                  ≡
                </button>
                <button
                  type="button"
                  title="Add event"
                  onClick={() => {
                    const id = addEvent();
                    if (id) selectStoryData({ kind: 'event', id });
                  }}
                >
                  +
                </button>
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
                <button
                  type="button"
                  title="Add signal"
                  onClick={() => {
                    const id = addSignal();
                    if (id) selectStoryData({ kind: 'signal', id });
                  }}
                >
                  +
                </button>
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
                  <code>{signal.name}</code>
                  {signal.description && <small>{signal.description}</small>}
                </span>
              </div>
            ))}
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{workspace?.project ? 'Project Assets' : 'Assets'}</span>
            <button
              type="button"
              title="Add asset"
              onClick={() => selectStoryData({ kind: 'asset', id: addAsset() })}
            >
              +
            </button>
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
            <button
              type="button"
              title="Add character"
              onClick={() => selectStoryData({ kind: 'character', id: addCharacter() })}
            >
              +
            </button>
          </div>
          {characters.length === 0 && <div className={styles.empty}>No characters</div>}
          {filteredCharacters.map((character) => (
            <div
              key={character.id}
              className={`${styles.item} ${storyDataSelection?.kind === 'character' && storyDataSelection.id === character.id ? styles.selected : ''}`}
              draggable
              onClick={() => selectStoryData({ kind: 'character', id: character.id })}
              onDragStart={(event) =>
                writeStoryDataDrag(event, { kind: 'character', id: character.id })
              }
            >
              <span className={`${styles.typeDot} ${styles.character}`} />
              <span className={styles.itemName}>{character.displayName}</span>
              <span className={styles.itemType}>character</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
