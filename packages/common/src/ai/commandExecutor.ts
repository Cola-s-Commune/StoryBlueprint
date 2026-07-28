import {
  resolveNodePorts,
  validateGraphConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
} from '../graph/connectionValidation';
import { NodeRegistry } from '../registry/nodeRegistry';
import { serializeStorySource } from '../serialization/storyKdl';
import { isStableId } from '../types/ids';
import { StoryNodeType, type StoryNodeDataMap } from '../types/nodes';
import type { SourceEdge, SourceGraph, SourceNode, StorySourceDocument } from '../types/source';
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

interface MutableStory extends Omit<StorySourceDocument, 'root' | 'chapters'> {
  root: MutableGraph;
  chapters: MutableChapter[] & StorySourceDocument['chapters'];
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

/** Runtime shape validation for untrusted JSON produced by an AI or plugin. */
export function validateBlueprintCommandTransaction(
  value: unknown,
): readonly BlueprintCommandDiagnostic[] {
  if (!isRecord(value)) return [invalidShape('Command transaction must be an object')];
  if (value.format !== BLUEPRINT_COMMAND_FORMAT || value.version !== BLUEPRINT_COMMAND_VERSION) {
    return [
      invalidShape(`Unsupported command format ${String(value.format)}@${String(value.version)}`),
    ];
  }
  if (value.baseRevision !== undefined && typeof value.baseRevision !== 'string') {
    return [invalidShape('baseRevision must be a string', undefined, 'baseRevision')];
  }
  if (!Array.isArray(value.operations)) {
    return [invalidShape('operations must be an array', undefined, 'operations')];
  }
  const diagnostics: BlueprintCommandDiagnostic[] = [];
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
    if (!validGraphTarget(raw.graph)) {
      diagnostics.push(
        invalidShape('Operation has an invalid graph target', operationIndex, `${path}.graph`),
      );
    }
    switch (raw.kind) {
      case 'add-node':
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

function applyOperation(
  story: MutableStory,
  operation: BlueprintCommand,
  operationIndex: number,
): BlueprintCommandDiagnostic | undefined {
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
  options: { dryRun?: boolean } = {},
): BlueprintTransactionResult {
  const shapeDiagnostics = validateBlueprintCommandTransaction(transactionValue);
  if (shapeDiagnostics.length > 0) {
    return { ok: false, committed: false, document: source, diagnostics: shapeDiagnostics };
  }
  const transaction = transactionValue as BlueprintCommandTransaction;
  const currentSnapshot = createStorySemanticSnapshot(source);
  if (transaction.baseRevision && transaction.baseRevision !== currentSnapshot.revision) {
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
    snapshot: createStorySemanticSnapshot(document),
    appliedOperationIds: transaction.operations.map((operation) => operation.operationId),
    diagnostics: [],
  };
}
