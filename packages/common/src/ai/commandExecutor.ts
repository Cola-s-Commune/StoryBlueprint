import {
  createGraphConnectionValidator,
  resolveNodePorts,
  validateGraphConnection,
  valueTypesCompatible,
  type GraphEdgeLike,
  type GraphNodeLike,
} from '../graph/connectionValidation';
import { NodeRegistry } from '../registry/nodeRegistry';
import { serializeStorySource } from '../serialization/storyKdl';
import { isStableId, type CharacterId, type ConditionId, type VariableId } from '../types/ids';
import {
  StoryNodeType,
  type ChoiceNodeData,
  type DialogueNodeData,
  type StoryNodeDataMap,
} from '../types/nodes';
import type {
  CharacterSource,
  ConditionSource,
  ConditionTreeNode,
  SourceEdge,
  SourceGraph,
  SourceNode,
  StorySourceDocument,
} from '../types/source';
import {
  runtimeValueMatchesType,
  type RuntimeValue,
  type ValueType,
  type VariableDefinition,
} from '../types/values';
import type { CharacterTemplateSource } from '../types/characterTemplate';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  type BlueprintCommand,
  type BlueprintCommandDiagnostic,
  type BlueprintCommandTransaction,
  type BlueprintGraphTarget,
  type BlueprintLayoutRequest,
} from './blueprintCommands';
import { createStorySemanticSnapshot, type StorySemanticSnapshot } from './semanticModel';
import { findConditionReferenceCycle } from '../conditionValidation';

const commandRegistry = new NodeRegistry();
commandRegistry.registerBuiltins();

interface MutableGraph {
  nodes: SourceNode[];
  edges: SourceEdge[];
}

interface MutableChapter {
  id: string;
  name: string;
  displayName: string;
  parameters: StorySourceDocument['chapters'][number]['parameters'];
  outputs: StorySourceDocument['chapters'][number]['outputs'];
  localVariables: StorySourceDocument['chapters'][number]['localVariables'];
  graph: MutableGraph;
}

interface MutableStory extends Omit<
  StorySourceDocument,
  'root' | 'chapters' | 'variables' | 'characters' | 'conditions'
> {
  root: MutableGraph;
  chapters: MutableChapter[] & StorySourceDocument['chapters'];
  variables: VariableDefinition[];
  characters: CharacterSource[];
  conditions: ConditionSource[];
}

export type BlueprintTransactionResult =
  | {
      ok: true;
      committed: boolean;
      document: StorySourceDocument;
      snapshot: StorySemanticSnapshot;
      appliedOperationIds: readonly string[];
      layoutRequests: readonly BlueprintLayoutRequest[];
      diagnostics: readonly [];
    }
  | {
      ok: false;
      committed: false;
      document: StorySourceDocument;
      diagnostics: readonly BlueprintCommandDiagnostic[];
    };

export interface BlueprintSemanticContext {
  characters: StorySourceDocument['characters'];
  assets: StorySourceDocument['assets'];
  events: StorySourceDocument['events'];
  signals: NonNullable<StorySourceDocument['signals']>;
  conditions?: NonNullable<StorySourceDocument['conditions']>;
  characterTemplates?: readonly CharacterTemplateSource[];
  engineTypes?: readonly import('../types/project').EngineTypeDefinition[];
}

export interface BlueprintTransactionOptions {
  dryRun?: boolean;
  /** Resolved project resources used for Revision, AI Snapshot, and cross-resource validation. */
  semanticContext?: BlueprintSemanticContext;
}

function withSemanticContext(
  source: StorySourceDocument,
  context: BlueprintSemanticContext | undefined,
): StorySourceDocument {
  return context
    ? {
        ...source,
        characters: context.characters,
        assets: context.assets,
        events: context.events,
        signals: context.signals,
        conditions: context.conditions ?? source.conditions,
      }
    : source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidShape(
  message: string,
  operationIndex?: number,
  path?: string,
): BlueprintCommandDiagnostic {
  return { code: 'INVALID_TRANSACTION', message, operationIndex, path };
}

function validEndpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.nodeId === 'string' &&
    isStableId(value.nodeId, 'node') &&
    typeof value.portId === 'string' &&
    value.portId.length > 0
  );
}

function validGraphTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'root' ||
      (value.kind === 'chapter' &&
        typeof value.chapterId === 'string' &&
        isStableId(value.chapterId, 'chapter')))
  );
}

function validValueType(value: unknown): value is ValueType {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.nullable !== undefined && typeof value.nullable !== 'boolean') return false;
  switch (value.kind) {
    case 'any':
    case 'boolean':
    case 'number':
    case 'string':
    case 'character-ref':
    case 'asset-ref':
      return true;
    case 'json':
      return typeof value.name === 'string' && value.name.trim().length > 0;
    case 'enum':
      return (
        typeof value.name === 'string' &&
        value.name.trim().length > 0 &&
        Array.isArray(value.values) &&
        value.values.length > 0 &&
        new Set(value.values).size === value.values.length &&
        value.values.every((item) => typeof item === 'string' && item.length > 0)
      );
    case 'array':
      return value.elementType === undefined || validValueType(value.elementType);
    case 'map':
      return (
        (value.keyType === undefined ||
          value.keyType === 'string' ||
          value.keyType === 'number' ||
          value.keyType === 'character-ref' ||
          value.keyType === 'asset-ref') &&
        (value.valueType === undefined || validValueType(value.valueType))
      );
    case 'struct':
      return (
        typeof value.name === 'string' &&
        value.name.trim().length > 0 &&
        isRecord(value.fields) &&
        Object.entries(value.fields).every(
          ([name, fieldType]) => name.trim().length > 0 && validValueType(fieldType),
        )
      );
    default:
      return false;
  }
}

function validRuntimeValue(value: unknown): value is RuntimeValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every(validRuntimeValue)) ||
    (isRecord(value) && Object.values(value).every(validRuntimeValue))
  );
}

function rewriteBoundReferences(
  value: unknown,
  renames: ReadonlyMap<VariableId, { oldName: string; newName: string }>,
): unknown {
  const renameByName = new Map(
    [...renames.values()].map((rename) => [rename.oldName, rename.newName]),
  );
  const rewriteIdentifiers = (source: string): string => {
    let result = '';
    let index = 0;
    while (index < source.length) {
      const character = source[index]!;
      if (character === '"' || character === "'") {
        const quote = character;
        const start = index++;
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2;
            continue;
          }
          index += 1;
          if (source[index - 1] === quote) break;
        }
        result += source.slice(start, index);
        continue;
      }
      if (/[A-Za-z_]/.test(character)) {
        const start = index++;
        while (/[A-Za-z0-9_]/.test(source[index] ?? '')) index += 1;
        const identifier = source.slice(start, index);
        result += renameByName.get(identifier) ?? identifier;
        continue;
      }
      result += character;
      index += 1;
    }
    return result;
  };
  if (Array.isArray(value)) return value.map((item) => rewriteBoundReferences(item, renames));
  if (!isRecord(value)) return value;
  if (typeof value.source === 'string' && isRecord(value.bindings)) {
    const source = rewriteIdentifiers(value.source);
    const bindings: Record<string, string> = {};
    for (const [symbol, variableId] of Object.entries(value.bindings)) {
      const rename = renames.get(variableId as VariableId);
      const nextSymbol = rename && symbol === rename.oldName ? rename.newName : symbol;
      bindings[nextSymbol] = String(variableId);
    }
    return {
      ...value,
      source,
      bindings,
      ...Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'source' && key !== 'bindings')
          .map(([key, child]) => [key, rewriteBoundReferences(child, renames)]),
      ),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, rewriteBoundReferences(child, renames)]),
  );
}

function validVariable(value: unknown): value is VariableDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStableId(value.id, 'variable') &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    (value.scope === 'project' ||
      value.scope === 'story' ||
      value.scope === 'chapter' ||
      value.scope === 'local') &&
    validValueType(value.valueType) &&
    validRuntimeValue(value.defaultValue)
  );
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validCharacterField(value: unknown): value is VariableDefinition {
  return (
    validVariable({ ...(isRecord(value) ? value : {}), scope: 'story' }) &&
    isRecord(value) &&
    value.scope === 'character' &&
    validValueType(value.valueType) &&
    isRecord(value.valueType) &&
    runtimeValueMatchesType(value.defaultValue as RuntimeValue, value.valueType as ValueType)
  );
}

function validEmotions(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (emotion) =>
        isRecord(emotion) &&
        typeof emotion.displayName === 'string' &&
        emotion.displayName.length > 0 &&
        (emotion.portraitId === undefined ||
          (typeof emotion.portraitId === 'string' && isStableId(emotion.portraitId, 'asset'))),
    )
  );
}

function validRelationships(value: unknown, ownerId?: CharacterId): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([targetId, relationship]) =>
        isStableId(targetId, 'character') &&
        targetId !== ownerId &&
        isRecord(relationship) &&
        typeof relationship.label === 'string' &&
        relationship.label.trim().length > 0 &&
        (relationship.description === undefined || typeof relationship.description === 'string'),
    )
  );
}

function validCharacterMetadata(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        key.trim().length > 0 &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'),
    )
  );
}

function validCharacter(value: unknown): value is CharacterSource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStableId(value.id, 'character') &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.dialogueStyle === undefined || typeof value.dialogueStyle === 'string') &&
    (value.tags === undefined ||
      (validStringArray(value.tags) &&
        value.tags.every((tag) => tag.trim().length > 0) &&
        new Set(value.tags).size === value.tags.length)) &&
    (value.metadata === undefined || validCharacterMetadata(value.metadata)) &&
    (value.relationships === undefined || validRelationships(value.relationships, value.id)) &&
    (value.defaultPortraitId === undefined ||
      (typeof value.defaultPortraitId === 'string' &&
        isStableId(value.defaultPortraitId, 'asset'))) &&
    validEmotions(value.emotions) &&
    (value.fields === undefined ||
      (Array.isArray(value.fields) && value.fields.every(validCharacterField)))
  );
}

function validNodeIdArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === 'string' && isStableId(item, 'node'))
  );
}

function validLineInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStableId(value.id, 'line') &&
    typeof value.textId === 'string' &&
    isStableId(value.textId, 'text') &&
    typeof value.text === 'string' &&
    (value.speakerId === undefined ||
      (typeof value.speakerId === 'string' && isStableId(value.speakerId, 'character'))) &&
    (value.voiceId === undefined ||
      (typeof value.voiceId === 'string' && isStableId(value.voiceId, 'asset'))) &&
    (value.emotion === undefined || typeof value.emotion === 'string') &&
    (value.tags === undefined || validStringArray(value.tags))
  );
}

function validChoiceOptionInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStableId(value.id, 'option') &&
    typeof value.text === 'string' &&
    (value.visibleIf === undefined || typeof value.visibleIf === 'string') &&
    (value.enabledIf === undefined || typeof value.enabledIf === 'string') &&
    (value.visibleConditionId === undefined ||
      (typeof value.visibleConditionId === 'string' &&
        isStableId(value.visibleConditionId, 'condition'))) &&
    (value.enabledConditionId === undefined ||
      (typeof value.enabledConditionId === 'string' &&
        isStableId(value.enabledConditionId, 'condition')))
  );
}

function validExpressionSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    isRecord(value.bindings) &&
    Object.values(value.bindings).every(
      (variableId) => typeof variableId === 'string' && isStableId(variableId, 'variable'),
    )
  );
}

function validConditionTree(value: unknown): value is ConditionTreeNode {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'expression') return validExpressionSource(value.expression);
  if (value.kind === 'reference') {
    return typeof value.conditionId === 'string' && isStableId(value.conditionId, 'condition');
  }
  if (value.kind === 'not') return validConditionTree(value.child);
  if (value.kind === 'all' || value.kind === 'any') {
    return Array.isArray(value.children) && value.children.every(validConditionTree);
  }
  return false;
}

function validCondition(value: unknown): value is ConditionSource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStableId(value.id, 'condition') &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    (value.description === undefined || typeof value.description === 'string') &&
    validConditionTree(value.root)
  );
}

function validExpressionTarget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'branch-condition' || value.kind === 'set-variable-value') return true;
  if (value.kind === 'choice-visible' || value.kind === 'choice-enabled') {
    return typeof value.optionId === 'string' && isStableId(value.optionId, 'option');
  }
  if (value.kind === 'event-argument' || value.kind === 'signal-match') {
    return typeof value.parameterName === 'string' && value.parameterName.length > 0;
  }
  return false;
}

function requiresGraphTarget(kind: unknown): boolean {
  return ![
    'add-variable',
    'update-variable',
    'add-condition',
    'update-condition',
    'remove-condition',
    'add-character',
    'add-character-from-template',
    'update-character',
    'add-substory',
    'update-substory',
  ].includes(String(kind));
}

const operationKeys: Readonly<Record<string, readonly string[]>> = {
  'add-node': ['operationId', 'kind', 'graph', 'node'],
  'add-variable-adjustment': ['operationId', 'kind', 'graph', 'node', 'variableId', 'delta'],
  'update-node': ['operationId', 'kind', 'graph', 'nodeId', 'patch'],
  'remove-node': ['operationId', 'kind', 'graph', 'nodeId'],
  connect: ['operationId', 'kind', 'graph', 'from', 'to', 'replaceExisting'],
  disconnect: ['operationId', 'kind', 'graph', 'from', 'to'],
  'add-variable': ['operationId', 'kind', 'variable'],
  'update-variable': ['operationId', 'kind', 'variableId', 'patch'],
  'add-condition': ['operationId', 'kind', 'condition'],
  'update-condition': ['operationId', 'kind', 'conditionId', 'patch'],
  'remove-condition': ['operationId', 'kind', 'conditionId'],
  'add-character': ['operationId', 'kind', 'character'],
  'add-character-from-template': ['operationId', 'kind', 'templateName', 'character', 'fieldIds'],
  'update-character': ['operationId', 'kind', 'characterId', 'patch'],
  'add-substory': ['operationId', 'kind', 'substory'],
  'update-substory': ['operationId', 'kind', 'chapterId', 'patch'],
  'add-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'line', 'afterLineId'],
  'update-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'lineId', 'patch'],
  'remove-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'lineId'],
  'add-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'option', 'afterOptionId'],
  'update-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'optionId', 'patch'],
  'remove-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'optionId'],
  'set-expression': ['operationId', 'kind', 'graph', 'nodeId', 'target', 'source'],
  'layout-selection': ['operationId', 'kind', 'graph', 'nodeIds'],
  'layout-neighborhood': ['operationId', 'kind', 'graph', 'nodeIds'],
};

function unexpectedKeyDiagnostics(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  operationIndex?: number,
): BlueprintCommandDiagnostic[] {
  const allowedKeys = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .map((key) =>
      invalidShape(
        key === 'commands' && path === ''
          ? 'Use operations instead of commands'
          : `Unexpected field: ${key}`,
        operationIndex,
        path ? `${path}.${key}` : key,
      ),
    );
}

