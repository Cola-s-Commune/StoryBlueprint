import { nodeRegistry, type NodeRegistry } from '../registry/nodeRegistry';
import type { StoryNodeDataMap, StoryNodeType, NodePort } from '../types/nodes';
import type { ValueType } from '../types/values';

export interface GraphNodeLike {
  id: string;
  type: StoryNodeType;
  data: StoryNodeDataMap[StoryNodeType];
}

export interface GraphEdgeLike {
  id: string;
  source: string;
  sourcePortId: string;
  target: string;
  targetPortId: string;
}

export interface ConnectionCandidate {
  source: string | null;
  sourcePortId: string | null;
  target: string | null;
  targetPortId: string | null;
}

export type ConnectionDiagnosticCode =
  | 'MISSING_ENDPOINT'
  | 'UNKNOWN_NODE'
  | 'UNKNOWN_PORT'
  | 'INVALID_DIRECTION'
  | 'INCOMPATIBLE_PORT_KIND'
  | 'INCOMPATIBLE_DATA_TYPE'
  | 'OUTPUT_ALREADY_CONNECTED'
  | 'INPUT_ALREADY_CONNECTED'
  | 'DUPLICATE_CONNECTION'
  | 'INVALID_DYNAMIC_PORT_DATA';

export interface ConnectionDiagnostic {
  code: ConnectionDiagnosticCode;
  message: string;
}

export type ConnectionValidationResult =
  { valid: true } | { valid: false; diagnostic: ConnectionDiagnostic };

function invalid(code: ConnectionDiagnosticCode, message: string): ConnectionValidationResult {
  return { valid: false, diagnostic: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function resolveNodePorts(
  node: GraphNodeLike,
  registry: NodeRegistry = nodeRegistry,
): { ports: readonly NodePort[]; diagnostics: readonly ConnectionDiagnostic[] } {
  const definition = registry.get(node.type);
  if (!definition) {
    return {
      ports: [],
      diagnostics: [{ code: 'UNKNOWN_NODE', message: `Unknown node type: ${node.type}` }],
    };
  }

  const ports: NodePort[] = [...definition.inputs, ...definition.outputs];
  const portIds = new Set(ports.map((port) => port.id));
  const diagnostics: ConnectionDiagnostic[] = [];
  const dynamic = definition.dynamicOutputs;
  if (!dynamic) return { ports, diagnostics };

  const data = node.data as unknown;
  const items = isRecord(data) ? data[dynamic.sourceProperty] : undefined;
  if (!Array.isArray(items)) {
    diagnostics.push({
      code: 'INVALID_DYNAMIC_PORT_DATA',
      message: `${node.type}.${dynamic.sourceProperty} must be an array`,
    });
    return { ports, diagnostics };
  }

  for (const item of items) {
    if (!isRecord(item)) {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `Dynamic port item on ${node.id} must be an object`,
      });
      continue;
    }
    const id = item[dynamic.idProperty];
    const rawLabel = item[dynamic.labelProperty];
    const label =
      typeof rawLabel === 'string'
        ? rawLabel
        : isRecord(rawLabel) && typeof rawLabel.source === 'string'
          ? rawLabel.source
          : undefined;
    if (typeof id !== 'string' || typeof label !== 'string') {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `Dynamic port item on ${node.id} requires string ID and label fields`,
      });
      continue;
    }
    if (portIds.has(id)) {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `Dynamic port ID ${id} is duplicated on ${node.id}`,
      });
      continue;
    }
    portIds.add(id);
    ports.push({
      id,
      label,
      kind: dynamic.kind,
      direction: 'output',
      valueType: dynamic.valueType,
    });
  }

  return { ports, diagnostics };
}

function sameValueType(source: ValueType | undefined, target: ValueType | undefined): boolean {
  if (source?.kind === 'any' || target?.kind === 'any') return true;
  if (!source || !target || source.kind !== target.kind) return false;
  if (source.nullable && !target.nullable) return false;
  if (source.kind === 'enum' && target.kind === 'enum') return source.name === target.name;
  if (source.kind === 'struct' && target.kind === 'struct') return source.name === target.name;
  return true;
}

export function validateGraphConnection(
  candidate: ConnectionCandidate,
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
  registry: NodeRegistry = nodeRegistry,
): ConnectionValidationResult {
  const { source, sourcePortId, target, targetPortId } = candidate;
  if (!source || !sourcePortId || !target || !targetPortId) {
    return invalid('MISSING_ENDPOINT', 'Connection requires source and target ports');
  }

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) {
    return invalid('UNKNOWN_NODE', 'Connection references a node that does not exist');
  }

  const sourceResolution = resolveNodePorts(sourceNode, registry);
  const targetResolution = resolveNodePorts(targetNode, registry);
  const portDiagnostic = sourceResolution.diagnostics[0] ?? targetResolution.diagnostics[0];
  if (portDiagnostic) return { valid: false, diagnostic: portDiagnostic };
  const sourcePort = sourceResolution.ports.find((port) => port.id === sourcePortId);
  const targetPort = targetResolution.ports.find((port) => port.id === targetPortId);
  if (!sourcePort || !targetPort) {
    return invalid('UNKNOWN_PORT', 'Connection references a port that does not exist');
  }
  if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') {
    return invalid('INVALID_DIRECTION', 'Connections must run from an output to an input');
  }
  if (sourcePort.kind !== targetPort.kind) {
    return invalid('INCOMPATIBLE_PORT_KIND', 'Execution and data ports cannot be connected');
  }
  if (sourcePort.kind === 'data' && !sameValueType(sourcePort.valueType, targetPort.valueType)) {
    return invalid('INCOMPATIBLE_DATA_TYPE', 'Data port types are incompatible');
  }

  if (
    edges.some(
      (edge) =>
        edge.source === source &&
        edge.sourcePortId === sourcePortId &&
        edge.target === target &&
        edge.targetPortId === targetPortId,
    )
  ) {
    return invalid('DUPLICATE_CONNECTION', 'This connection already exists');
  }

  if (
    sourcePort.kind === 'execution' &&
    edges.some((edge) => edge.source === source && edge.sourcePortId === sourcePortId)
  ) {
    return invalid(
      'OUTPUT_ALREADY_CONNECTED',
      'An execution output can only connect to one successor',
    );
  }

  if (
    targetPort.kind === 'data' &&
    edges.some((edge) => edge.target === target && edge.targetPortId === targetPortId)
  ) {
    return invalid('INPUT_ALREADY_CONNECTED', 'A data input can only have one source');
  }

  return { valid: true };
}
