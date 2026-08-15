import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { GetVariableNodeData, SetVariableNodeData } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import styles from './Node.module.css';

const variableStyle = {
  '--node-accent': '#36b5a3',
  '--node-accent-soft': 'rgb(54 181 163 / 14%)',
} as CSSProperties;

function VariableName({ variableId }: { variableId?: string }) {
  const { availableVariables, projectVariables } = useStoryGraphStore();
  const variable = [...availableVariables, ...projectVariables].find(
    (candidate) => candidate.id === variableId,
  );
  return (
    <>
      <span className={styles.variableName}>{variable?.name ?? 'Select variable'}</span>
      <span className={styles.variableType}>{variable?.valueType.kind ?? 'unknown'}</span>
    </>
  );
}

export function GetVariableNode({ data }: NodeProps) {
  const d = data as unknown as GetVariableNodeData;
  return (
    <div className={styles.node} style={variableStyle}>
      <div className={styles.header}>
        <span className={styles.title}>Get Variable</span>
        <span className={styles.typeIcon}>G</span>
      </div>
      <div className={styles.variableBody}>
        <VariableName variableId={d.variableId} />
      </div>
      <Handle
        className={`${styles.dataHandle} ${styles.dataHandleOutput}`}
        type="source"
        position={Position.Right}
        id="value"
      />
    </div>
  );
}

export function SetVariableNode({ data }: NodeProps) {
  const d = data as unknown as SetVariableNodeData;
  return (
    <div className={styles.node} style={variableStyle}>
      <div className={styles.header}>
        <span className={styles.title}>Set Variable</span>
        <span className={styles.typeIcon}>S</span>
      </div>
      <div className={styles.variableBody}>
        <VariableName variableId={d.variableId} />
        <span className={styles.expression}>{d.value.source || 'value'}</span>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
      />
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
      />
    </div>
  );
}
