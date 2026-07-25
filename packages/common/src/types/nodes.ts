// ============================================================
// StoryBlueprint Node Type Definitions
// ============================================================

import type { AssetId, CharacterId, OptionId, VariableId } from './ids';
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

/** Data for Dialogue node — a single dialogue line */
export interface DialogueNodeData {
  /** Stable character reference. */
  speakerId?: CharacterId;
  /** Dialogue text content */
  text: TextTemplateSource;
  /** Optional voice asset reference. */
  voiceId?: AssetId;
  /** Emotion key configured on the character. */
  emotion?: string;
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
