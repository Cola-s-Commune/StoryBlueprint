import { useEffect, useMemo, useRef, useState } from 'react';
import { createStableId } from '@story-blueprint/common';
import type {
  CharacterSource,
  CharacterId,
  EventSource,
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

function VariableEditor({ variable }: { variable: VariableDefinition }) {
  const {
    variables,
    projectVariables,
    findVariableReferences,
    variableReferencesLoading,
    variableReferencesError,
    refreshProjectVariableReferences,
    focusVariableReference,
    updateVariable,
    removeVariable,
  } = useStoryGraphStore();
  const [showAllReferences, setShowAllReferences] = useState(false);
  const references = findVariableReferences(variable.id);
  const visibleReferences = showAllReferences ? references : references.slice(0, 30);
  useEffect(() => setShowAllReferences(false), [variable.id]);
  const duplicate = [...variables, ...projectVariables].some(
    (candidate) => candidate.id !== variable.id && candidate.name === variable.name,
  );
  const kind = variable.valueType.kind as ScalarKind;
  const projectIndexUnavailable =
    variable.scope === 'project' &&
    (variableReferencesLoading || variableReferencesError !== undefined);
  return (
    <div className={styles.details}>
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
        <input
          value={variable.displayName}
          onChange={(event) => updateVariable(variable.id, { displayName: event.target.value })}
        />
      </label>
      <label>
        <span>Type</span>
        <select
          disabled={projectIndexUnavailable || references.length > 0}
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
        {variable.scope === 'project' ? (
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
        Delete Variable
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
    findCharacterReferences,
    findEmotionReferences,
    findCharacterFieldReferences,
    focusStoryResourceReference,
    renameCharacterEmotion,
    removeCharacterEmotion,
    removeCharacter,
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
  const addEmotion = () => {
    let index = Object.keys(character.emotions).length + 1;
    let key = `emotion${index}`;
    while (character.emotions[key]) key = `emotion${++index}`;
    updateCharacter(character.id, {
      emotions: {
        ...character.emotions,
        [key]: { displayName: `Emotion ${index}` },
      },
    });
  };
  const fields = character.fields ?? [];
  const updateField = (id: VariableDefinition['id'], patch: Partial<VariableDefinition>) =>
    updateCharacter(character.id, {
      fields: fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  const addField = () => {
    let index = fields.length + 1;
    let name = `field${index}`;
    while (fields.some((field) => field.name === name)) name = `field${++index}`;
    updateCharacter(character.id, {
      fields: [
        ...fields,
        {
          id: createStableId('variable'),
          name,
          displayName: `Field ${index}`,
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
        <input
          value={character.displayName}
          onChange={(event) => updateCharacter(character.id, { displayName: event.target.value })}
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
        <button
          type="button"
          onClick={() => {
            let index = Object.keys(metadata).length + 1;
            let key = `key${index}`;
            while (Object.hasOwn(metadata, key)) key = `key${++index}`;
            updateMetadata({ ...metadata, [key]: '' });
          }}
        >
          Add Metadata
        </button>
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
                  <input
                    type={kind === 'number' ? 'number' : 'text'}
                    value={String(value)}
                    onChange={(event) =>
                      updateMetadata({
                        ...metadata,
                        [key]: kind === 'number' ? Number(event.target.value) : event.target.value,
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
        <button type="button" onClick={addField}>
          Add Field
        </button>
      </div>
      <div className={styles.emotionList}>
        {fields.map((field) => {
          const kind = field.valueType.kind as ScalarKind;
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
                      const nextKind = event.target.value as ScalarKind;
                      updateField(field.id, {
                        valueType: { kind: nextKind },
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
                  <span>Default</span>
                  {kind === 'boolean' ? (
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
                    <input
                      type={kind === 'number' ? 'number' : 'text'}
                      value={String(field.defaultValue)}
                      onChange={(event) =>
                        updateField(field.id, {
                          defaultValue:
                            kind === 'number' ? Number(event.target.value) : event.target.value,
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
        <button type="button" onClick={addEmotion}>
          Add Emotion
        </button>
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
                <input
                  value={emotion.displayName}
                  onChange={(event) =>
                    updateCharacter(character.id, {
                      emotions: {
                        ...character.emotions,
                        [key]: { ...emotion, displayName: event.target.value },
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
        emptyMessage="This character is not used by any Dialogue line."
        onShow={focusStoryResourceReference}
      />
      {references.length > 0 && (
        <div className={styles.warning}>
          Remove these Dialogue references before deleting the character.
        </div>
      )}
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
          disabled={references.length > 0}
          onClick={() => removeCharacter(character.id)}
        >
          Delete Character
        </button>
      </div>
    </div>
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
  const { events, workspaceError, updateEvent, removeEvent } = useStoryGraphStore();
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
  const { signals, workspaceError, updateSignal, removeSignal } = useStoryGraphStore();
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
        <button
          type="button"
          onClick={() => {
            const used = new Set(signal.parameters.map((parameter) => parameter.name));
            let index = signal.parameters.length + 1;
            let name = `value${index}`;
            while (used.has(name)) name = `value${++index}`;
            updateSignal(signal.id, {
              parameters: [...signal.parameters, { name, valueType: { kind: 'string' } }],
            });
          }}
        >
          Add
        </button>
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
  const { storyDataSelection, variables, projectVariables, characters, assets, events, signals } =
    useStoryGraphStore();
  if (!storyDataSelection) return null;
  if (storyDataSelection.kind === 'event-table')
    return <EventTable events={events} signals={signals} />;
  if (storyDataSelection.kind === 'variable') {
    const variable = [...variables, ...projectVariables].find(
      (item) => item.id === storyDataSelection.id,
    );
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
    projectVariables,
    characters,
    assets,
    events,
    signals,
    addVariable,
    addProjectVariable,
    addCharacter,
    addAsset,
    addEvent,
    addSignal,
    storyDataSelection,
    selectStoryData,
  } = useStoryGraphStore();
  const [resourceSearch, setResourceSearch] = useState('');
  const filteredCharacters = useMemo(() => {
    return characters.filter((character) => matchesCharacterSearch(character, resourceSearch));
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
              <span>Project Variables</span>
              <button
                type="button"
                title="Add project variable"
                onClick={() => {
                  const id = addProjectVariable();
                  if (id) selectStoryData({ kind: 'variable', id });
                }}
              >
                +
              </button>
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
              <span className={`${styles.typeDot} ${styles.character}`} />
              <span className={styles.characterSummary}>
                <strong>{character.displayName}</strong>
                <code>{character.name}</code>
                {(character.description || character.dialogueStyle) && (
                  <small>{character.description || character.dialogueStyle}</small>
                )}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
