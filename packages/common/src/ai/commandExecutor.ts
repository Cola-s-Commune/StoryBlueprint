import {
  resolveNodePorts,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
} from '../graph/connectionValidation';
import { NodeRegistry } from '../registry/nodeRegistry';
import { serializeStorySource } from '../serialization/storyKdl';
import { isStableId } from '../types/ids';
import {
  StoryNodeType,
  type ChoiceNodeData,
  type DialogueNodeData,
  type StoryNodeDataMap,
} from '../types/nodes';
import type { SourceEdge, SourceGraph, SourceNode, StorySourceDocument } from '../types/source';
import type { RuntimeValue, ValueType, VariableDefinition } from '../types/values';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  type BlueprintCommand,
  type BlueprintCommandDiagnostic,
  type BlueprintCommandTransaction,
  type BlueprintGraphTarget,
} from './blueprintCommands';
import { createStorySemanticSnapshot, type StorySemanticSnapshot } from './semanticModel';

const commandRegistry = new NodeRegistry();
commandRegistry.registerBuiltins();

interface MutableGraph {
  nodes: SourceNode[];
  edges: SourceEdge[];
}

interface MutableChapter {
  id: string;
  graph: MutableGraph;
}

interface MutableStory extends Omit<StorySourceDocument, 'root' | 'chapters' | 'variables'> {
  root: MutableGraph;
  chapters: MutableChapter[] & StorySourceDocument['chapters'];
  variables: VariableDefinition[];
}

export type BlueprintTransactionResult =
  | {
      ok: true;
      committed: boolean;
      document: StorySourceDocument;
      snapshot: StorySemanticSnapshot;
      appliedOperationIds: readonly string[];
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
  return context ? { ...source, ...context } : source;
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

function validScalarType(value: unknown): value is ValueType {
  return (
    isRecord(value) &&
    (value.kind === 'boolean' || value.kind === 'number' || value.kind === 'string') &&
    (value.nullable === undefined || typeof value.nullable === 'boolean')
  );
}

function validRuntimeValue(value: unknown): value is RuntimeValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
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
    (value.scope === 'story' || value.scope === 'chapter' || value.scope === 'local') &&
    validScalarType(value.valueType) &&
    validRuntimeValue(value.defaultValue)
  );
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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
    (value.enabledIf === undefined || typeof value.enabledIf === 'string')
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
  return kind !== 'add-variable' && kind !== 'update-variable';
}

const operationKeys: Readonly<Record<string, readonly string[]>> = {
  'add-node': ['operationId', 'kind', 'graph', 'node'],
  'update-node': ['operationId', 'kind', 'graph', 'nodeId', 'patch'],
  'remove-node': ['operationId', 'kind', 'graph', 'nodeId'],
  connect: ['operationId', 'kind', 'graph', 'from', 'to', 'replaceExisting'],
  disconnect: ['operationId', 'kind', 'graph', 'from', 'to'],
  'add-variable': ['operationId', 'kind', 'variable'],
  'update-variable': ['operationId', 'kind', 'variableId', 'patch'],
  'add-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'line', 'afterLineId'],
  'update-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'lineId', 'patch'],
  'remove-dialogue-line': ['operationId', 'kind', 'graph', 'nodeId', 'lineId'],
  'add-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'option', 'afterOptionId'],
  'update-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'optionId', 'patch'],
  'remove-choice-option': ['operationId', 'kind', 'graph', 'nodeId', 'optionId'],
  'set-expression': ['operationId', 'kind', 'graph', 'nodeId', 'target', 'source'],
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
          (raw.patch.valueType !== undefined && !validScalarType(raw.patch.valueType)) ||
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
            typeof raw.patch.enabledIf !== 'string')
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
  return value === null ? type.nullable === true : typeof value === type.kind;
}

function applyOperation(
  story: MutableStory,
  operation: BlueprintCommand,
  operationIndex: number,
): BlueprintCommandDiagnostic | undefined {
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
    graph.nodes.push({
      id: operation.node.id,
      type: operation.node.type,
      name: operation.node.name,
      definitionVersion: definition.version,
      position: nextPosition(graph),
      data: structuredClone(operation.node.data),
    } as unknown as SourceNode);
    return undefined;
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
    const accepted: GraphEdgeLike[] = [];
    graph.edges.forEach((edge, index) => {
      const validation = validateGraphConnection(
        {
          source: edge.from.nodeId,
          sourcePortId: edge.from.portId,
          target: edge.to.nodeId,
          targetPortId: edge.to.portId,
        },
        graphNodes(graph),
        accepted,
        commandRegistry,
      );
      if (!validation.valid) {
        diagnostics.push({ code: 'INVALID_CONNECTION', message: validation.diagnostic.message });
      } else {
        accepted.push({
          id: `edge-${index}`,
          source: edge.from.nodeId,
          sourcePortId: edge.from.portId,
          target: edge.to.nodeId,
          targetPortId: edge.to.portId,
        });
      }
    });
  }
  try {
    serializeStorySource({ ...story, events: [], signals: [] });
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
  const working = structuredClone(source) as unknown as MutableStory;
  for (let index = 0; index < transaction.operations.length; index += 1) {
    const diagnostic = applyOperation(working, transaction.operations[index], index);
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
    snapshot: createStorySemanticSnapshot(withSemanticContext(document, options.semanticContext)),
    appliedOperationIds: transaction.operations.map((operation) => operation.operationId),
    diagnostics: [],
  };
}
