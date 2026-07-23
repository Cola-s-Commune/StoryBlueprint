// ============================================================
// StoryBlueprint Node Type Definitions
// ============================================================

/**
 * All supported node types in the story graph.
 * Add new types here as the framework evolves.
 */
export enum StoryNodeType {
  Start = 'start',
  Dialogue = 'dialogue',
  Choice = 'choice',
  Branch = 'branch',
  End = 'end',
}

/**
 * A port (connection point) on a node.
 * Each node has input ports (top/bottom) and output ports (bottom).
 */
export interface NodePort {
  /** Unique port ID within the node */
  id: string;
  /** Display label */
  label: string;
}

// ---- Per-type data interfaces ----

/** Data for Start node — the entry point of the story */
export interface StartNodeData {
  /** Story title or opening line */
  title: string;
}

/** Data for Dialogue node — a single dialogue line */
export interface DialogueNodeData {
  /** Speaker name (character ID or display name) */
  speaker: string;
  /** Dialogue text content */
  text: string;
}

/** Data for Choice node — presents options to the player */
export interface ChoiceNodeData {
  /** The prompt/question shown to the player */
  prompt: string;
  /** Available choices (each maps to an output port) */
  options: ChoiceOption[];
}

/** A single player choice option */
export interface ChoiceOption {
  /** Display text for this option */
  label: string;
  /** Unique ID matching the output port ID */
  id: string;
}

/** Data for Branch node — conditional routing (engine-evaluated) */
export interface BranchNodeData {
  /** Human-readable description of the branch condition */
  condition: string;
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
  /** Factory: returns default data for a new node of this type */
  defaultData: () => StoryNodeDataMap[T];
}