/** Runtime shape validation for untrusted JSON produced by an AI or plugin. */
export function validateBlueprintCommandTransaction(
  value: unknown,
): readonly BlueprintCommandDiagnostic[] {
  if (!isRecord(value)) return [invalidShape('Command transaction must be an object')];
  const diagnostics: BlueprintCommandDiagnostic[] = unexpectedKeyDiagnostics(
    value,
    ['format', 'version', 'baseRevision', 'operations'],
    '',
  );
  if (value.format !== BLUEPRINT_COMMAND_FORMAT) {
    diagnostics.push(
      invalidShape(`format must be ${BLUEPRINT_COMMAND_FORMAT}`, undefined, 'format'),
    );
  }
  if (value.version !== BLUEPRINT_COMMAND_VERSION) {
    diagnostics.push(
      invalidShape(`version must be ${BLUEPRINT_COMMAND_VERSION}`, undefined, 'version'),
    );
  }
  if (typeof value.baseRevision !== 'string' || value.baseRevision.length === 0) {
    diagnostics.push(
      invalidShape('baseRevision is required and must be a string', undefined, 'baseRevision'),
    );
  }
  if (!Array.isArray(value.operations)) {
    diagnostics.push(invalidShape('operations must be an array', undefined, 'operations'));
    return diagnostics;
  }
  const operationIds = new Set<string>();
  value.operations.forEach((raw, operationIndex) => {
    const path = `operations.${operationIndex}`;
    if (!isRecord(raw)) {
      diagnostics.push(invalidShape('Operation must be an object', operationIndex, path));
      return;
    }
    const operationId = raw.operationId;
    if (typeof operationId !== 'string' || operationId.length === 0) {
      diagnostics.push(
        invalidShape(
          'operationId must be a non-empty string',
          operationIndex,
          `${path}.operationId`,
        ),
      );
    } else if (operationIds.has(operationId)) {
      diagnostics.push({
        code: 'DUPLICATE_OPERATION_ID',
        message: `Operation ID is duplicated: ${operationId}`,
        operationId,
        operationIndex,
      });
    } else operationIds.add(operationId);
    const allowedKeys = typeof raw.kind === 'string' ? operationKeys[raw.kind] : undefined;
    if (allowedKeys)
      diagnostics.push(...unexpectedKeyDiagnostics(raw, allowedKeys, path, operationIndex));
    if (requiresGraphTarget(raw.kind) && !validGraphTarget(raw.graph)) {
      diagnostics.push(
        invalidShape('Operation has an invalid graph target', operationIndex, `${path}.graph`),
      );
    }
    switch (raw.kind) {
      case 'add-node':
        if (isRecord(raw.node)) {
          diagnostics.push(
            ...unexpectedKeyDiagnostics(
              raw.node,
              ['id', 'type', 'name', 'data'],
              `${path}.node`,
              operationIndex,
            ),
          );
        }
        if (
          !isRecord(raw.node) ||
          typeof raw.node.id !== 'string' ||
          !isStableId(raw.node.id, 'node') ||
          typeof raw.node.type !== 'string' ||
          !Object.values(StoryNodeType).includes(raw.node.type as StoryNodeType) ||
          !isRecord(raw.node.data) ||
          (raw.node.name !== undefined && typeof raw.node.name !== 'string')
        ) {
          diagnostics.push(
            invalidShape(
              'add-node requires a valid node ID, type, name, and data object',
              operationIndex,
              `${path}.node`,
            ),
          );
        }
        break;
      case 'add-variable-adjustment':
        if (
          !isRecord(raw.node) ||
          typeof raw.node.id !== 'string' ||
          !isStableId(raw.node.id, 'node') ||
          (raw.node.name !== undefined && typeof raw.node.name !== 'string') ||
          typeof raw.variableId !== 'string' ||
          !isStableId(raw.variableId, 'variable') ||
          typeof raw.delta !== 'number' ||
          !Number.isFinite(raw.delta) ||
          raw.delta === 0
        ) {
          diagnostics.push(
            invalidShape(
              'add-variable-adjustment requires a node ID, numeric variable ID, and non-zero finite delta',
              operationIndex,
              path,
            ),
          );
        }
        break;
      case 'update-node':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          !isRecord(raw.patch) ||
          (raw.patch.name !== undefined &&
            raw.patch.name !== null &&
            typeof raw.patch.name !== 'string') ||
          (raw.patch.data !== undefined && !isRecord(raw.patch.data))
        ) {
          diagnostics.push(
            invalidShape('update-node has an invalid nodeId or patch', operationIndex, path),
          );
        }
        break;
      case 'remove-node':
        if (typeof raw.nodeId !== 'string' || !isStableId(raw.nodeId, 'node')) {
          diagnostics.push(
            invalidShape('remove-node requires a valid nodeId', operationIndex, `${path}.nodeId`),
          );
        }
        break;
      case 'connect':
      case 'disconnect':
        if (!validEndpoint(raw.from) || !validEndpoint(raw.to)) {
          diagnostics.push(
            invalidShape(`${raw.kind} requires valid from and to endpoints`, operationIndex, path),
          );
        }
        if (
          raw.kind === 'connect' &&
          raw.replaceExisting !== undefined &&
          typeof raw.replaceExisting !== 'boolean'
        ) {
          diagnostics.push(
            invalidShape(
              'replaceExisting must be a boolean',
              operationIndex,
              `${path}.replaceExisting`,
            ),
          );
        }
        break;
      case 'add-variable':
        if (!validVariable(raw.variable)) {
          diagnostics.push(
            invalidShape(
              'add-variable requires a valid scalar variable definition',
              operationIndex,
              `${path}.variable`,
            ),
          );
        }
        break;
      case 'update-variable':
        if (
          typeof raw.variableId !== 'string' ||
          !isStableId(raw.variableId, 'variable') ||
          !isRecord(raw.patch) ||
          (raw.patch.name !== undefined &&
            (typeof raw.patch.name !== 'string' || raw.patch.name.length === 0)) ||
          (raw.patch.displayName !== undefined &&
            (typeof raw.patch.displayName !== 'string' || raw.patch.displayName.length === 0)) ||
          (raw.patch.scope !== undefined &&
            raw.patch.scope !== 'story' &&
            raw.patch.scope !== 'chapter' &&
            raw.patch.scope !== 'local') ||
          (raw.patch.valueType !== undefined && !validValueType(raw.patch.valueType)) ||
          (raw.patch.defaultValue !== undefined && !validRuntimeValue(raw.patch.defaultValue))
        ) {
          diagnostics.push(
            invalidShape(
              'update-variable has an invalid variableId or patch',
              operationIndex,
              path,
            ),
          );
        }
        break;
      case 'add-condition':
        if (!validCondition(raw.condition)) {
          diagnostics.push(
            invalidShape(
              'add-condition requires a valid condition definition',
              operationIndex,
              path,
            ),
          );
        }
        break;
      case 'update-condition':
        if (
          typeof raw.conditionId !== 'string' ||
          !isStableId(raw.conditionId, 'condition') ||
          !isRecord(raw.patch) ||
          (raw.patch.name !== undefined &&
            (typeof raw.patch.name !== 'string' || raw.patch.name.trim().length === 0)) ||
          (raw.patch.displayName !== undefined &&
            (typeof raw.patch.displayName !== 'string' ||
              raw.patch.displayName.trim().length === 0)) ||
          (raw.patch.description !== undefined &&
            raw.patch.description !== null &&
            typeof raw.patch.description !== 'string') ||
          (raw.patch.root !== undefined && !validConditionTree(raw.patch.root))
        ) {
          diagnostics.push(invalidShape('update-condition is invalid', operationIndex, path));
        }
        break;
      case 'remove-condition':
        if (typeof raw.conditionId !== 'string' || !isStableId(raw.conditionId, 'condition')) {
          diagnostics.push(
            invalidShape(
              'remove-condition requires a valid conditionId',
              operationIndex,
              `${path}.conditionId`,
            ),
          );
        }
        break;
      case 'add-dialogue-line':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          !validLineInput(raw.line) ||
          (raw.afterLineId !== undefined &&
            (typeof raw.afterLineId !== 'string' || !isStableId(raw.afterLineId, 'line')))
        ) {
          diagnostics.push(invalidShape('add-dialogue-line is invalid', operationIndex, path));
        }
        break;
      case 'update-dialogue-line':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          typeof raw.lineId !== 'string' ||
          !isStableId(raw.lineId, 'line') ||
          !isRecord(raw.patch) ||
          (raw.patch.text !== undefined && typeof raw.patch.text !== 'string') ||
          (raw.patch.speakerId !== undefined &&
            raw.patch.speakerId !== null &&
            (typeof raw.patch.speakerId !== 'string' ||
              !isStableId(raw.patch.speakerId, 'character'))) ||
          (raw.patch.voiceId !== undefined &&
            raw.patch.voiceId !== null &&
            (typeof raw.patch.voiceId !== 'string' || !isStableId(raw.patch.voiceId, 'asset'))) ||
          (raw.patch.emotion !== undefined &&
            raw.patch.emotion !== null &&
            typeof raw.patch.emotion !== 'string') ||
          (raw.patch.tags !== undefined && !validStringArray(raw.patch.tags))
        ) {
          diagnostics.push(invalidShape('update-dialogue-line is invalid', operationIndex, path));
        }
        break;
      case 'remove-dialogue-line':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          typeof raw.lineId !== 'string' ||
          !isStableId(raw.lineId, 'line')
        ) {
          diagnostics.push(invalidShape('remove-dialogue-line is invalid', operationIndex, path));
        }
        break;
      case 'add-choice-option':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          !validChoiceOptionInput(raw.option) ||
          (raw.afterOptionId !== undefined &&
            (typeof raw.afterOptionId !== 'string' || !isStableId(raw.afterOptionId, 'option')))
        ) {
          diagnostics.push(invalidShape('add-choice-option is invalid', operationIndex, path));
        }
        break;
      case 'update-choice-option':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          typeof raw.optionId !== 'string' ||
          !isStableId(raw.optionId, 'option') ||
          !isRecord(raw.patch) ||
          (raw.patch.text !== undefined && typeof raw.patch.text !== 'string') ||
          (raw.patch.visibleIf !== undefined &&
            raw.patch.visibleIf !== null &&
            typeof raw.patch.visibleIf !== 'string') ||
          (raw.patch.enabledIf !== undefined &&
            raw.patch.enabledIf !== null &&
            typeof raw.patch.enabledIf !== 'string') ||
          (raw.patch.visibleConditionId !== undefined &&
            raw.patch.visibleConditionId !== null &&
            (typeof raw.patch.visibleConditionId !== 'string' ||
              !isStableId(raw.patch.visibleConditionId, 'condition'))) ||
          (raw.patch.enabledConditionId !== undefined &&
            raw.patch.enabledConditionId !== null &&
            (typeof raw.patch.enabledConditionId !== 'string' ||
              !isStableId(raw.patch.enabledConditionId, 'condition')))
        ) {
          diagnostics.push(invalidShape('update-choice-option is invalid', operationIndex, path));
        }
        break;
      case 'remove-choice-option':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          typeof raw.optionId !== 'string' ||
          !isStableId(raw.optionId, 'option')
        ) {
          diagnostics.push(invalidShape('remove-choice-option is invalid', operationIndex, path));
        }
        break;
      case 'set-expression':
        if (
          typeof raw.nodeId !== 'string' ||
          !isStableId(raw.nodeId, 'node') ||
          !validExpressionTarget(raw.target) ||
          (raw.source !== null && typeof raw.source !== 'string')
        ) {
          diagnostics.push(invalidShape('set-expression is invalid', operationIndex, path));
        }
        break;
      case 'add-character':
        if (!validCharacter(raw.character)) {
          diagnostics.push(
            invalidShape(
              'add-character requires a valid character definition',
              operationIndex,
              `${path}.character`,
            ),
          );
        }
        break;
      case 'add-substory':
        if (!isRecord(raw.substory)) {
          diagnostics.push(
            invalidShape('add-substory requires a substory object', operationIndex, path),
          );
          break;
        }
        if (
          typeof raw.substory.id !== 'string' ||
          !isStableId(raw.substory.id, 'chapter') ||
          typeof raw.substory.name !== 'string' ||
          raw.substory.name.trim().length === 0 ||
          typeof raw.substory.displayName !== 'string' ||
          raw.substory.displayName.trim().length === 0 ||
          !Array.isArray(raw.substory.parameters) ||
          !raw.substory.parameters.every(validVariable) ||
          !Array.isArray(raw.substory.outputs) ||
          !raw.substory.outputs.every(validVariable) ||
          !Array.isArray(raw.substory.localVariables) ||
          !raw.substory.localVariables.every(validVariable) ||
          !Array.isArray(raw.substory.nodes) ||
          !raw.substory.nodes.every(
            (node) =>
              isRecord(node) &&
              typeof node.id === 'string' &&
              isStableId(node.id, 'node') &&
              typeof node.type === 'string' &&
              Object.values(StoryNodeType).includes(node.type as StoryNodeType) &&
              isRecord(node.data) &&
              (node.name === undefined || typeof node.name === 'string'),
          ) ||
          !Array.isArray(raw.substory.edges) ||
          !raw.substory.edges.every(
            (edge) => isRecord(edge) && validEndpoint(edge.from) && validEndpoint(edge.to),
          )
        ) {
          diagnostics.push(
            invalidShape(
              'add-substory has invalid interface or initial graph',
              operationIndex,
              path,
            ),
          );
        }
        break;
      case 'update-substory':
        if (isRecord(raw.patch)) {
          diagnostics.push(
            ...unexpectedKeyDiagnostics(
              raw.patch,
              ['name', 'displayName', 'parameters', 'outputs', 'localVariables'],
              `${path}.patch`,
              operationIndex,
            ),
          );
        }
        if (
          typeof raw.chapterId !== 'string' ||
          !isStableId(raw.chapterId, 'chapter') ||
          !isRecord(raw.patch) ||
          Object.keys(raw.patch).length === 0 ||
          (raw.patch.name !== undefined &&
            (typeof raw.patch.name !== 'string' || raw.patch.name.trim().length === 0)) ||
          (raw.patch.displayName !== undefined &&
            (typeof raw.patch.displayName !== 'string' ||
              raw.patch.displayName.trim().length === 0)) ||
          (raw.patch.parameters !== undefined &&
            (!Array.isArray(raw.patch.parameters) || !raw.patch.parameters.every(validVariable))) ||
          (raw.patch.outputs !== undefined &&
            (!Array.isArray(raw.patch.outputs) || !raw.patch.outputs.every(validVariable))) ||
          (raw.patch.localVariables !== undefined &&
            (!Array.isArray(raw.patch.localVariables) ||
              !raw.patch.localVariables.every(validVariable)))
        ) {
          diagnostics.push(
            invalidShape('update-substory has an invalid chapterId or patch', operationIndex, path),
          );
        }
        break;
      case 'add-character-from-template':
        if (
          typeof raw.templateName !== 'string' ||
          !raw.templateName ||
          !isRecord(raw.character) ||
          typeof raw.character.id !== 'string' ||
          !isStableId(raw.character.id, 'character') ||
          typeof raw.character.name !== 'string' ||
          !raw.character.name ||
          typeof raw.character.displayName !== 'string' ||
          !raw.character.displayName ||
          !isRecord(raw.fieldIds) ||
          !Object.values(raw.fieldIds).every(
            (fieldId) => typeof fieldId === 'string' && isStableId(fieldId, 'variable'),
          )
        ) {
          diagnostics.push(
            invalidShape('add-character-from-template has invalid fields', operationIndex, path),
          );
        }
        break;
      case 'update-character':
        if (isRecord(raw.patch)) {
          diagnostics.push(
            ...unexpectedKeyDiagnostics(
              raw.patch,
              [
                'name',
                'displayName',
                'description',
                'dialogueStyle',
                'tags',
                'metadata',
                'relationships',
                'defaultPortraitId',
                'emotions',
                'fields',
              ],
              `${path}.patch`,
              operationIndex,
            ),
          );
        }
        if (
          typeof raw.characterId !== 'string' ||
          !isStableId(raw.characterId, 'character') ||
          !isRecord(raw.patch) ||
          (raw.patch.name !== undefined &&
            (typeof raw.patch.name !== 'string' || raw.patch.name.length === 0)) ||
          (raw.patch.displayName !== undefined &&
            (typeof raw.patch.displayName !== 'string' || raw.patch.displayName.length === 0)) ||
          (raw.patch.description !== undefined &&
            raw.patch.description !== null &&
            typeof raw.patch.description !== 'string') ||
          (raw.patch.dialogueStyle !== undefined &&
            raw.patch.dialogueStyle !== null &&
            typeof raw.patch.dialogueStyle !== 'string') ||
          (raw.patch.tags !== undefined &&
            raw.patch.tags !== null &&
            (!validStringArray(raw.patch.tags) ||
              raw.patch.tags.some((tag) => !tag.trim()) ||
              new Set(raw.patch.tags).size !== raw.patch.tags.length)) ||
          (raw.patch.metadata !== undefined &&
            raw.patch.metadata !== null &&
            !validCharacterMetadata(raw.patch.metadata)) ||
          (raw.patch.relationships !== undefined &&
            raw.patch.relationships !== null &&
            !validRelationships(raw.patch.relationships, raw.characterId as CharacterId)) ||
          (raw.patch.defaultPortraitId !== undefined &&
            raw.patch.defaultPortraitId !== null &&
            (typeof raw.patch.defaultPortraitId !== 'string' ||
              !isStableId(raw.patch.defaultPortraitId, 'asset'))) ||
          (raw.patch.emotions !== undefined && !validEmotions(raw.patch.emotions)) ||
          (raw.patch.fields !== undefined &&
            (!Array.isArray(raw.patch.fields) || !raw.patch.fields.every(validCharacterField)))
        ) {
          diagnostics.push(
            invalidShape(
              'update-character has an invalid characterId or patch',
              operationIndex,
              path,
            ),
          );
        }
        break;
      case 'layout-selection':
      case 'layout-neighborhood':
        if (!validNodeIdArray(raw.nodeIds)) {
          diagnostics.push(
            invalidShape(
              `${raw.kind} requires one or more unique node IDs`,
              operationIndex,
              `${path}.nodeIds`,
            ),
          );
        }
        break;
      default:
        diagnostics.push(
          invalidShape(
            `Unsupported operation kind: ${String(raw.kind)}`,
            operationIndex,
            `${path}.kind`,
          ),
        );
    }
  });
  return diagnostics;
}

