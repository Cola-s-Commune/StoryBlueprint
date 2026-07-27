import {
  StoryNodeType,
  type BranchNodeData,
  type CallSubstoryNodeData,
  type ChoiceNodeData,
  type DialogueNodeData,
  type EndNodeData,
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
  type GetVariableNodeData,
  type SetVariableNodeData,
  type StartNodeData,
  type NodeId,
  type VariableId,
} from '@story-blueprint/common';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { readStoryDataDrag } from '../../graph/storyDataDrag';
import { StoryDataInspector } from './StoryData';
import panelStyles from './Panel.module.css';
import styles from './Inspector.module.css';

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
  const { variables } = useStoryGraphStore();
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
    const variable = variables.find((candidate) => candidate.id === payload.id);
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
  const { variables } = useStoryGraphStore();
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
      </select>
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
  const { variables, checkpoint, updateNodeData } = useStoryGraphStore();
  const variable = variables.find((candidate) => candidate.id === data.variableId);
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
          const nextVariable = variables.find((candidate) => candidate.id === variableId);
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

export function Inspector() {
  const {
    hasActiveStory,
    nodes,
    variables,
    characters,
    assets,
    chapters,
    activeGraphId,
    checkpoint,
    updateNode,
    updateNodeData,
    storyDataSelection,
  } = useStoryGraphStore();
  const selected = nodes.filter((node) => node.selected);

  if (selected.length !== 1) {
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
        const character = characters.find((candidate) => candidate.id === data.speakerId);
        return (
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
                updateNodeData(node.id, StoryNodeType.Dialogue, { speakerId: payload.id });
              }}
            >
              <span>Speaker</span>
              <select
                value={data.speakerId ?? ''}
                onChange={(event) => {
                  checkpoint();
                  updateNodeData(node.id, StoryNodeType.Dialogue, {
                    speakerId: (event.target.value || undefined) as DialogueNodeData['speakerId'],
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
              <small>Drag a character here to assign it.</small>
            </label>
            <PropertyField
              label="Text Template"
              value={data.text.source}
              multiline
              variableMode="template"
              onBeginEdit={checkpoint}
              onChange={(source) =>
                updateNodeData(node.id, StoryNodeType.Dialogue, { text: { source } })
              }
            />
            {character && (
              <label className={styles.field}>
                <span>Emotion</span>
                <select
                  value={data.emotion ?? ''}
                  onChange={(event) => {
                    checkpoint();
                    updateNodeData(node.id, StoryNodeType.Dialogue, {
                      emotion: event.target.value || undefined,
                    });
                  }}
                >
                  <option value="">Default</option>
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
                if (readStoryDataDrag(event.dataTransfer)?.kind === 'asset') event.preventDefault();
              }}
              onDrop={(event) => {
                const payload = readStoryDataDrag(event.dataTransfer);
                if (payload?.kind !== 'asset') return;
                event.preventDefault();
                checkpoint();
                updateNodeData(node.id, StoryNodeType.Dialogue, { voiceId: payload.id });
              }}
            >
              <span>Voice Asset</span>
              <select
                value={data.voiceId ?? ''}
                onChange={(event) => {
                  checkpoint();
                  updateNodeData(node.id, StoryNodeType.Dialogue, {
                    voiceId: (event.target.value || undefined) as DialogueNodeData['voiceId'],
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
              <small>Drag a voice asset here to assign it.</small>
            </label>
          </>
        );
      }
      case StoryNodeType.Choice: {
        const data = node.data as ChoiceNodeData;
        return (
          <>
            <PropertyField
              label="Prompt Template"
              value={data.prompt.source}
              variableMode="template"
              onBeginEdit={checkpoint}
              onChange={(source) =>
                updateNodeData(node.id, StoryNodeType.Choice, { prompt: { source } })
              }
            />
            <div className={styles.groupLabel}>Options</div>
            {data.options.map((option, index) => (
              <div key={option.id} className={styles.optionGroup}>
                <PropertyField
                  label={`Option ${index + 1}`}
                  value={option.text.source}
                  variableMode="template"
                  onBeginEdit={checkpoint}
                  onChange={(source) => {
                    const options = data.options.map((candidate) =>
                      candidate.id === option.id ? { ...candidate, text: { source } } : candidate,
                    );
                    updateNodeData(node.id, StoryNodeType.Choice, { options });
                  }}
                />
                <PropertyField
                  label="Visible If"
                  value={option.visibleIf?.source ?? ''}
                  variableMode="expression"
                  onBeginEdit={checkpoint}
                  onChange={(source) => {
                    const options = data.options.map((candidate) =>
                      candidate.id === option.id
                        ? {
                            ...candidate,
                            visibleIf: source ? { source, bindings: {} } : undefined,
                          }
                        : candidate,
                    );
                    updateNodeData(node.id, StoryNodeType.Choice, { options });
                  }}
                />
                <PropertyField
                  label="Enabled If"
                  value={option.enabledIf?.source ?? ''}
                  variableMode="expression"
                  onBeginEdit={checkpoint}
                  onChange={(source) => {
                    const options = data.options.map((candidate) =>
                      candidate.id === option.id
                        ? {
                            ...candidate,
                            enabledIf: source ? { source, bindings: {} } : undefined,
                          }
                        : candidate,
                    );
                    updateNodeData(node.id, StoryNodeType.Choice, { options });
                  }}
                />
              </div>
            ))}
          </>
        );
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
