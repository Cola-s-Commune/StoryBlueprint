import {
  StoryNodeType,
  type BranchNodeData,
  type ChoiceNodeData,
  type DialogueNodeData,
  type EndNodeData,
  type StartNodeData,
} from '@story-blueprint/common';
import { useRef } from 'react';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import panelStyles from './Panel.module.css';
import styles from './Inspector.module.css';

interface PropertyFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  onBeginEdit: () => void;
  onChange: (value: string) => void;
}

function PropertyField({ label, value, multiline, onBeginEdit, onChange }: PropertyFieldProps) {
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
  const control = multiline ? (
    <textarea
      value={value}
      rows={5}
      onBlur={handleBlur}
      onChange={(event) => handleChange(event.target.value)}
    />
  ) : (
    <input
      value={value}
      onBlur={handleBlur}
      onChange={(event) => handleChange(event.target.value)}
    />
  );

  return (
    <label className={styles.field}>
      <span>{label}</span>
      {control}
    </label>
  );
}

export function Inspector() {
  const { nodes, checkpoint, updateNode, updateNodeData } = useStoryGraphStore();
  const selected = nodes.filter((node) => node.selected);

  if (selected.length !== 1) {
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>
            {selected.length > 1 ? `${selected.length} nodes selected` : 'Select a node to edit'}
          </p>
        </div>
      </div>
    );
  }

  const node = selected[0];
  const duplicateName = nodes.some(
    (candidate) => candidate.id !== node.id && candidate.name === node.name,
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
        return (
          <>
            <PropertyField
              label="Speaker"
              value={data.speaker}
              onBeginEdit={checkpoint}
              onChange={(speaker) => updateNodeData(node.id, StoryNodeType.Dialogue, { speaker })}
            />
            <PropertyField
              label="Text"
              value={data.text}
              multiline
              onBeginEdit={checkpoint}
              onChange={(text) => updateNodeData(node.id, StoryNodeType.Dialogue, { text })}
            />
          </>
        );
      }
      case StoryNodeType.Choice: {
        const data = node.data as ChoiceNodeData;
        return (
          <>
            <PropertyField
              label="Prompt"
              value={data.prompt}
              onBeginEdit={checkpoint}
              onChange={(prompt) => updateNodeData(node.id, StoryNodeType.Choice, { prompt })}
            />
            <div className={styles.groupLabel}>Options</div>
            {data.options.map((option, index) => (
              <PropertyField
                key={option.id}
                label={`Option ${index + 1}`}
                value={option.label}
                onBeginEdit={checkpoint}
                onChange={(label) => {
                  const options = data.options.map((candidate) =>
                    candidate.id === option.id ? { ...candidate, label } : candidate,
                  );
                  updateNodeData(node.id, StoryNodeType.Choice, { options });
                }}
              />
            ))}
          </>
        );
      }
      case StoryNodeType.Branch: {
        const data = node.data as BranchNodeData;
        return (
          <PropertyField
            label="Condition"
            value={data.condition}
            multiline
            onBeginEdit={checkpoint}
            onChange={(condition) => updateNodeData(node.id, StoryNodeType.Branch, { condition })}
          />
        );
      }
      case StoryNodeType.End: {
        const data = node.data as EndNodeData;
        return (
          <PropertyField
            label="Title"
            value={data.title}
            onBeginEdit={checkpoint}
            onChange={(title) => updateNodeData(node.id, StoryNodeType.End, { title })}
          />
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
            label="Name"
            value={node.name}
            onBeginEdit={checkpoint}
            onChange={(name) => updateNode(node.id, { name })}
          />
          {duplicateName && <div className={styles.warning}>Name must be unique.</div>}
          <div className={styles.readonlyField}>
            <span>Type</span>
            <code>{`${node.type}@${node.definitionVersion}`}</code>
          </div>
          <div className={styles.readonlyField}>
            <span>ID</span>
            <code title={node.id}>{node.id}</code>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Properties</div>
          {renderTypeProperties()}
        </section>
      </div>
    </div>
  );
}
