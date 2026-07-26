import { useMemo, useState } from 'react';
import type {
  CharacterSource,
  AssetId,
  AssetSource,
  RuntimeValue,
  ValueType,
  VariableDefinition,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { writeStoryDataDrag } from '../../graph/storyDataDrag';
import panelStyles from './Panel.module.css';
import styles from './StoryData.module.css';

type ScalarKind = 'boolean' | 'number' | 'string';

function defaultForType(kind: ScalarKind): RuntimeValue {
  if (kind === 'boolean') return false;
  if (kind === 'number') return 0;
  return '';
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
        <input
          value={variable.name}
          onChange={(event) =>
            updateVariable(variable.id, {
              name: event.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
            })
          }
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
        <input
          value={character.name}
          onChange={(event) => {
            const name = event.target.value.replace(/[^a-zA-Z0-9_]/g, '');
            if (name) updateCharacter(character.id, { name, displayName: name });
          }}
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
          onClick={() => {
            if (window.confirm(`Delete character ${character.displayName}?`)) {
              removeCharacter(character.id);
            }
          }}
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
        <input
          value={asset.name}
          onChange={(event) =>
            updateAsset(asset.id, { name: event.target.value.replace(/[^a-zA-Z0-9_]/g, '') })
          }
        />
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

export function StoryDataInspector() {
  const { storyDataSelection, variables, characters, assets } = useStoryGraphStore();
  if (!storyDataSelection) return null;
  if (storyDataSelection.kind === 'variable') {
    const variable = variables.find((item) => item.id === storyDataSelection.id);
    return variable ? <VariableEditor variable={variable} /> : null;
  }
  if (storyDataSelection.kind === 'character') {
    const character = characters.find((item) => item.id === storyDataSelection.id);
    return character ? <CharacterEditor character={character} /> : null;
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
    addVariable,
    addCharacter,
    addAsset,
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
