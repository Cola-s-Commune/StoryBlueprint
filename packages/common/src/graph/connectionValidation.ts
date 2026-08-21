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

export interface GraphConnectionValidator {
  /** Validates a candidate and records it when valid for efficient sequential graph loading. */
  validate(candidate: ConnectionCandidate): ConnectionValidationResult;
}

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
  if (source.kind === 'json' && target.kind === 'json') return source.name === target.name;
  return true;
}

function connectionKey(source: string, sourcePortId: string, target: string, targetPortId: string) {
  return `${source}\0${sourcePortId}\0${target}\0${targetPortId}`;
}

function portKey(nodeId: string, portId: string) {
  return `${nodeId}\0${portId}`;
}

export function createGraphConnectionValidator(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[] = [],
  registry: NodeRegistry = nodeRegistry,
): GraphConnectionValidator {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const portResolutions = new Map<string, ReturnType<typeof resolveNodePorts>>();
  const resolvePorts = (node: GraphNodeLike) => {
    const cached = portResolutions.get(node.id);
    if (cached) return cached;
    const resolution = resolveNodePorts(node, registry);
    portResolutions.set(node.id, resolution);
    return resolution;
  };
  const connections = new Set<string>();
  const connectedOutputs = new Set<string>();
  const connectedInputs = new Set<string>();
  const record = (edge: Omit<GraphEdgeLike, 'id'>) => {
    connections.add(connectionKey(edge.source, edge.sourcePortId, edge.target, edge.targetPortId));
    connectedOutputs.add(portKey(edge.source, edge.sourcePortId));
    connectedInputs.add(portKey(edge.target, edge.targetPortId));
  };
  for (const edge of edges) record(edge);

  return {
    validate(candidate) {
      const { source, sourcePortId, target, targetPortId } = candidate;
      if (!source || !sourcePortId || !target || !targetPortId) {
        return invalid('MISSING_ENDPOINT', 'Connection requires source and target ports');
      }

      const sourceNode = nodesById.get(source);
      const targetNode = nodesById.get(target);
      if (!sourceNode || !targetNode) {
        return invalid('UNKNOWN_NODE', 'Connection references a node that does not exist');
      }

      const sourceResolution = resolvePorts(sourceNode);
      const targetResolution = resolvePorts(targetNode);
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
      if (
        sourcePort.kind === 'data' &&
        !sameValueType(sourcePort.valueType, targetPort.valueType)
      ) {
        return invalid('INCOMPATIBLE_DATA_TYPE', 'Data port types are incompatible');
      }

      if (connections.has(connectionKey(source, sourcePortId, target, targetPortId))) {
        return invalid('DUPLICATE_CONNECTION', 'This connection already exists');
      }
      if (sourcePort.kind === 'execution' && connectedOutputs.has(portKey(source, sourcePortId))) {
        return invalid(
          'OUTPUT_ALREADY_CONNECTED',
          'An execution output can only connect to one successor',
        );
      }
      if (targetPort.kind === 'data' && connectedInputs.has(portKey(target, targetPortId))) {
        return invalid('INPUT_ALREADY_CONNECTED', 'A data input can only have one source');
      }

      record({ source, sourcePortId, target, targetPortId });
      return { valid: true };
    },
  };
}

export function validateGraphConnection(
  candidate: ConnectionCandidate,
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
  registry: NodeRegistry = nodeRegistry,
): ConnectionValidationResult {
  return createGraphConnectionValidator(nodes, edges, registry).validate(candidate);
}
