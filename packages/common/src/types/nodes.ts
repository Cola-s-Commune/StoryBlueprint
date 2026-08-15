// ============================================================
// StoryBlueprint Node Type Definitions
// ============================================================

import type {
  AssetId,
  ChapterId,
  CharacterId,
  EventId,
  SignalId,
  DialogueLineId,
  NodeId,
  OptionId,
  TextId,
  VariableId,
} from './ids';
import type { ExpressionSource, TextTemplateSource } from './expressions';
import type { ValueType } from './values';

/**
 * All supported node types in the story graph.
 * Add new types here as the framework evolves.
 */
export enum StoryNodeType {
  Start = 'story-entry',
  Dialogue = 'dialogue',
  Choice = 'choice',
  Branch = 'branch',
  GetVariable = 'get-variable',
  SetVariable = 'set-variable',
  CallEvent = 'call-event',
  WaitSignal = 'wait-signal',
  CallSubstory = 'call-substory',
  Reroute = 'reroute',
  FlowAnchor = 'flow-anchor',
  FlowJump = 'flow-jump',
  Return = 'return',
  End = 'end-story',
}

/**
 * A port (connection point) on a node.
 * Execution flow is authored left-to-right; data ports are typed independently.
 */
export interface NodePort {
  /** Unique port ID within the node */
  id: string;
  /** Display label */
  label: string;
  /** Execution ports control flow; data ports carry typed values. */
  kind: 'execution' | 'data';
  direction: 'input' | 'output';
  /** Required for data ports and omitted for execution ports. */
  valueType?: ValueType;
}

// ---- Per-type data interfaces ----

/** Data for Start node — the entry point of the story */
export interface StartNodeData {
  /** Story title or opening line */
  title: string;
}

/** A stable, individually resumable line inside a Dialogue node. */
export interface DialogueLine {
  id: DialogueLineId;
  textId: TextId;
  text: TextTemplateSource;
  /** An omitted speaker is the narrator; voice and emotion are independently optional. */
  speakerId?: CharacterId;
  voiceId?: AssetId;
  emotion?: string;
  tags?: readonly string[];
}

/** Data for Dialogue node — one uninterrupted sequence of dialogue lines. */
export interface DialogueNodeData {
  lines: DialogueLine[];
}

/** Data for Choice node — presents options to the player */
export interface ChoiceNodeData {
  /** The prompt/question shown to the player */
  prompt: TextTemplateSource;
  /** Available choices (each maps to an output port) */
  options: ChoiceOption[];
}

/** A single player choice option */
export interface ChoiceOption {
  /** Display text for this option */
  text: TextTemplateSource;
  /** Unique ID matching the output port ID */
  id: OptionId;
  visibleIf?: ExpressionSource;
  enabledIf?: ExpressionSource;
}

/** Data for Branch node — conditional routing (engine-evaluated) */
export interface BranchNodeData {
  /** Human-readable description of the branch condition */
  condition: ExpressionSource;
}

/** Reads a story variable as a typed data value. */
export interface GetVariableNodeData {
  variableId?: VariableId;
}

/** Assigns a safe expression to a story variable. */
export interface SetVariableNodeData {
  variableId?: VariableId;
  value: ExpressionSource;
}

/** Dispatches a project-defined engine event and immediately continues. */
export interface CallEventNodeData {
  eventId?: EventId;
  arguments: Record<string, ExpressionSource>;
}

/** Pauses story execution until the engine emits a project-defined signal. */
export interface WaitSignalNodeData {
  signalId?: SignalId;
  /** Present entries constrain matching; omitted parameters accept any value. */
  matches: Record<string, ExpressionSource>;
}

/** Calls another blueprint contained by the current Story asset. */
export interface CallSubstoryNodeData {
  chapterId?: ChapterId;
  /** Expressions keyed by stable chapter parameter variable ID. */
  arguments: Record<VariableId, ExpressionSource>;
  /** Caller variables keyed by stable chapter output variable ID. */
  resultVariableIds: Record<VariableId, VariableId>;
}

/** Pure editor routing point. The compiler removes it from executable logic. */
export interface RerouteNodeData {}

/** Named destination for one or more Flow Jump nodes in the same graph. */
export interface FlowAnchorNodeData {
  label: string;
}

/** Hidden execution link to a Flow Anchor in the same graph. */
export interface FlowJumpNodeData {
  targetNodeId?: NodeId;
}

/** Returns from the current substory to its caller. */
export interface ReturnNodeData {
  /** Expressions keyed by stable chapter output variable ID. */
  values: Record<VariableId, ExpressionSource>;
}

/** Data for End node — story endpoint */
export interface EndNodeData {
  /** Ending label or title */
  title: string;
}

// ---- Discriminated union ----

/** Map each StoryNodeType to its data interface */
export interface StoryNodeDataMap {
  [StoryNodeType.Start]: StartNodeData;
  [StoryNodeType.Dialogue]: DialogueNodeData;
  [StoryNodeType.Choice]: ChoiceNodeData;
  [StoryNodeType.Branch]: BranchNodeData;
  [StoryNodeType.GetVariable]: GetVariableNodeData;
  [StoryNodeType.SetVariable]: SetVariableNodeData;
  [StoryNodeType.CallEvent]: CallEventNodeData;
  [StoryNodeType.WaitSignal]: WaitSignalNodeData;
  [StoryNodeType.CallSubstory]: CallSubstoryNodeData;
  [StoryNodeType.Reroute]: RerouteNodeData;
  [StoryNodeType.FlowAnchor]: FlowAnchorNodeData;
  [StoryNodeType.FlowJump]: FlowJumpNodeData;
  [StoryNodeType.Return]: ReturnNodeData;
  [StoryNodeType.End]: EndNodeData;
}

// ---- Node definition (registry entry) ----

/**
 * Describes a node type registered in the NodeRegistry.
 * Used to populate the node palette and create instances.
 */
export interface NodeDefinition<T extends StoryNodeType = StoryNodeType> {
  /** The type discriminator */
  type: T;
  /** Serialized node definition version used by source migrations. */
  version: number;
  /** Human-readable label (e.g. "Dialogue") */
  label: string;
  /** Category for UI grouping */
  category: 'flow' | 'narrative' | 'logic';
  /** Color for the node header (CSS color) */
  color: string;
  /** Default input ports */
  inputs: NodePort[];
  /** Default output ports */
  outputs: NodePort[];
  /** Describes data-backed output ports such as Choice options. */
  dynamicOutputs?: {
    sourceProperty: string;
    idProperty: string;
    labelProperty: string;
    kind: 'execution' | 'data';
    valueType?: ValueType;
  };
  /** Factory: returns default data for a new node of this type */
  defaultData: () => StoryNodeDataMap[T];
}