function graphFor(story: MutableStory, target: BlueprintGraphTarget): MutableGraph | undefined {
  if (target.kind === 'root') return story.root;
  return story.chapters.find((chapter) => chapter.id === target.chapterId)?.graph;
}

function graphNodes(graph: SourceGraph): GraphNodeLike[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: node.type as StoryNodeType,
    data: node.data as StoryNodeDataMap[StoryNodeType],
  }));
}

function graphEdges(graph: SourceGraph): GraphEdgeLike[] {
  return graph.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.from.nodeId,
    sourcePortId: edge.from.portId,
    target: edge.to.nodeId,
    targetPortId: edge.to.portId,
  }));
}

function nextPosition(graph: SourceGraph): { x: number; y: number } {
  if (graph.nodes.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...graph.nodes.map((node) => node.position.x)) + 240,
    y: Math.round(
      graph.nodes.reduce((total, node) => total + node.position.y, 0) / graph.nodes.length,
    ),
  };
}

function operationDiagnostic(
  operation: BlueprintCommand,
  operationIndex: number,
  code: BlueprintCommandDiagnostic['code'],
  message: string,
): BlueprintCommandDiagnostic {
  return { code, message, operationId: operation.operationId, operationIndex };
}

function allGraphs(story: MutableStory): MutableGraph[] {
  return [story.root, ...story.chapters.map((chapter) => chapter.graph)];
}

function insertAfter<T>(items: T[], item: T, afterIndex: number | undefined): T[] {
  if (afterIndex === undefined) return [...items, item];
  return [...items.slice(0, afterIndex + 1), item, ...items.slice(afterIndex + 1)];
}

function defaultMatchesType(value: RuntimeValue, type: ValueType): boolean {
  return runtimeValueMatchesType(value, type);
}

function characterFieldError(
  story: MutableStory,
  character: CharacterSource,
  excludeCharacterId?: string,
): string | undefined {
  const names = new Set<string>();
  const occupiedIds = new Set([
    ...story.variables.map((variable) => variable.id),
    ...story.characters
      .filter((candidate) => candidate.id !== excludeCharacterId)
      .flatMap((candidate) => candidate.fields ?? [])
      .map((field) => field.id),
  ]);
  for (const field of character.fields ?? []) {
    if (names.has(field.name)) return `Character field name already exists: ${field.name}`;
    if (occupiedIds.has(field.id)) return `Character field ID already exists: ${field.id}`;
    if (!defaultMatchesType(field.defaultValue, field.valueType)) {
      return `Character field ${field.name} default does not match ${field.valueType.kind}`;
    }
    names.add(field.name);
    occupiedIds.add(field.id);
  }
  return undefined;
}

function graphReferencesVariable(story: MutableStory, variableId: string): boolean {
  const containsReference = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsReference);
    if (!isRecord(value)) return false;
    if (value.variableId === variableId) return true;
    if (
      isRecord(value.bindings) &&
      Object.values(value.bindings).some((candidate) => candidate === variableId)
    ) {
      return true;
    }
    return Object.values(value).some(containsReference);
  };
  return allGraphs(story).some((graph) => graph.nodes.some((node) => containsReference(node.data)));
}

function conditionTreeUsesId(tree: ConditionTreeNode, conditionId: ConditionId): boolean {
  if (tree.kind === 'reference') return tree.conditionId === conditionId;
  if (tree.kind === 'not') return conditionTreeUsesId(tree.child, conditionId);
  if (tree.kind === 'all' || tree.kind === 'any') {
    return tree.children.some((child) => conditionTreeUsesId(child, conditionId));
  }
  return false;
}

function graphReferencesCondition(story: MutableStory, conditionId: ConditionId): boolean {
  const branchUses = allGraphs(story).some((graph) =>
    graph.nodes.some(
      (node) =>
        (node.type === StoryNodeType.Branch &&
          (node.data as unknown as StoryNodeDataMap[StoryNodeType.Branch]).conditionId ===
            conditionId) ||
        (node.type === StoryNodeType.Choice &&
          (node.data as unknown as ChoiceNodeData).options.some(
            (option) =>
              option.visibleConditionId === conditionId ||
              option.enabledConditionId === conditionId,
          )),
    ),
  );
  const conditionUses = story.conditions.some(
    (condition) => condition.id !== conditionId && conditionTreeUsesId(condition.root, conditionId),
  );
  return branchUses || conditionUses;
}

