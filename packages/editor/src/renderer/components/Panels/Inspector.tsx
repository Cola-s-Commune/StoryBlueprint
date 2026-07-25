import {
  StoryNodeType,
  type BranchNodeData,
  type ChoiceNodeData,
  type DialogueNodeData,
  type EndNodeData,
  type StartNodeData,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { PanelHeader } from './PanelHeader';
import panelStyles from './Panel.module.css';
import styles from './Inspector.module.css';

interface PropertyFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}

function PropertyField({ label, value, multiline, onFocus, onChange }: PropertyFieldProps) {
  const control = multiline ? (
    <textarea value={value} rows={5} onFocus={onFocus} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input value={value} onFocus={onFocus} onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <label className={styles.field}>
      <span>{label}</span>
      {control}
    </label>
  );
}

interface InspectorProps {
  floating?: boolean;
  onToggleFloating?: () => void;
}

export function Inspector({ floating, onToggleFloating }: InspectorProps) {
  const { nodes, checkpoint, updateNode, updateNodeData } = useStoryGraphStore();
  const selected = nodes.filter((node) => node.selected);

  if (selected.length !== 1) {
    return (
      <div className={panelStyles.panel}>
        <PanelHeader title="Inspector" floating={floating} onToggleFloating={onToggleFloating} />
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
            onFocus={checkpoint}
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
              onFocus={checkpoint}
              onChange={(speaker) => updateNodeData(node.id, StoryNodeType.Dialogue, { speaker })}
            />
            <PropertyField
              label="Text"
              value={data.text}
              multiline
              onFocus={checkpoint}
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
              onFocus={checkpoint}
              onChange={(prompt) => updateNodeData(node.id, StoryNodeType.Choice, { prompt })}
            />
            <div className={styles.groupLabel}>Options</div>
            {data.options.map((option, index) => (
              <PropertyField
                key={option.id}
                label={`Option ${index + 1}`}
                value={option.label}
                onFocus={checkpoint}
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
            onFocus={checkpoint}
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
            onFocus={checkpoint}
            onChange={(title) => updateNodeData(node.id, StoryNodeType.End, { title })}
          />
        );
      }
    }
  };

  return (
    <div className={panelStyles.panel}>
      <PanelHeader title="Inspector" floating={floating} onToggleFloating={onToggleFloating} />
      <div className={`${panelStyles.body} ${styles.body}`}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Node</div>
          <PropertyField
            label="Name"
            value={node.name}
            onFocus={checkpoint}
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
