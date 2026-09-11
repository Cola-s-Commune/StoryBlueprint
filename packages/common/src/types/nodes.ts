// ============================================================
// StoryBlueprint Node Type Definitions
// ============================================================

import type {
  AssetId,
  ChapterId,
  CharacterId,
  ConditionId,
  EventId,
  EventOutputId,
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
  Narration = 'narration',
  InkBlock = 'ink-block',
  Choice = 'choice',
  Branch = 'branch',
  GetVariable = 'get-variable',
  SetVariable = 'set-variable',
  CallEvent = 'call-event',
  WaitSignal = 'wait-signal',
  CallSubstory = 'call-substory',
  StartStory = 'start-story',
  SwitchStory = 'switch-story',
  ResumeStory = 'resume-story',
  EndStoryInstance = 'end-story-instance',
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
  /** Omit only when the speaker is genuinely unknown; narration belongs in a Narration node. */
  speakerId?: CharacterId;
  voiceId?: AssetId;
  emotion?: string;
  tags?: readonly string[];
}

/** Data for Dialogue node — one uninterrupted sequence of dialogue lines. */
export interface DialogueNodeData {
  lines: DialogueLine[];
}

/** A standalone narrator/action/scene-description beat, never attributed to a Character. */
export interface NarrationNodeData {
  textId: TextId;
  text: TextTemplateSource;
  voiceId?: AssetId;
}

/** Ink source executed as one resumable runtime block. Linked paths are project-relative. */
export type InkVariableDirection = 'story-to-ink' | 'ink-to-story' | 'two-way';

export interface InkVariableBinding {
  inkName: string;
  variableId: VariableId;
  direction: InkVariableDirection;
}

export interface InkExternalFunctionBinding {
  /** Name used by the Ink script's EXTERNAL declaration/call. */
  inkName: string;
  /** Stable project function ID; never infer this from display/name text. */
  functionId: import('./ids').ExternalFunctionId;
}

interface InkBlockNodeDataBase {
  entryKnot?: string;
  variableBindings?: readonly InkVariableBinding[];
  externalFunctionBindings?: readonly InkExternalFunctionBinding[];
}

export type InkBlockNodeData =
  | (InkBlockNodeDataBase & { sourceMode: 'embedded'; source: string })
  | (InkBlockNodeDataBase & { sourceMode: 'linked'; path: string });

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
  /** Optional reusable conditions. When present they take precedence over inline expressions. */
  visibleConditionId?: ConditionId;
  enabledConditionId?: ConditionId;
}

/** Data for Branch node — conditional routing (engine-evaluated) */
export interface BranchNodeData {
  /** Human-readable description of the branch condition */
  condition: ExpressionSource;
  /** Optional reusable Condition resource. When present, it takes precedence over `condition`. */
  conditionId?: ConditionId;
}

/** Reads a story variable as a typed data value. */
export interface GetVariableNodeData {
  variableId?: VariableId;
  outputValueType?: ValueType;
  /** Independently connectable Engine Object fields, identified by stable Schema field IDs. */
  exposedFields?: readonly {
    fieldId: import('./ids').EngineFieldId;
    member: string;
    displayName: string;
    valueType: ValueType;
  }[];
  accessor?:
    | { kind: 'member'; member: string; valueType: ValueType }
    | { kind: 'index'; index: ExpressionSource; valueType: ValueType };
}

/** Assigns a safe expression to a story variable. */
export interface SetVariableNodeData {
  variableId?: VariableId;
  value: ExpressionSource;
  /** Container variables may append an Array item or set a Map entry instead of replacing all. */
  containerOperation?: 'append' | 'set-entry' | 'set-field';
  key?: ExpressionSource;
  /** Restricted first-level Engine Object mutation resolved by stable Schema field ID. */
  fieldId?: import('./ids').EngineFieldId;
  fieldName?: string;
  fieldValueType?: ValueType;
  /** Serialized port contracts used for immediate connection validation. */
  valueInputType?: ValueType;
  keyInputType?: ValueType;
}

