import { resolveNodePorts } from '../graph/connectionValidation';
import { NodeRegistry } from '../registry/nodeRegistry';
import { StoryNodeType } from '../types/nodes';
import type { NodePort, StoryNodeDataMap } from '../types/nodes';
import type {
  AssetSource,
  CharacterSource,
  ConditionSource,
  EventSource,
  SignalSource,
  SourceGraph,
  StorySourceDocument,
} from '../types/source';
import type { VariableDefinition } from '../types/values';
import type { CharacterTemplateSource } from '../types/characterTemplate';
import type { EngineTypeDefinition } from '../types/project';

export const STORY_SEMANTIC_FORMAT = 'story-blueprint-semantic' as const;
export const STORY_SEMANTIC_VERSION = 1 as const;

const semanticRegistry = new NodeRegistry();
semanticRegistry.registerBuiltins();

export interface SemanticPort extends NodePort {}

export interface SemanticNode {
  id: string;
  type: StoryNodeType;
  name?: string;
  data: StoryNodeDataMap[StoryNodeType];
  ports: readonly SemanticPort[];
  portDiagnostics?: readonly string[];
}

export interface SemanticConnection {
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

export interface SemanticGraph {
  kind: 'root' | 'chapter';
  chapterId?: string;
  name: string;
  displayName: string;
  parameters?: readonly VariableDefinition[];
  outputs?: readonly VariableDefinition[];
  localVariables?: readonly VariableDefinition[];
  nodes: readonly SemanticNode[];
  connections: readonly SemanticConnection[];
}

export interface StorySemanticSnapshot {
  format: typeof STORY_SEMANTIC_FORMAT;
  version: typeof STORY_SEMANTIC_VERSION;
  revision: string;
  story: {
    id: string;
    name: string;
    displayName: string;
  };
  variables: readonly VariableDefinition[];
  characters: readonly CharacterSource[];
  characterTemplates?: readonly CharacterTemplateSource[];
  assets: readonly AssetSource[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  conditions: readonly ConditionSource[];
  engineTypes?: readonly EngineTypeDefinition[];
  graphs: readonly SemanticGraph[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function semanticGraph(
  graph: SourceGraph,
  metadata: Pick<
    SemanticGraph,
    'kind' | 'chapterId' | 'name' | 'displayName' | 'parameters' | 'outputs' | 'localVariables'
  >,
  events: readonly EventSource[] = [],
  sourceChapters: StorySourceDocument['chapters'] = [],
  signals: readonly SignalSource[] = [],
  variables: readonly VariableDefinition[] = [],
): SemanticGraph {
  return {
    ...metadata,
    nodes: graph.nodes.map((node) => {
      const data = clone(node.data) as StoryNodeDataMap[StoryNodeType];
      if (node.type === StoryNodeType.CallEvent) {
        const call = data as StoryNodeDataMap[StoryNodeType.CallEvent];
        const event = events.find((candidate) => candidate.id === call.eventId);
        if (event) {
          if (call.outputPorts === undefined) {
            call.outputPorts = (event.outputs ?? []).map((output) => ({
              id: output.id,
              label: output.displayName,
              valueType: output.valueType,
            }));
          }
          if (call.argumentInputTypes === undefined && event.parameters) {
            call.argumentInputTypes = Object.fromEntries(
              event.parameters.map((parameter) => [parameter.name, parameter.valueType]),
            );
          }
        }
      }
      if (node.type === StoryNodeType.WaitSignal) {
        const waitSignal = data as StoryNodeDataMap[StoryNodeType.WaitSignal];
        if (!waitSignal.outputPorts || waitSignal.outputPorts.length === 0) {
          const signal = signals.find((candidate) => candidate.id === waitSignal.signalId);
          if (signal?.parameters) {
            waitSignal.outputPorts = signal.parameters.map((param) => ({
              id: param.name,
              label: param.name,
              valueType: param.valueType,
            }));
          }
        }
      }
      if (node.type === StoryNodeType.GetVariable) {
        const getVar = data as StoryNodeDataMap[StoryNodeType.GetVariable];
        const allVariables = [
          ...variables,
          ...(metadata.parameters ?? []),
          ...(metadata.outputs ?? []),
          ...(metadata.localVariables ?? []),
        ];
        const variable = allVariables.find((candidate) => candidate.id === getVar.variableId);
        const effectiveValueType =
          getVar.accessor
            ? (getVar.outputValueType ??
              (variable?.valueType.kind === 'array'
                ? variable.valueType.elementType
                : variable?.valueType.kind === 'map'
                  ? variable.valueType.valueType
                  : variable?.valueType))
            : (variable?.valueType ?? getVar.outputValueType);
        if (effectiveValueType) {
          getVar.outputValueType = effectiveValueType;
        }
      }
      if (node.type === StoryNodeType.SetVariable) {
        const setVar = data as StoryNodeDataMap[StoryNodeType.SetVariable];
        const allVariables = [
          ...variables,
          ...(metadata.parameters ?? []),
          ...(metadata.outputs ?? []),
          ...(metadata.localVariables ?? []),
        ];
        const variable = allVariables.find((candidate) => candidate.id === setVar.variableId);
        const targetValueType =
          setVar.containerOperation === 'append' && variable?.valueType.kind === 'array'
            ? variable.valueType.elementType
            : setVar.containerOperation === 'set-entry' && variable?.valueType.kind === 'map'
              ? variable.valueType.valueType
              : setVar.containerOperation === 'set-field'
                ? (setVar.fieldValueType ?? variable?.valueType)
                : (variable?.valueType ?? setVar.valueInputType);
        const valueContract = targetValueType ?? setVar.valueInputType;
        const keyContract =
          setVar.keyInputType ??
          (variable?.valueType.kind === 'map' && variable.valueType.keyType === 'number'
            ? { kind: 'number' as const }
            : variable?.valueType.kind === 'map' && variable.valueType.keyType === 'character-ref'
              ? { kind: 'character-ref' as const }
              : variable?.valueType.kind === 'map' && variable.valueType.keyType === 'asset-ref'
                ? { kind: 'asset-ref' as const }
                : { kind: 'string' as const });
        if (valueContract) setVar.valueInputType = valueContract;
        if (keyContract) setVar.keyInputType = keyContract;
      }
      if (node.type === StoryNodeType.CallSubstory) {
        const call = data as StoryNodeDataMap[StoryNodeType.CallSubstory];
        const chapter = sourceChapters.find((candidate) => candidate.id === call.chapterId);
        if (chapter) {
          call.argumentInputTypes = Object.fromEntries(
            chapter.parameters.map((parameter) => [parameter.variable.id, parameter.variable.valueType]),
          );
          call.outputPorts = chapter.outputs.map((output) => ({
            id: output.variable.id,
            label: output.variable.displayName,
            valueType: output.variable.valueType,
          }));
        }
      }
      if (node.type === StoryNodeType.Return && metadata.kind === 'chapter') {
        const returnNode = data as StoryNodeDataMap[StoryNodeType.Return];
        returnNode.valueInputTypes = Object.fromEntries(
          (metadata.outputs ?? []).map((output) => [output.id, output.valueType]),
        );
      }
      const resolved = resolveNodePorts(
        {
          id: node.id,
          type: node.type as StoryNodeType,
          data,
        },
        semanticRegistry,
      );
      return {
        id: node.id,
        type: node.type as StoryNodeType,
        name: node.name,
        data,
        ports: clone(resolved.ports),
        portDiagnostics:
          resolved.diagnostics.length > 0
            ? resolved.diagnostics.map((diagnostic) => diagnostic.message)
            : undefined,
      };
    }),
    connections: clone(graph.edges),
  };
}

function revisionOf(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return `rev_${(hash >>> 0).toString(36)}`;
}

/** Creates an AI-facing view without coordinates, definition versions, or editor selection state. */
export function createStorySemanticSnapshot(
  source: StorySourceDocument,
  characterTemplates?: readonly CharacterTemplateSource[],
  engineTypes?: readonly EngineTypeDefinition[],
): StorySemanticSnapshot {
  const characterFieldVariables: VariableDefinition[] = (source.characters ?? []).flatMap((c) =>
    (c.fields ?? []).map((f) => ({
      id: f.id,
      name: `${c.name}.${f.name}`,
      displayName: f.displayName,
      scope: 'character' as const,
      valueType: f.valueType,
      defaultValue: f.defaultValue,
    })),
  );
  const baseVariables = [...source.variables, ...characterFieldVariables];
  const signals = source.signals ?? [];
  const content = {
    story: { id: source.id, name: source.name, displayName: source.displayName },
    variables: clone(source.variables),
    characters: clone(source.characters),
    ...(characterTemplates?.length ? { characterTemplates: clone(characterTemplates) } : {}),
    assets: clone(source.assets),
    events: clone(source.events),
    signals: clone(signals),
    conditions: clone(source.conditions ?? []),
    ...(engineTypes?.length ? { engineTypes: clone(engineTypes) } : {}),
    graphs: [
      semanticGraph(
        source.root,
        {
          kind: 'root',
          name: 'root',
          displayName: 'Root Blueprint',
        },
        source.events,
        source.chapters,
        signals,
        baseVariables,
      ),
      ...source.chapters.map((chapter) =>
        semanticGraph(
          chapter.graph,
          {
            kind: 'chapter',
            chapterId: chapter.id,
            name: chapter.name,
            displayName: chapter.displayName,
            parameters: clone(chapter.parameters.map((parameter) => parameter.variable)),
            outputs: clone(chapter.outputs.map((output) => output.variable)),
            localVariables: clone(chapter.localVariables),
          },
          source.events,
          source.chapters,
          signals,
          baseVariables,
        ),
      ),
    ],
  } as const;
  return {
    format: STORY_SEMANTIC_FORMAT,
    version: STORY_SEMANTIC_VERSION,
    revision: revisionOf(content),
    ...content,
  };
}
