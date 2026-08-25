import type {
  AssetId,
  ChapterId,
  CharacterId,
  EventId,
  EventOutputId,
  SignalId,
  NodeId,
  OptionId,
  StoryId,
  TextId,
} from './ids';
import type { ExpressionSource } from './expressions';
import type { RuntimeValue, ValueType, VariableDefinition } from './values';

export const STORY_SOURCE_FORMAT = 'story-blueprint' as const;
export const STORY_SOURCE_VERSION = 5 as const;

export interface SourcePosition {
  x: number;
  y: number;
}

export interface SourcePortRef {
  nodeId: NodeId;
  portId: string;
}

export interface SourceEdge {
  from: SourcePortRef;
  to: SourcePortRef;
}

export interface DynamicPortItem {
  id: OptionId;
  name: string;
  displayName: string;
}

export interface SourceNode<TData = Readonly<Record<string, unknown>>> {
  id: NodeId;
  name?: string;
  type: string;
  definitionVersion: number;
  position: SourcePosition;
  data: TData;
  /** Only dynamic items are persisted. Static ports come from the node definition. */
  dynamicPorts?: readonly DynamicPortItem[];
}

export interface SourceGraph {
  nodes: readonly SourceNode[];
  edges: readonly SourceEdge[];
}

export interface ChapterParameter {
  variable: VariableDefinition;
  direction: 'input';
}

export interface ChapterOutput {
  variable: VariableDefinition;
  direction: 'output';
}

export interface ChapterSource {
  id: ChapterId;
  name: string;
  displayName: string;
  parameters: readonly ChapterParameter[];
  outputs: readonly ChapterOutput[];
  localVariables: readonly VariableDefinition[];
  graph: SourceGraph;
}

export interface CharacterSource {
  id: CharacterId;
  name: string;
  displayName: string;
  /** Writer-facing biography and role summary, also exposed to AI authoring tools. */
  description?: string;
  /** Guidance for generated dialogue, such as vocabulary, tone, and verbal habits. */
  dialogueStyle?: string;
  /** Lightweight authoring categories used by search, filtering, and AI context. */
  tags?: readonly string[];
  /** Project-specific scalar facts that do not warrant engine-backed Character Fields. */
  metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Directed, writer-facing relationships keyed by the target Character ID. */
  relationships?: Readonly<Record<CharacterId, { label: string; description?: string }>>;
  defaultPortraitId?: AssetId;
  emotions: Readonly<Record<string, { displayName: string; portraitId?: AssetId }>>;
  /** Engine-owned typed state addressed through the Story Adapter. */
  fields?: readonly VariableDefinition[];
}

export interface AssetSource {
  id: AssetId;
  name: string;
  displayName: string;
  kind: 'audio' | 'portrait' | 'other';
  locales?: Readonly<Record<string, string>>;
}

export interface EventSource {
  id: EventId;
  name: string;
  displayName: string;
  description?: string;
  parameters: readonly { name: string; valueType: ValueType }[];
  outputs?: readonly {
    id: EventOutputId;
    name: string;
    displayName: string;
    valueType: ValueType;
  }[];
  resumable: boolean;
  sideEffect: 'none' | 'read' | 'write';
}

/** A project-level notification that story execution can explicitly wait for. */
export interface SignalSource {
  id: SignalId;
  name: string;
  displayName: string;
  description?: string;
  parameters: readonly { name: string; valueType: ValueType }[];
}

export interface LocalizedTextSource {
  id: TextId;
  default: string;
}

export interface StorySourceDocument {
  format: typeof STORY_SOURCE_FORMAT;
  version: typeof STORY_SOURCE_VERSION;
  id: StoryId;
  name: string;
  displayName: string;
  root: SourceGraph;
  chapters: readonly ChapterSource[];
  variables: readonly VariableDefinition[];
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
  events: readonly EventSource[];
  signals?: readonly SignalSource[];
}

export interface BoundExpressionSource {
  expression: ExpressionSource;
  expectedType: ValueType;
  fallback?: RuntimeValue;
}
