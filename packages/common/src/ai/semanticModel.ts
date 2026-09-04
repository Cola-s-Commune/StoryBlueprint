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
): SemanticGraph {
  return {
    ...metadata,
    nodes: graph.nodes.map((node) => {
      const data = clone(node.data) as StoryNodeDataMap[StoryNodeType];
      if (node.type === StoryNodeType.CallEvent) {
        const call = data as StoryNodeDataMap[StoryNodeType.CallEvent];
        if (call.outputPorts === undefined) {
          const event = events.find((candidate) => candidate.id === call.eventId);
          if (event) {
            call.outputPorts = (event.outputs ?? []).map((output) => ({
              id: output.id,
              label: output.displayName,
              valueType: output.valueType,
            }));
          }
        }
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
  const content = {
    story: { id: source.id, name: source.name, displayName: source.displayName },
    variables: clone(source.variables),
    characters: clone(source.characters),
    ...(characterTemplates?.length ? { characterTemplates: clone(characterTemplates) } : {}),
    assets: clone(source.assets),
    events: clone(source.events),
    signals: clone(source.signals ?? []),
    conditions: clone(source.conditions ?? []),
    ...(engineTypes?.length ? { engineTypes: clone(engineTypes) } : {}),
    graphs: [
      semanticGraph(source.root, {
        kind: 'root',
        name: 'root',
        displayName: 'Root Blueprint',
      }, source.events),
      ...source.chapters.map((chapter) =>
        semanticGraph(chapter.graph, {
          kind: 'chapter',
          chapterId: chapter.id,
          name: chapter.name,
          displayName: chapter.displayName,
          parameters: clone(chapter.parameters.map((parameter) => parameter.variable)),
          outputs: clone(chapter.outputs.map((output) => output.variable)),
          localVariables: clone(chapter.localVariables),
        }, source.events),
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
