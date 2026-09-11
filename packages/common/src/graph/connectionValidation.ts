import { nodeRegistry, type NodeRegistry } from '../registry/nodeRegistry';
import { StoryNodeType, type StoryNodeDataMap, type NodePort } from '../types/nodes';
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

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (current, part) => (isRecord(current) ? current[part] : undefined),
    value,
  );
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

  const data = node.data as unknown;
  const rerouteData =
    node.type === StoryNodeType.Reroute && isRecord(node.data)
      ? (node.data as { kind?: unknown; valueType?: unknown })
      : undefined;
  const ports: NodePort[] = [...definition.inputs, ...definition.outputs].map((port) => {
    if (rerouteData?.kind === 'data') {
      return {
        ...port,
        kind: 'data',
        valueType:
          isRecord(rerouteData.valueType) && typeof rerouteData.valueType.kind === 'string'
            ? (rerouteData.valueType as ValueType)
            : ({ kind: 'any' } satisfies ValueType),
      };
    }
    const property =
      (port.direction === 'input'
        ? definition.inputValueTypeProperties
        : definition.outputValueTypeProperties)?.[port.id];
    const valueType = property ? readPath(data, property) : undefined;
    return valueType && isRecord(valueType) && typeof valueType.kind === 'string'
      ? { ...port, valueType: valueType as ValueType }
      : port;
  });
  const portIds = new Set(ports.map((port) => port.id));
  const diagnostics: ConnectionDiagnostic[] = [];
  const dynamicPorts = [
    definition.dynamicOutputs && { definition: definition.dynamicOutputs, direction: 'output' as const },
    definition.dynamicInputs && { definition: definition.dynamicInputs, direction: 'input' as const },
  ].filter(Boolean) as Array<{
    definition: NonNullable<typeof definition.dynamicOutputs>;
    direction: 'input' | 'output';
  }>;

  for (const { definition: dynamic, direction } of dynamicPorts) {
    const source = isRecord(data) ? data[dynamic.sourceProperty] : undefined;
    if (dynamic.recordEntries) {
      if (!isRecord(source) || Array.isArray(source)) {
        diagnostics.push({
          code: 'INVALID_DYNAMIC_PORT_DATA',
          message: `${node.type}.${dynamic.sourceProperty} must be an object`,
        });
        continue;
      }
      const valueTypeByEntry = dynamic.valueTypeProperty
        ? readPath(data, dynamic.valueTypeProperty)
        : undefined;
      const contractKeys = isRecord(valueTypeByEntry) ? Object.keys(valueTypeByEntry) : [];
      const keys = [...new Set([...Object.keys(source), ...contractKeys])];
      for (const key of keys) {
        const id = `${dynamic.idPrefix ?? ''}${key}`;
        if (portIds.has(id)) {
          diagnostics.push({
            code: 'INVALID_DYNAMIC_PORT_DATA',
            message: `Dynamic port ID ${id} is duplicated on ${node.id}`,
          });
          continue;
        }
        portIds.add(id);
        const valueType =
          isRecord(valueTypeByEntry) &&
          isRecord(valueTypeByEntry[key]) &&
          typeof valueTypeByEntry[key].kind === 'string'
            ? (valueTypeByEntry[key] as ValueType)
            : dynamic.valueType;
        ports.push({ id, label: key, kind: dynamic.kind, direction, valueType });
      }
      continue;
    }
    if (source === undefined && dynamic.optional) continue;
    if (!Array.isArray(source)) {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `${node.type}.${dynamic.sourceProperty} must be an array`,
      });
      continue;
    }

    for (const item of source) {
    if (!isRecord(item)) {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `Dynamic port item on ${node.id} must be an object`,
      });
      continue;
    }
    const rawId = item[dynamic.idProperty];
    const rawLabel = item[dynamic.labelProperty];
    const label =
      typeof rawLabel === 'string'
        ? rawLabel
        : isRecord(rawLabel) && typeof rawLabel.source === 'string'
          ? rawLabel.source
          : undefined;
    if (typeof rawId !== 'string' || typeof label !== 'string') {
      diagnostics.push({
        code: 'INVALID_DYNAMIC_PORT_DATA',
        message: `Dynamic port item on ${node.id} requires string ID and label fields`,
      });
      continue;
    }
    const id = `${dynamic.idPrefix ?? ''}${rawId}`;
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
      direction,
      valueType:
        dynamic.valueTypeProperty && isRecord(item)
          ? (item[dynamic.valueTypeProperty] as ValueType | undefined)
          : dynamic.valueType,
    });
    }
  }

  return { ports, diagnostics };
}

/**
 * Returns whether a value produced with `source` can be consumed by `target`.
 * The relation is directional for nullable values: a nullable source cannot be
 * connected to a non-nullable target. `any` intentionally remains an escape
 * hatch for engine-owned JSON and unfinished authoring work.
 */
export function valueTypesCompatible(
  source: ValueType | undefined,
  target: ValueType | undefined,
): boolean {
  if (source?.kind === 'any' || target?.kind === 'any') return true;
  if (!source || !target || source.kind !== target.kind) return false;
  if (source.nullable && !target.nullable) return false;
  if (source.kind === 'enum' && target.kind === 'enum') return source.name === target.name;
  if (source.kind === 'struct' && target.kind === 'struct') {
    if (source.name !== target.name) return false;
    return Object.entries(target.fields).every(([name, targetType]) =>
      valueTypesCompatible(source.fields[name], targetType),
    );
  }
  if (source.kind === 'json' && target.kind === 'json') return source.name === target.name;
  if (source.kind === 'array' && target.kind === 'array')
    return (
      !source.elementType || !target.elementType ||
      valueTypesCompatible(source.elementType, target.elementType)
    );
  if (source.kind === 'map' && target.kind === 'map')
    return (
      (!source.keyType || !target.keyType || source.keyType === target.keyType) &&
      (!source.valueType || !target.valueType ||
        valueTypesCompatible(source.valueType, target.valueType))
    );
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
        !valueTypesCompatible(sourcePort.valueType, targetPort.valueType)
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
