import { Handle, Position, type NodeProps } from '@xyflow/react';
import { type CSSProperties } from 'react';
import type { GetVariableNodeData, SetVariableNodeData, ValueType } from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { expressionToTextTemplate } from '../Panels/expressionAuthoring';
import styles from './Node.module.css';

const variableStyle = {
  '--node-accent': '#36b5a3',
  '--node-accent-soft': 'rgb(54 181 163 / 14%)',
} as CSSProperties;

function valueTypeLabel(type: ValueType | undefined): string {
  if (!type) return 'unknown';
  if (type.kind === 'array') return `Array<${valueTypeLabel(type.elementType ?? { kind: 'any' })}>`;
  if (type.kind === 'map')
    return `Map<${type.keyType ?? 'string'}, ${valueTypeLabel(type.valueType ?? { kind: 'any' })}>`;
  if (type.kind === 'json') return type.name;
  return type.kind;
}

function VariableName({ variableId }: { variableId?: string }) {
  const { availableVariables, projectVariables } = useStoryGraphStore();
  const variable = [...availableVariables, ...projectVariables].find(
    (candidate) => candidate.id === variableId,
  );
  return (
    <>
      <span className={styles.variableName}>{variable?.name ?? 'Select variable'}</span>
      <span className={styles.variableType}>{valueTypeLabel(variable?.valueType)}</span>
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
        {d.accessor?.kind === 'member' && (
          <span className={styles.expression}>.{d.accessor.member}</span>
        )}
        {d.accessor?.kind === 'index' && (
          <span className={styles.expression}>[{d.accessor.index.source}]</span>
        )}
      </div>
      {(d.exposedFields?.length ?? 0) > 0 && (
        <div className={styles.variableOutputs}>
          {d.exposedFields!.map((field) => (
            <div className={styles.variableOutputRow} key={field.fieldId}>
              <span>{field.displayName}</span>
              <em>{field.valueType.kind}</em>
              <Handle
                className={`${styles.dataHandle} ${styles.dataHandleOutput}`}
                type="source"
                position={Position.Right}
                id={`field:${field.fieldId}`}
              />
            </div>
          ))}
        </div>
      )}
      <Handle
        className={`${styles.dataHandle} ${styles.dataHandleOutput}`}
        type="source"
        position={Position.Right}
        id="value"
        style={{ top: (d.exposedFields?.length ?? 0) > 0 ? 54 : '50%' }}
      />
    </div>
  );
}

export function SetVariableNode({ data }: NodeProps) {
  const d = data as unknown as SetVariableNodeData;
  const { availableVariables, projectVariables, characters } = useStoryGraphStore();
  const variable =
    availableVariables.find((candidate) => candidate.id === d.variableId) ??
    projectVariables.find((candidate) => candidate.id === d.variableId) ??
    characters
      .flatMap((character) => character.fields ?? [])
      .find((candidate) => candidate.id === d.variableId);
  const valueContract =
    d.valueInputType ??
    (d.containerOperation === 'append' && variable?.valueType.kind === 'array'
      ? variable.valueType.elementType
      : d.containerOperation === 'set-entry' && variable?.valueType.kind === 'map'
        ? variable.valueType.valueType
        : d.containerOperation === 'set-field'
          ? d.fieldValueType
          : variable?.valueType);
  const keyContract =
    d.keyInputType ??
    (variable?.valueType.kind === 'map' && variable.valueType.keyType === 'number'
      ? { kind: 'number' as const }
      : variable?.valueType.kind === 'map' && variable.valueType.keyType === 'character-ref'
        ? { kind: 'character-ref' as const }
        : variable?.valueType.kind === 'map' && variable.valueType.keyType === 'asset-ref'
          ? { kind: 'asset-ref' as const }
          : { kind: 'string' as const });
  const displayValue =
    variable?.valueType.kind === 'string'
      ? (expressionToTextTemplate(
          d.value.source,
          availableVariables,
          projectVariables,
          characters,
        ) ?? d.value.source)
      : d.value.source;
  return (
    <div className={styles.node} style={variableStyle}>
      <div className={styles.header}>
        <span className={styles.title}>
          {d.containerOperation === 'append'
            ? 'Add Array Item'
            : d.containerOperation === 'set-entry'
              ? 'Set Map Entry'
              : d.containerOperation === 'set-field'
                ? 'Set Object Field'
                : 'Set Variable'}
        </span>
        <span className={styles.typeIcon}>S</span>
      </div>
      <div className={styles.variableBody}>
        <VariableName variableId={d.variableId} />
        {d.containerOperation === 'set-field' && (
          <span className={styles.expression}>.{d.fieldName ?? 'field'}</span>
        )}
      </div>
      <div className={styles.dataInputRows}>
        {d.containerOperation === 'set-entry' && (
          <div className={styles.dataInputRow}>
            <Handle
              className={`${styles.dataHandle} ${styles.dataHandleInput}`}
              type="target"
              position={Position.Left}
              id="key"
            />
            <b>Key</b>
            <span className={styles.expression}>{d.key?.source || 'key'}</span>
            <em>{valueTypeLabel(keyContract)}</em>
          </div>
        )}
        <div className={styles.dataInputRow}>
          <Handle
            className={`${styles.dataHandle} ${styles.dataHandleInput}`}
            type="target"
            position={Position.Left}
            id="value"
          />
          <b>
            {d.containerOperation === 'append'
              ? 'Item'
              : d.containerOperation === 'set-field'
                ? 'Field Value'
                : 'Value'}
          </b>
          <span className={styles.expression}>{displayValue || 'value'}</span>
          <em>{valueTypeLabel(valueContract)}</em>
        </div>
      </div>
      <Handle
        className={`${styles.handle} ${styles.handleInput}`}
        type="target"
        position={Position.Left}
        id="in"
        style={{ top: 17 }}
      />
      <Handle
        className={`${styles.handle} ${styles.handleOutput}`}
        type="source"
        position={Position.Right}
        id="out"
        style={{ top: 17 }}
      />
    </div>
  );
}