/** Calls a project-defined engine event and optionally stores its returned values. */
export interface CallEventNodeData {
  eventId?: EventId;
  arguments: Record<string, ExpressionSource>;
  /**
   * Editor-only contracts for dynamic argument pins. The selected External
   * Function remains the source of truth; this optional map is intentionally
   * not required in serialized Story data.
   */
  argumentInputTypes?: Readonly<Record<string, ValueType>>;
  /** Snapshot of the selected External Function's typed data outputs.
   *  Keeping the port contract on the node lets graph validation resolve links
   *  without needing project-level resources. It is refreshed when the Event changes.
   */
  outputPorts?: readonly {
    id: EventOutputId;
    label: string;
    valueType: ValueType;
  }[];
  resultVariableIds: Record<EventOutputId, VariableId>;
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
  /**
   * Snapshot of the selected substory input contracts. This keeps dynamic
   * pins valid while a graph is loaded without its owning Story document.
   */
  argumentInputTypes?: Readonly<Record<string, ValueType>>;
  /** Snapshot of the selected substory return contracts used by Out pins. */
  outputPorts?: readonly {
    id: VariableId;
    label: string;
    valueType: ValueType;
  }[];
  /** Caller variables keyed by stable chapter output variable ID. */
  resultVariableIds: Record<VariableId, VariableId>;
}

/** Starts an independent Story runtime instance through the engine Adapter. */
export interface StartStoryNodeData {
  storyId?: import('./ids').StoryId;
  /** Optional caller-provided instance key; omitted means the Adapter creates one. */
  instanceId?: ExpressionSource;
  /** Values keyed by target Story variable ID. */
  arguments: Record<VariableId, ExpressionSource>;
  /** Store Adapter-returned output values in caller variables, keyed by output ID. */
  resultVariableIds: Record<string, VariableId>;
  /** Optional String variable receiving an Adapter-generated instance ID. */
  instanceVariableId?: VariableId;
  /** When false, the current Story continues immediately after dispatch. */
  waitForCompletion?: boolean;
}

/** Switches execution to another independent Story instance. */
export interface SwitchStoryNodeData {
  storyId?: import('./ids').StoryId;
  instanceId?: ExpressionSource;
  arguments: Record<VariableId, ExpressionSource>;
  resultVariableIds: Record<string, VariableId>;
  instanceVariableId?: VariableId;
  waitForCompletion?: boolean;
}

/** Resumes an existing Story instance or save slot through the engine Adapter. */
export interface ResumeStoryNodeData {
  instanceId?: ExpressionSource;
  resultVariableIds: Record<string, VariableId>;
  instanceVariableId?: VariableId;
  waitForCompletion?: boolean;
}

/** Ends an independent Story instance without ending the current runtime. */
export interface EndStoryInstanceNodeData {
  instanceId?: ExpressionSource;
  resultVariableIds: Record<string, VariableId>;
}

/** Pure editor routing point. The compiler removes it from executable logic. */
export interface RerouteNodeData {
  /** Execution is the default; data reroutes preserve the source value contract. */
  kind?: 'execution' | 'data';
  valueType?: ValueType;
}

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
  /** Snapshot of the owning substory return contracts used by input pins. */
  valueInputTypes?: Readonly<Record<string, ValueType>>;
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
  [StoryNodeType.Narration]: NarrationNodeData;
  [StoryNodeType.InkBlock]: InkBlockNodeData;
  [StoryNodeType.Choice]: ChoiceNodeData;
  [StoryNodeType.Branch]: BranchNodeData;
  [StoryNodeType.GetVariable]: GetVariableNodeData;
  [StoryNodeType.SetVariable]: SetVariableNodeData;
  [StoryNodeType.CallEvent]: CallEventNodeData;
  [StoryNodeType.WaitSignal]: WaitSignalNodeData;
  [StoryNodeType.CallSubstory]: CallSubstoryNodeData;
  [StoryNodeType.StartStory]: StartStoryNodeData;
  [StoryNodeType.SwitchStory]: SwitchStoryNodeData;
  [StoryNodeType.ResumeStory]: ResumeStoryNodeData;
  [StoryNodeType.EndStoryInstance]: EndStoryInstanceNodeData;
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
    valueTypeProperty?: string;
    recordEntries?: boolean;
    idPrefix?: string;
    optional?: boolean;
  };
  /** Describes data-backed input ports such as Event arguments. */
  dynamicInputs?: {
    sourceProperty: string;
    idProperty: string;
    labelProperty: string;
    kind: 'execution' | 'data';
    valueType?: ValueType;
    valueTypeProperty?: string;
    recordEntries?: boolean;
    idPrefix?: string;
    optional?: boolean;
  };
  /** Overrides static data input types from serialized node data. */
  inputValueTypeProperties?: Readonly<Record<string, string>>;
  /** Overrides static data output types from serialized node data; dot paths are supported. */
  outputValueTypeProperties?: Readonly<Record<string, string>>;
  /** Factory: returns default data for a new node of this type */
  defaultData: () => StoryNodeDataMap[T];
}