function applyOperation(
  story: MutableStory,
  operation: BlueprintCommand,
  operationIndex: number,
  options: BlueprintTransactionOptions,
): BlueprintCommandDiagnostic | undefined {
  if (operation.kind === 'add-substory') {
    if (story.chapters.some((chapter) => chapter.id === operation.substory.id)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Substory already exists: ${operation.substory.id}`,
      );
    }
    if (story.chapters.some((chapter) => chapter.name === operation.substory.name)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Substory name already exists: ${operation.substory.name}`,
      );
    }
    const nodeIds = new Set<string>();
    const nodes: SourceNode[] = [];
    for (const [index, node] of operation.substory.nodes.entries()) {
      const definition = commandRegistry.get(node.type);
      if (!definition) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_GRAPH',
          `Unknown node type: ${node.type}`,
        );
      }
      if (nodeIds.has(node.id)) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'DUPLICATE_NODE_ID',
          `Duplicate node ID in Substory: ${node.id}`,
        );
      }
      nodeIds.add(node.id);
      nodes.push({
        id: node.id,
        type: node.type,
        name: node.name,
        definitionVersion: definition.version,
        position: { x: index * 240, y: 120 },
        data: {
          ...definition.defaultData(),
          ...structuredClone(node.data),
        },
      } as unknown as SourceNode);
    }
    const startCount = nodes.filter((node) => node.type === StoryNodeType.Start).length;
    if (startCount !== 1) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_GRAPH',
        `New Substory must contain exactly one Story Entry; found ${startCount}`,
      );
    }
    const allVariableIds = [
      ...operation.substory.parameters,
      ...operation.substory.outputs,
      ...operation.substory.localVariables,
    ].map((variable) => variable.id);
    if (new Set(allVariableIds).size !== allVariableIds.length) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'Substory variable IDs must be unique',
      );
    }
    if (operation.substory.localVariables.some((variable) => variable.scope !== 'local')) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'Substory localVariables must use local scope',
      );
    }
    const edges = structuredClone(operation.substory.edges) as SourceEdge[];
    const chapter: StorySourceDocument['chapters'][number] = {
      id: operation.substory.id,
      name: operation.substory.name,
      displayName: operation.substory.displayName,
      parameters: structuredClone(operation.substory.parameters).map((variable) => ({
        variable,
        direction: 'input' as const,
      })),
      outputs: structuredClone(operation.substory.outputs).map((variable) => ({
        variable,
        direction: 'output' as const,
      })),
      localVariables: structuredClone(operation.substory.localVariables),
      graph: { nodes, edges },
    };
    story.chapters.push(chapter as MutableChapter);
    return undefined;
  }
  if (operation.kind === 'update-substory') {
    const chapterIndex = story.chapters.findIndex((chapter) => chapter.id === operation.chapterId);
    if (chapterIndex < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Substory does not exist: ${operation.chapterId}`,
      );
    }
    const previous = story.chapters[chapterIndex]!;
    const patch = structuredClone(operation.patch);
    const parameters = patch.parameters ?? previous.parameters.map((item) => item.variable);
    const outputs = patch.outputs ?? previous.outputs.map((item) => item.variable);
    const localVariables = patch.localVariables ?? previous.localVariables;
    const interfaceVariables = [...parameters, ...outputs, ...localVariables];
    const interfaceIds = new Set(interfaceVariables.map((variable) => variable.id));
    const interfaceNames = new Set(interfaceVariables.map((variable) => variable.name));
    if (interfaceIds.size !== interfaceVariables.length) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'Substory parameter, output, and local variable IDs must be unique',
      );
    }
    if (interfaceNames.size !== interfaceVariables.length) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'Substory parameter, output, and local variable names must be unique',
      );
    }
    if (
      interfaceVariables.some(
        (variable) => !defaultMatchesType(variable.defaultValue, variable.valueType),
      )
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'Every Substory interface default value must match its value type',
      );
    }
    const previousById = new Map(
      [
        ...previous.parameters.map((item) => item.variable),
        ...previous.outputs.map((item) => item.variable),
        ...previous.localVariables,
      ].map((variable) => [variable.id, variable]),
    );
    const nextName = patch.name ?? previous.name;
    if (
      story.chapters.some(
        (candidate, index) => index !== chapterIndex && candidate.name === nextName,
      )
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Substory name already exists: ${nextName}`,
      );
    }

    const nextParameters = parameters.map((variable) => ({
      direction: 'input' as const,
      variable: { ...variable, scope: 'local' as const },
    }));
    const nextOutputs = outputs.map((variable) => ({
      direction: 'output' as const,
      variable: { ...variable, scope: 'local' as const },
    }));
    const nextLocals = localVariables.map((variable) => ({ ...variable, scope: 'local' as const }));
    const nextOutputById = new Map(nextOutputs.map((item) => [item.variable.id, item.variable]));
    const previousParameterById = new Map(
      previous.parameters.map((item) => [item.variable.id, item.variable]),
    );
    const previousOutputById = new Map(
      previous.outputs.map((item) => [item.variable.id, item.variable]),
    );
    const renames = new Map<VariableId, { oldName: string; newName: string }>();
    for (const variable of interfaceVariables) {
      const old = previousById.get(variable.id);
      if (old && old.name !== variable.name) {
        renames.set(variable.id, { oldName: old.name, newName: variable.name });
      }
    }
    const sameValueType = (left: ValueType | undefined, right: ValueType) =>
      left !== undefined && JSON.stringify(left) === JSON.stringify(right);
    const fallbackExpression = (variable: VariableDefinition) => ({
      source: JSON.stringify(variable.defaultValue),
      bindings: {},
    });
    const rewriteGraph = (graph: MutableGraph, containsReturns: boolean): MutableGraph => {
      const nodes = graph.nodes.map((node): SourceNode => {
        if (
          node.type === StoryNodeType.CallSubstory &&
          (node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory]).chapterId ===
            operation.chapterId
        ) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
          return {
            ...node,
            data: rewriteBoundReferences(
              {
                ...data,
                arguments: Object.fromEntries(
                  nextParameters.map((parameter) => {
                    const old = previousParameterById.get(parameter.variable.id);
                    const previousValue = data.arguments?.[parameter.variable.id];
                    return [
                      parameter.variable.id,
                      old &&
                      previousValue &&
                      sameValueType(old.valueType, parameter.variable.valueType)
                        ? previousValue
                        : fallbackExpression(parameter.variable),
                    ];
                  }),
                ),
                argumentInputTypes: Object.fromEntries(
                  nextParameters.map((parameter) => [
                    parameter.variable.id,
                    parameter.variable.valueType,
                  ]),
                ),
                outputPorts: nextOutputs.map((output) => ({
                  id: output.variable.id,
                  label: output.variable.displayName,
                  valueType: output.variable.valueType,
                })),
                resultVariableIds: Object.fromEntries(
                  Object.entries(data.resultVariableIds ?? {}).filter(([outputId]) =>
                    nextOutputById.has(outputId as VariableId),
                  ),
                ),
              } as unknown as Record<string, unknown>,
              renames,
            ) as StoryNodeDataMap[StoryNodeType.CallSubstory],
          } as unknown as SourceNode;
        }
        if (containsReturns && node.type === StoryNodeType.Return) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.Return];
          return {
            ...node,
            data: rewriteBoundReferences(
              {
                ...data,
                values: Object.fromEntries(
                  nextOutputs.map((output) => {
                    const old = previousOutputById.get(output.variable.id);
                    const previousValue = data.values?.[output.variable.id];
                    return [
                      output.variable.id,
                      old &&
                      previousValue &&
                      sameValueType(old.valueType, output.variable.valueType)
                        ? previousValue
                        : fallbackExpression(output.variable),
                    ];
                  }),
                ),
                valueInputTypes: Object.fromEntries(
                  nextOutputs.map((output) => [output.variable.id, output.variable.valueType]),
                ),
              } as unknown as Record<string, unknown>,
              renames,
            ) as StoryNodeDataMap[StoryNodeType.Return],
          } as unknown as SourceNode;
        }
        return renames.size === 0
          ? node
          : ({
              ...node,
              data: rewriteBoundReferences(
                node.data as unknown as Record<string, unknown>,
                renames,
              ) as StoryNodeDataMap[StoryNodeType],
            } as unknown as SourceNode);
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const portsById = new Map(
        nodes.map((node) => [
          node.id,
          new Map(
            resolveNodePorts(node as unknown as GraphNodeLike, commandRegistry).ports.map(
              (port) => [port.id, port],
            ),
          ),
        ]),
      );
      const isAffectedDataEdge = (edge: SourceEdge) => {
        const source = byId.get(edge.from.nodeId);
        const target = byId.get(edge.to.nodeId);
        const sourceCall =
          source?.type === StoryNodeType.CallSubstory &&
          (source.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory]).chapterId ===
            operation.chapterId &&
          edge.from.portId.startsWith('output:');
        const targetCall =
          target?.type === StoryNodeType.CallSubstory &&
          (target.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory]).chapterId ===
            operation.chapterId &&
          edge.to.portId.startsWith('argument:');
        const targetReturn =
          containsReturns &&
          target?.type === StoryNodeType.Return &&
          edge.to.portId.startsWith('value:');
        return sourceCall || targetCall || targetReturn;
      };
      return {
        nodes,
        edges: graph.edges.filter((edge) => {
          if (!isAffectedDataEdge(edge)) return true;
          const sourcePort = portsById.get(edge.from.nodeId)?.get(edge.from.portId);
          const targetPort = portsById.get(edge.to.nodeId)?.get(edge.to.portId);
          return (
            sourcePort?.kind === 'data' &&
            targetPort?.kind === 'data' &&
            valueTypesCompatible(sourcePort.valueType, targetPort.valueType)
          );
        }),
      };
    };

    const nextChapter: MutableChapter = {
      ...previous,
      name: nextName,
      displayName: patch.displayName ?? previous.displayName,
      parameters: nextParameters,
      outputs: nextOutputs,
      localVariables: nextLocals,
      graph: rewriteGraph(previous.graph, true),
    };
    story.chapters[chapterIndex] = nextChapter as MutableStory['chapters'][number];
    story.root = rewriteGraph(story.root, false);
    story.chapters = story.chapters.map((chapter) =>
      chapter.id === operation.chapterId
        ? chapter
        : { ...chapter, graph: rewriteGraph(chapter.graph, false) },
    ) as MutableStory['chapters'];
    return undefined;
  }
  if (operation.kind === 'add-condition') {
    if (story.conditions.some((condition) => condition.id === operation.condition.id)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_CONDITION_ID',
        `Condition already exists: ${operation.condition.id}`,
      );
    }
    if (story.conditions.some((condition) => condition.name === operation.condition.name)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Condition name already exists: ${operation.condition.name}`,
      );
    }
    const nextConditions = [...story.conditions, structuredClone(operation.condition)];
    const cycle = findConditionReferenceCycle(nextConditions);
    if (cycle) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Condition reference cycle detected: ${cycle.join(' -> ')}`,
      );
    }
    story.conditions = nextConditions;
    return undefined;
  }
  if (operation.kind === 'update-condition') {
    const index = story.conditions.findIndex((condition) => condition.id === operation.conditionId);
    if (index < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_CONDITION',
        `Condition does not exist: ${operation.conditionId}`,
      );
    }
    const previous = story.conditions[index]!;
    const patch = structuredClone(operation.patch);
    if (patch.name !== undefined && patch.displayName === undefined) patch.displayName = patch.name;
    const next: ConditionSource = {
      ...previous,
      ...patch,
      description:
        patch.description === null ? undefined : (patch.description ?? previous.description),
      root: patch.root ?? previous.root,
      id: previous.id,
    };
    if (
      story.conditions.some(
        (condition, candidateIndex) => candidateIndex !== index && condition.name === next.name,
      )
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Condition name already exists: ${next.name}`,
      );
    }
    const nextConditions = story.conditions.map((condition, candidateIndex) =>
      candidateIndex === index ? next : condition,
    );
    const cycle = findConditionReferenceCycle(nextConditions);
    if (cycle) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Condition reference cycle detected: ${cycle.join(' -> ')}`,
      );
    }
    story.conditions = nextConditions;
    return undefined;
  }
  if (operation.kind === 'remove-condition') {
    const condition = story.conditions.find((candidate) => candidate.id === operation.conditionId);
    if (!condition) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_CONDITION',
        `Condition does not exist: ${operation.conditionId}`,
      );
    }
    if (graphReferencesCondition(story, operation.conditionId)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Condition is still referenced: ${operation.conditionId}`,
      );
    }
    story.conditions = story.conditions.filter(
      (candidate) => candidate.id !== operation.conditionId,
    );
    return undefined;
  }
  if (operation.kind === 'add-variable') {
    if (story.variables.some((variable) => variable.id === operation.variable.id)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_VARIABLE_ID',
        `Variable already exists: ${operation.variable.id}`,
      );
    }
    if (story.variables.some((variable) => variable.name === operation.variable.name)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Variable name already exists: ${operation.variable.name}`,
      );
    }
    if (!defaultMatchesType(operation.variable.defaultValue, operation.variable.valueType)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Default value does not match ${operation.variable.valueType.kind}`,
      );
    }
    story.variables = [...story.variables, structuredClone(operation.variable)];
    return undefined;
  }
  if (operation.kind === 'update-variable') {
    const index = story.variables.findIndex((variable) => variable.id === operation.variableId);
    if (index < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_VARIABLE',
        `Variable does not exist: ${operation.variableId}`,
      );
    }
    const previous = story.variables[index]!;
    const patch = structuredClone(operation.patch);
    if (patch.name !== undefined && patch.displayName === undefined) {
      patch.displayName = patch.name;
    }
    const next = { ...previous, ...patch, id: previous.id };
    if (
      story.variables.some(
        (variable, candidateIndex) => candidateIndex !== index && variable.name === next.name,
      )
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Variable name already exists: ${next.name}`,
      );
    }
    if (!defaultMatchesType(next.defaultValue, next.valueType)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Default value does not match ${next.valueType.kind}`,
      );
    }
    story.variables[index] = next;
    return undefined;
  }
  if (operation.kind === 'add-character') {
    if (story.characters.some((character) => character.id === operation.character.id)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_CHARACTER_ID',
        `Character already exists: ${operation.character.id}`,
      );
    }
    if (story.characters.some((character) => character.name === operation.character.name)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Character name already exists: ${operation.character.name}`,
      );
    }
    const fieldError = characterFieldError(story, operation.character);
    if (fieldError) {
      return operationDiagnostic(operation, operationIndex, 'INVALID_TARGET', fieldError);
    }
    story.characters.push(structuredClone(operation.character));
    return undefined;
  }
  if (operation.kind === 'add-character-from-template') {
    const template = options.semanticContext?.characterTemplates?.find(
      (candidate) => candidate.name === operation.templateName,
    );
    if (!template) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Character template does not exist: ${operation.templateName}`,
      );
    }
    const fieldNames = new Set((template.fields ?? []).map((field) => field.name));
    if (
      Object.keys(operation.fieldIds).some((name) => !fieldNames.has(name)) ||
      [...fieldNames].some((name) => !operation.fieldIds[name]) ||
      new Set(Object.values(operation.fieldIds)).size !== Object.values(operation.fieldIds).length
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'fieldIds must map every template field name to a unique Variable ID',
      );
    }
    const character: CharacterSource = {
      ...structuredClone(template),
      ...operation.character,
      fields: template.fields?.map((field) => ({
        ...field,
        id: operation.fieldIds[field.name]!,
        scope: 'character',
      })),
    };
    return applyOperation(
      story,
      { ...operation, kind: 'add-character', character },
      operationIndex,
      options,
    );
  }
  if (operation.kind === 'update-character') {
    const index = story.characters.findIndex((character) => character.id === operation.characterId);
    if (index < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_CHARACTER',
        `Character does not exist: ${operation.characterId}`,
      );
    }
    const previous = story.characters[index]!;
    const patch = structuredClone(operation.patch);
    if (patch.name !== undefined && patch.displayName === undefined) patch.displayName = patch.name;
    const next: CharacterSource = {
      ...previous,
      ...patch,
      description:
        patch.description === null ? undefined : (patch.description ?? previous.description),
      dialogueStyle:
        patch.dialogueStyle === null ? undefined : (patch.dialogueStyle ?? previous.dialogueStyle),
      tags: patch.tags === null ? undefined : (patch.tags ?? previous.tags),
      metadata: patch.metadata === null ? undefined : (patch.metadata ?? previous.metadata),
      relationships:
        patch.relationships === null ? undefined : (patch.relationships ?? previous.relationships),
      defaultPortraitId:
        patch.defaultPortraitId === null
          ? undefined
          : (patch.defaultPortraitId ?? previous.defaultPortraitId),
      id: previous.id,
    };
    if (
      story.characters.some(
        (character, candidateIndex) => candidateIndex !== index && character.name === next.name,
      )
    ) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Character name already exists: ${next.name}`,
      );
    }
    const fieldError = characterFieldError(story, next, previous.id);
    if (fieldError) {
      return operationDiagnostic(operation, operationIndex, 'INVALID_TARGET', fieldError);
    }
    for (const field of previous.fields ?? []) {
      const nextField = next.fields?.find((candidate) => candidate.id === field.id);
      if (
        (!nextField || nextField.valueType.kind !== field.valueType.kind) &&
        graphReferencesVariable(story, field.id)
      ) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_TARGET',
          `Character field ${previous.name}.${field.name} is referenced and cannot be removed or retyped`,
        );
      }
    }
    story.characters[index] = next;
    return undefined;
  }
  const graph = graphFor(story, operation.graph);
  if (!graph) {
    return operationDiagnostic(
      operation,
      operationIndex,
      'UNKNOWN_GRAPH',
      'Target graph does not exist',
    );
  }
  if (operation.kind === 'add-node') {
    const duplicate = [story.root, ...story.chapters.map((chapter) => chapter.graph)].some(
      (candidate) => candidate.nodes.some((node) => node.id === operation.node.id),
    );
    if (duplicate) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_NODE_ID',
        `Node already exists: ${operation.node.id}`,
      );
    }
    const definition = commandRegistry.get(operation.node.type);
    if (!definition) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_GRAPH',
        `Unknown node type: ${operation.node.type}`,
      );
    }
    const data = {
      ...definition.defaultData(),
      ...structuredClone(operation.node.data),
    } as Record<string, unknown>;
    if (operation.node.type === StoryNodeType.CallEvent) {
      const call = data as unknown as StoryNodeDataMap[StoryNodeType.CallEvent];
      const event = options.semanticContext?.events.find(
        (candidate) => candidate.id === call.eventId,
      );
      if (event) {
        call.outputPorts = (event.outputs ?? []).map((output) => ({
          id: output.id,
          label: output.displayName,
          valueType: output.valueType,
        }));
      }
    }
    if (operation.node.type === StoryNodeType.CallSubstory) {
      const call = data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      const chapter = story.chapters.find((candidate) => candidate.id === call.chapterId);
      if (chapter) {
        call.argumentInputTypes = Object.fromEntries(
          chapter.parameters.map((parameter) => [
            parameter.variable.id,
            parameter.variable.valueType,
          ]),
        );
        call.outputPorts = chapter.outputs.map((output) => ({
          id: output.variable.id,
          label: output.variable.displayName,
          valueType: output.variable.valueType,
        }));
      }
    }
    if (operation.node.type === StoryNodeType.Return) {
      const returnNode = data as unknown as StoryNodeDataMap[StoryNodeType.Return];
      const chapterId = operation.graph.kind === 'chapter' ? operation.graph.chapterId : undefined;
      const chapter = story.chapters.find((candidate) => candidate.id === chapterId);
      if (chapter) {
        returnNode.valueInputTypes = Object.fromEntries(
          chapter.outputs.map((output) => [output.variable.id, output.variable.valueType]),
        );
      }
    }
    graph.nodes.push({
      id: operation.node.id,
      type: operation.node.type,
      name: operation.node.name,
      definitionVersion: definition.version,
      position: nextPosition(graph),
      data,
    } as unknown as SourceNode);
    return undefined;
  }
  if (operation.kind === 'add-variable-adjustment') {
    const duplicate = allGraphs(story).some((candidate) =>
      candidate.nodes.some((node) => node.id === operation.node.id),
    );
    if (duplicate) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_NODE_ID',
        `Node already exists: ${operation.node.id}`,
      );
    }
    const chapterId = operation.graph.kind === 'chapter' ? operation.graph.chapterId : undefined;
    const chapter = chapterId
      ? story.chapters.find((candidate) => candidate.id === chapterId)
      : undefined;
    const graphVariables = [
      ...story.variables,
      ...(chapter?.parameters.map((parameter) => parameter.variable) ?? []),
      ...(chapter?.localVariables ?? []),
    ];
    const variable = graphVariables.find((candidate) => candidate.id === operation.variableId);
    const characterField = story.characters
      .flatMap((character) => (character.fields ?? []).map((field) => ({ character, field })))
      .find(({ field }) => field.id === operation.variableId);
    const target = variable ?? characterField?.field;
    if (!target) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_VARIABLE',
        `Variable does not exist in the target graph: ${operation.variableId}`,
      );
    }
    if (target.valueType.kind !== 'number') {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        `Relative adjustment requires a number variable: ${target.name}`,
      );
    }
    const symbol = characterField
      ? `${characterField.character.name}.${characterField.field.name}`
      : target.name;
    const operator = operation.delta < 0 ? '-' : '+';
    const amount = Math.abs(operation.delta);
    const definition = commandRegistry.get(StoryNodeType.SetVariable)!;
    graph.nodes.push({
      id: operation.node.id,
      type: StoryNodeType.SetVariable,
      name: operation.node.name,
      definitionVersion: definition.version,
      position: nextPosition(graph),
      data: {
        variableId: target.id,
        value: {
          source: `${symbol} ${operator} ${amount}`,
          bindings: { [symbol]: target.id },
        },
      },
    });
    return undefined;
  }
  if (operation.kind === 'layout-selection' || operation.kind === 'layout-neighborhood') {
    const missingNodeId = operation.nodeIds.find(
      (nodeId) => !graph.nodes.some((node) => node.id === nodeId),
    );
    return missingNodeId
      ? operationDiagnostic(
          operation,
          operationIndex,
          'UNKNOWN_NODE',
          `Node does not exist: ${missingNodeId}`,
        )
      : undefined;
  }
  const nodeId =
    operation.kind === 'connect' || operation.kind === 'disconnect' ? undefined : operation.nodeId;
  const node = nodeId ? graph.nodes.find((candidate) => candidate.id === nodeId) : undefined;
  if (nodeId && !node) {
    return operationDiagnostic(
      operation,
      operationIndex,
      'UNKNOWN_NODE',
      `Node does not exist: ${nodeId}`,
    );
  }
  if (operation.kind === 'update-node') {
    if (!node) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_NODE',
        `Node does not exist: ${operation.nodeId}`,
      );
    }
    if (operation.patch.name === null) delete node.name;
    else if (operation.patch.name !== undefined) node.name = operation.patch.name;
    if (operation.patch.data) {
      node.data = { ...node.data, ...structuredClone(operation.patch.data) };
    }
    if (node.type === StoryNodeType.CallEvent && options.semanticContext?.events) {
      const call = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallEvent];
      const event = options.semanticContext.events.find(
        (candidate) => candidate.id === call.eventId,
      );
      if (event) {
        call.outputPorts = (event.outputs ?? []).map((output) => ({
          id: output.id,
          label: output.displayName,
          valueType: output.valueType,
        }));
      }
    }
    return undefined;
  }
  if (operation.kind === 'add-dialogue-line') {
    if (!node || node.type !== StoryNodeType.Dialogue) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'add-dialogue-line requires a Dialogue node',
      );
    }
    const duplicate = allGraphs(story).some((candidate) =>
      candidate.nodes.some((candidateNode) => {
        if (candidateNode.type !== StoryNodeType.Dialogue) return false;
        const lines = (candidateNode.data as unknown as DialogueNodeData).lines;
        return lines.some(
          (line) => line.id === operation.line.id || line.textId === operation.line.textId,
        );
      }),
    );
    if (duplicate) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_LINE_ID',
        `Line or Text ID already exists: ${operation.line.id} / ${operation.line.textId}`,
      );
    }
    const data = node.data as unknown as DialogueNodeData;
    const afterIndex = operation.afterLineId
      ? data.lines.findIndex((line) => line.id === operation.afterLineId)
      : undefined;
    if (operation.afterLineId && afterIndex === -1) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_LINE',
        `Insertion line does not exist: ${operation.afterLineId}`,
      );
    }
    const line = {
      ...structuredClone(operation.line),
      text: { source: operation.line.text },
    };
    node.data = { ...data, lines: insertAfter(data.lines, line, afterIndex) };
    return undefined;
  }
  if (operation.kind === 'update-dialogue-line') {
    if (!node || node.type !== StoryNodeType.Dialogue) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'update-dialogue-line requires a Dialogue node',
      );
    }
    const data = node.data as unknown as DialogueNodeData;
    const index = data.lines.findIndex((line) => line.id === operation.lineId);
    if (index < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_LINE',
        `Dialogue line does not exist: ${operation.lineId}`,
      );
    }
    const next = structuredClone(data.lines[index]!);
    if (operation.patch.text !== undefined) next.text = { source: operation.patch.text };
    if (operation.patch.speakerId === null) delete next.speakerId;
    else if (operation.patch.speakerId !== undefined) next.speakerId = operation.patch.speakerId;
    if (operation.patch.voiceId === null) delete next.voiceId;
    else if (operation.patch.voiceId !== undefined) next.voiceId = operation.patch.voiceId;
    if (operation.patch.emotion === null) delete next.emotion;
    else if (operation.patch.emotion !== undefined) next.emotion = operation.patch.emotion;
    if (operation.patch.tags !== undefined) next.tags = [...operation.patch.tags];
    node.data = {
      ...data,
      lines: data.lines.map((line, candidateIndex) => (candidateIndex === index ? next : line)),
    };
    return undefined;
  }
  if (operation.kind === 'remove-dialogue-line') {
    if (!node || node.type !== StoryNodeType.Dialogue) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'remove-dialogue-line requires a Dialogue node',
      );
    }
    const data = node.data as unknown as DialogueNodeData;
    if (!data.lines.some((line) => line.id === operation.lineId)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_LINE',
        `Dialogue line does not exist: ${operation.lineId}`,
      );
    }
    node.data = { ...data, lines: data.lines.filter((line) => line.id !== operation.lineId) };
    return undefined;
  }
  if (operation.kind === 'add-choice-option') {
    if (!node || node.type !== StoryNodeType.Choice) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'add-choice-option requires a Choice node',
      );
    }
    const duplicate = allGraphs(story).some((candidate) =>
      candidate.nodes.some(
        (candidateNode) =>
          candidateNode.type === StoryNodeType.Choice &&
          (candidateNode.data as unknown as ChoiceNodeData).options.some(
            (option) => option.id === operation.option.id,
          ),
      ),
    );
    if (duplicate) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'DUPLICATE_OPTION_ID',
        `Choice option already exists: ${operation.option.id}`,
      );
    }
    const data = node.data as unknown as ChoiceNodeData;
    const afterIndex = operation.afterOptionId
      ? data.options.findIndex((option) => option.id === operation.afterOptionId)
      : undefined;
    if (operation.afterOptionId && afterIndex === -1) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_OPTION',
        `Insertion option does not exist: ${operation.afterOptionId}`,
      );
    }
    const option = {
      id: operation.option.id,
      text: { source: operation.option.text },
      visibleIf: operation.option.visibleIf
        ? { source: operation.option.visibleIf, bindings: {} }
        : undefined,
      enabledIf: operation.option.enabledIf
        ? { source: operation.option.enabledIf, bindings: {} }
        : undefined,
      visibleConditionId: operation.option.visibleConditionId,
      enabledConditionId: operation.option.enabledConditionId,
    };
    node.data = { ...data, options: insertAfter(data.options, option, afterIndex) };
    return undefined;
  }
  if (operation.kind === 'update-choice-option') {
    if (!node || node.type !== StoryNodeType.Choice) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'update-choice-option requires a Choice node',
      );
    }
    const data = node.data as unknown as ChoiceNodeData;
    const index = data.options.findIndex((option) => option.id === operation.optionId);
    if (index < 0) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_OPTION',
        `Choice option does not exist: ${operation.optionId}`,
      );
    }
    const next = structuredClone(data.options[index]!);
    if (operation.patch.text !== undefined) next.text = { source: operation.patch.text };
    for (const property of ['visibleIf', 'enabledIf'] as const) {
      const value = operation.patch[property];
      if (value === null) delete next[property];
      else if (value !== undefined) next[property] = { source: value, bindings: {} };
    }
    for (const property of ['visibleConditionId', 'enabledConditionId'] as const) {
      const value = operation.patch[property];
      if (value === null) delete next[property];
      else if (value !== undefined) next[property] = value;
    }
    node.data = {
      ...data,
      options: data.options.map((option, candidateIndex) =>
        candidateIndex === index ? next : option,
      ),
    };
    return undefined;
  }
  if (operation.kind === 'remove-choice-option') {
    if (!node || node.type !== StoryNodeType.Choice) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'remove-choice-option requires a Choice node',
      );
    }
    const data = node.data as unknown as ChoiceNodeData;
    if (!data.options.some((option) => option.id === operation.optionId)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_OPTION',
        `Choice option does not exist: ${operation.optionId}`,
      );
    }
    node.data = {
      ...data,
      options: data.options.filter((option) => option.id !== operation.optionId),
    };
    graph.edges = graph.edges.filter(
      (edge) => edge.from.nodeId !== operation.nodeId || edge.from.portId !== operation.optionId,
    );
    return undefined;
  }
  if (operation.kind === 'set-expression') {
    if (!node) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_NODE',
        `Node does not exist: ${operation.nodeId}`,
      );
    }
    const expression =
      operation.source === null ? undefined : { source: operation.source, bindings: {} };
    if (operation.target.kind === 'branch-condition') {
      if (node.type !== StoryNodeType.Branch || !expression) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_TARGET',
          'branch-condition requires a Branch node and non-null source',
        );
      }
      node.data = {
        ...(node.data as unknown as StoryNodeDataMap[StoryNodeType.Branch]),
        condition: expression,
      };
      return undefined;
    }
    if (operation.target.kind === 'set-variable-value') {
      if (node.type !== StoryNodeType.SetVariable || !expression) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_TARGET',
          'set-variable-value requires a Set Variable node and non-null source',
        );
      }
      node.data = {
        ...(node.data as unknown as StoryNodeDataMap[StoryNodeType.SetVariable]),
        value: expression,
      };
      return undefined;
    }
    if (operation.target.kind === 'choice-visible' || operation.target.kind === 'choice-enabled') {
      if (node.type !== StoryNodeType.Choice) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_TARGET',
          'Choice expression target requires a Choice node',
        );
      }
      const data = node.data as unknown as ChoiceNodeData;
      const optionId = operation.target.optionId;
      const option = data.options.find((candidate) => candidate.id === optionId);
      if (!option) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'UNKNOWN_OPTION',
          `Choice option does not exist: ${optionId}`,
        );
      }
      const property = operation.target.kind === 'choice-visible' ? 'visibleIf' : 'enabledIf';
      const next = { ...option };
      if (expression) next[property] = expression;
      else delete next[property];
      node.data = {
        ...data,
        options: data.options.map((candidate) => (candidate.id === optionId ? next : candidate)),
      };
      return undefined;
    }
    if (operation.target.kind === 'event-argument') {
      if (node.type !== StoryNodeType.CallEvent) {
        return operationDiagnostic(
          operation,
          operationIndex,
          'INVALID_TARGET',
          'event-argument requires a Call Event node',
        );
      }
      const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallEvent];
      const argumentsMap = { ...data.arguments };
      if (expression) argumentsMap[operation.target.parameterName] = expression;
      else delete argumentsMap[operation.target.parameterName];
      node.data = { ...data, arguments: argumentsMap };
      return undefined;
    }
    if (node.type !== StoryNodeType.WaitSignal) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'INVALID_TARGET',
        'signal-match requires a Wait Signal node',
      );
    }
    const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.WaitSignal];
    const matches = { ...data.matches };
    if (expression) matches[operation.target.parameterName] = expression;
    else delete matches[operation.target.parameterName];
    node.data = { ...data, matches };
    return undefined;
  }
  if (operation.kind === 'remove-node') {
    graph.nodes = graph.nodes.filter((candidate) => candidate.id !== operation.nodeId);
    graph.edges = graph.edges.filter(
      (edge) => edge.from.nodeId !== operation.nodeId && edge.to.nodeId !== operation.nodeId,
    );
    return undefined;
  }
  const matchesConnection = (edge: SourceEdge) =>
    edge.from.nodeId === operation.from.nodeId &&
    edge.from.portId === operation.from.portId &&
    edge.to.nodeId === operation.to.nodeId &&
    edge.to.portId === operation.to.portId;
  if (operation.kind === 'disconnect') {
    if (!graph.edges.some(matchesConnection)) {
      return operationDiagnostic(
        operation,
        operationIndex,
        'UNKNOWN_CONNECTION',
        'Connection does not exist',
      );
    }
    graph.edges = graph.edges.filter((edge) => !matchesConnection(edge));
    return undefined;
  }
  // Hydrate dynamic pin contracts when a transaction touches a node. This keeps
  // command-created links valid without requiring the model to emit UI metadata.
  for (const endpointId of [operation.from.nodeId, operation.to.nodeId]) {
    const endpoint = graph.nodes.find((candidate) => candidate.id === endpointId);
    if (!endpoint) continue;
    if (endpoint.type === StoryNodeType.CallEvent) {
      const call = endpoint.data as unknown as StoryNodeDataMap[StoryNodeType.CallEvent];
      if (call.outputPorts === undefined) {
        const event = options.semanticContext?.events.find(
          (candidate) => candidate.id === call.eventId,
        );
        if (event) {
          call.outputPorts = (event.outputs ?? []).map((output) => ({
            id: output.id,
            label: output.displayName,
            valueType: output.valueType,
          }));
        }
      }
    } else if (endpoint.type === StoryNodeType.CallSubstory) {
      const call = endpoint.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      const chapter = story.chapters.find((candidate) => candidate.id === call.chapterId);
      if (chapter) {
        call.argumentInputTypes = Object.fromEntries(
          chapter.parameters.map((parameter) => [
            parameter.variable.id,
            parameter.variable.valueType,
          ]),
        );
        call.outputPorts = chapter.outputs.map((output) => ({
          id: output.variable.id,
          label: output.variable.displayName,
          valueType: output.variable.valueType,
        }));
      }
    } else if (endpoint.type === StoryNodeType.Return) {
      const returnNode = endpoint.data as unknown as StoryNodeDataMap[StoryNodeType.Return];
      const chapterId = operation.graph.kind === 'chapter' ? operation.graph.chapterId : undefined;
      const chapter = story.chapters.find((candidate) => candidate.id === chapterId);
      if (chapter) {
        returnNode.valueInputTypes = Object.fromEntries(
          chapter.outputs.map((output) => [output.variable.id, output.variable.valueType]),
        );
      }
    }
  }
  let edges = graphEdges(graph);
  let validation = validateGraphConnection(
    {
      source: operation.from.nodeId,
      sourcePortId: operation.from.portId,
      target: operation.to.nodeId,
      targetPortId: operation.to.portId,
    },
    graphNodes(graph),
    edges,
    commandRegistry,
  );
  if (!validation.valid && operation.replaceExisting) {
    if (validation.diagnostic.code === 'OUTPUT_ALREADY_CONNECTED') {
      graph.edges = graph.edges.filter(
        (edge) =>
          edge.from.nodeId !== operation.from.nodeId || edge.from.portId !== operation.from.portId,
      );
    } else if (validation.diagnostic.code === 'INPUT_ALREADY_CONNECTED') {
      graph.edges = graph.edges.filter(
        (edge) => edge.to.nodeId !== operation.to.nodeId || edge.to.portId !== operation.to.portId,
      );
    }
    edges = graphEdges(graph);
    validation = validateGraphConnection(
      {
        source: operation.from.nodeId,
        sourcePortId: operation.from.portId,
        target: operation.to.nodeId,
        targetPortId: operation.to.portId,
      },
      graphNodes(graph),
      edges,
      commandRegistry,
    );
  }
  if (!validation.valid) {
    return operationDiagnostic(
      operation,
      operationIndex,
      'INVALID_CONNECTION',
      validation.diagnostic.message,
    );
  }
  graph.edges.push({ from: structuredClone(operation.from), to: structuredClone(operation.to) });
  return undefined;
}

function validateFinalGraph(story: StorySourceDocument): BlueprintCommandDiagnostic[] {
  const diagnostics: BlueprintCommandDiagnostic[] = [];
  const graphs = [story.root, ...story.chapters.map((chapter) => chapter.graph)];
  const nodeIds = new Set<string>();
  for (const graph of graphs) {
    const entries = graph.nodes.filter((node) => node.type === StoryNodeType.Start);
    if (entries.length !== 1) {
      diagnostics.push({
        code: 'INVALID_GRAPH',
        message: `Each graph requires exactly one Story Entry; found ${entries.length}`,
      });
    }
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        diagnostics.push({
          code: 'DUPLICATE_NODE_ID',
          message: `Node ID is duplicated: ${node.id}`,
        });
      }
      nodeIds.add(node.id);
      const ports = resolveNodePorts(
        {
          id: node.id,
          type: node.type as StoryNodeType,
          data: node.data as StoryNodeDataMap[StoryNodeType],
        },
        commandRegistry,
      );
      diagnostics.push(
        ...ports.diagnostics.map((diagnostic) => ({
          code: 'INVALID_GRAPH' as const,
          message: `${node.id}: ${diagnostic.message}`,
        })),
      );
    }
    const connectionValidator = createGraphConnectionValidator(
      graphNodes(graph),
      [],
      commandRegistry,
    );
    graph.edges.forEach((edge) => {
      const validation = connectionValidator.validate({
        source: edge.from.nodeId,
        sourcePortId: edge.from.portId,
        target: edge.to.nodeId,
        targetPortId: edge.to.portId,
      });
      if (!validation.valid) {
        diagnostics.push({ code: 'INVALID_CONNECTION', message: validation.diagnostic.message });
      }
    });
  }
  try {
    serializeStorySource({
      ...story,
      variables: story.variables.filter((variable) => variable.scope !== 'project'),
      events: [],
      signals: [],
    });
  } catch (error) {
    diagnostics.push({
      code: 'INVALID_GRAPH',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return diagnostics;
}

/** Executes on a clone. Callers opt into using the returned document; failures never mutate input. */
export function executeBlueprintCommandTransaction(
  source: StorySourceDocument,
  transactionValue: unknown,
  options: BlueprintTransactionOptions = {},
): BlueprintTransactionResult {
  const shapeDiagnostics = validateBlueprintCommandTransaction(transactionValue);
  if (shapeDiagnostics.length > 0) {
    return { ok: false, committed: false, document: source, diagnostics: shapeDiagnostics };
  }
  const transaction = transactionValue as BlueprintCommandTransaction;
  const currentSnapshot = createStorySemanticSnapshot(
    withSemanticContext(source, options.semanticContext),
    options.semanticContext?.characterTemplates,
    options.semanticContext?.engineTypes,
  );
  if (transaction.baseRevision !== currentSnapshot.revision) {
    return {
      ok: false,
      committed: false,
      document: source,
      diagnostics: [
        {
          code: 'REVISION_CONFLICT',
          message: `Expected ${transaction.baseRevision}, current revision is ${currentSnapshot.revision}`,
        },
      ],
    };
  }
  const hasCharacterOperations = transaction.operations.some(
    (operation) =>
      operation.kind === 'add-character' ||
      operation.kind === 'add-character-from-template' ||
      operation.kind === 'update-character',
  );
  const working = structuredClone(source) as unknown as MutableStory;
  working.conditions = structuredClone(
    options.semanticContext?.conditions ?? source.conditions ?? [],
  ) as ConditionSource[];
  if (options.semanticContext && hasCharacterOperations) {
    working.characters = structuredClone(options.semanticContext.characters) as CharacterSource[];
  }
  for (let index = 0; index < transaction.operations.length; index += 1) {
    const diagnostic = applyOperation(working, transaction.operations[index], index, options);
    if (diagnostic) {
      return { ok: false, committed: false, document: source, diagnostics: [diagnostic] };
    }
  }
  const document = working as unknown as StorySourceDocument;
  const finalDiagnostics = validateFinalGraph(document);
  if (finalDiagnostics.length > 0) {
    return { ok: false, committed: false, document: source, diagnostics: finalDiagnostics };
  }
  return {
    ok: true,
    committed: options.dryRun !== true,
    document,
    snapshot: createStorySemanticSnapshot(
      hasCharacterOperations
        ? {
            ...withSemanticContext(document, options.semanticContext),
            characters: document.characters,
          }
        : withSemanticContext(document, options.semanticContext),
      options.semanticContext?.characterTemplates,
      options.semanticContext?.engineTypes,
    ),
    appliedOperationIds: transaction.operations.map((operation) => operation.operationId),
    layoutRequests: transaction.operations.filter(
      (operation): operation is BlueprintLayoutRequest =>
        operation.kind === 'layout-selection' || operation.kind === 'layout-neighborhood',
    ),
    diagnostics: [],
  };
}
