import type {
  ChapterId,
  AssetId,
  CharacterId,
  ConditionId,
  DialogueLineId,
  NodeId,
  OptionId,
  VariableId,
} from '../types/ids';
import type { DialogueLine, StoryNodeDataMap, StoryNodeType } from '../types/nodes';
import type { CharacterSource, ConditionSource, ConditionTreeNode } from '../types/source';
import type { RuntimeValue, ValueType, VariableDefinition, VariableScope } from '../types/values';

export const BLUEPRINT_COMMAND_FORMAT = 'story-blueprint-commands' as const;
export const BLUEPRINT_COMMAND_VERSION = 1 as const;

export type BlueprintGraphTarget = { kind: 'root' } | { kind: 'chapter'; chapterId: ChapterId };

interface BlueprintCommandBase {
  /** Unique within a transaction and suitable for future idempotency tracking. */
  operationId: string;
}

interface BlueprintGraphCommandBase extends BlueprintCommandBase {
  graph: BlueprintGraphTarget;
}

export interface AddNodeCommand extends BlueprintGraphCommandBase {
  kind: 'add-node';
  node: {
    id: NodeId;
    type: StoryNodeType;
    name?: string;
    data: StoryNodeDataMap[StoryNodeType];
  };
}

/** Adds a Set Variable node whose value is derived from the variable's current numeric value. */
export interface AddVariableAdjustmentCommand extends BlueprintGraphCommandBase {
  kind: 'add-variable-adjustment';
  node: { id: NodeId; name?: string };
  variableId: VariableId;
  /** Signed numeric change. For example, 1 increments and -1 decrements. */
  delta: number;
}

export interface UpdateNodeCommand extends BlueprintGraphCommandBase {
  kind: 'update-node';
  nodeId: NodeId;
  patch: {
    /** Null explicitly removes the optional author-facing name. */
    name?: string | null;
    /** Shallow data patch; collection fields are replaced atomically. */
    data?: Partial<StoryNodeDataMap[StoryNodeType]>;
  };
}

export interface RemoveNodeCommand extends BlueprintGraphCommandBase {
  kind: 'remove-node';
  nodeId: NodeId;
}

export interface ConnectNodesCommand extends BlueprintGraphCommandBase {
  kind: 'connect';
  from: { nodeId: NodeId; portId: string };
  to: { nodeId: NodeId; portId: string };
  /** Explicitly replaces an occupied execution output or data input. */
  replaceExisting?: boolean;
}

export interface DisconnectNodesCommand extends BlueprintGraphCommandBase {
  kind: 'disconnect';
  from: { nodeId: NodeId; portId: string };
  to: { nodeId: NodeId; portId: string };
}

export interface AddVariableCommand extends BlueprintCommandBase {
  kind: 'add-variable';
  variable: VariableDefinition;
}

export interface UpdateVariableCommand extends BlueprintCommandBase {
  kind: 'update-variable';
  variableId: VariableId;
  patch: {
    name?: string;
    displayName?: string;
    scope?: VariableScope;
    valueType?: ValueType;
    defaultValue?: RuntimeValue;
  };
}

export interface AddConditionCommand extends BlueprintCommandBase {
  kind: 'add-condition';
  condition: ConditionSource;
}

export interface UpdateConditionCommand extends BlueprintCommandBase {
  kind: 'update-condition';
  conditionId: ConditionSource['id'];
  patch: {
    name?: string;
    displayName?: string;
    description?: string | null;
    root?: ConditionTreeNode;
  };
}

export interface RemoveConditionCommand extends BlueprintCommandBase {
  kind: 'remove-condition';
  conditionId: ConditionSource['id'];
}

type DialogueLineInput = Omit<DialogueLine, 'text'> & { text: string };

export interface AddDialogueLineCommand extends BlueprintGraphCommandBase {
  kind: 'add-dialogue-line';
  nodeId: NodeId;
  line: DialogueLineInput;
  afterLineId?: DialogueLineId;
}

export interface UpdateDialogueLineCommand extends BlueprintGraphCommandBase {
  kind: 'update-dialogue-line';
  nodeId: NodeId;
  lineId: DialogueLineId;
  patch: {
    text?: string;
    speakerId?: DialogueLine['speakerId'] | null;
    voiceId?: DialogueLine['voiceId'] | null;
    emotion?: string | null;
    tags?: readonly string[];
  };
}

export interface RemoveDialogueLineCommand extends BlueprintGraphCommandBase {
  kind: 'remove-dialogue-line';
  nodeId: NodeId;
  lineId: DialogueLineId;
}

export interface AddChoiceOptionCommand extends BlueprintGraphCommandBase {
  kind: 'add-choice-option';
  nodeId: NodeId;
  option: {
    id: OptionId;
    text: string;
    visibleIf?: string;
    enabledIf?: string;
    visibleConditionId?: ConditionId;
    enabledConditionId?: ConditionId;
  };
  afterOptionId?: OptionId;
}

export interface UpdateChoiceOptionCommand extends BlueprintGraphCommandBase {
  kind: 'update-choice-option';
  nodeId: NodeId;
  optionId: OptionId;
  patch: {
    text?: string;
    visibleIf?: string | null;
    enabledIf?: string | null;
    visibleConditionId?: ConditionId | null;
    enabledConditionId?: ConditionId | null;
  };
}

export interface RemoveChoiceOptionCommand extends BlueprintGraphCommandBase {
  kind: 'remove-choice-option';
  nodeId: NodeId;
  optionId: OptionId;
}

export type ExpressionTarget =
  | { kind: 'branch-condition' }
  | { kind: 'set-variable-value' }
  | { kind: 'choice-visible'; optionId: OptionId }
  | { kind: 'choice-enabled'; optionId: OptionId }
  | { kind: 'event-argument'; parameterName: string }
  | { kind: 'signal-match'; parameterName: string };

export interface SetExpressionCommand extends BlueprintGraphCommandBase {
  kind: 'set-expression';
  nodeId: NodeId;
  target: ExpressionTarget;
  /** Null clears optional Choice, Event, or Signal expressions. */
  source: string | null;
}

export interface AddCharacterCommand extends BlueprintCommandBase {
  kind: 'add-character';
  character: CharacterSource;
}

export interface AddCharacterFromTemplateCommand extends BlueprintCommandBase {
  kind: 'add-character-from-template';
  templateName: string;
  character: Pick<CharacterSource, 'id' | 'name' | 'displayName'>;
  fieldIds: Readonly<Record<string, VariableId>>;
}

export interface UpdateCharacterCommand extends BlueprintCommandBase {
  kind: 'update-character';
  characterId: CharacterId;
  patch: {
    name?: string;
    displayName?: string;
    description?: string | null;
    dialogueStyle?: string | null;
    tags?: CharacterSource['tags'] | null;
    metadata?: CharacterSource['metadata'] | null;
    relationships?: CharacterSource['relationships'] | null;
    defaultPortraitId?: AssetId | null;
    emotions?: CharacterSource['emotions'];
    fields?: CharacterSource['fields'];
  };
}

export interface AddSubstoryCommand extends BlueprintCommandBase {
  kind: 'add-substory';
  substory: {
    id: ChapterId;
    name: string;
    displayName: string;
    parameters: readonly VariableDefinition[];
    outputs: readonly VariableDefinition[];
    localVariables: readonly VariableDefinition[];
    /** Initial graph nodes omit editor coordinates; the executor assigns layout positions. */
    nodes: readonly {
      id: NodeId;
      type: StoryNodeType;
      name?: string;
      data: StoryNodeDataMap[StoryNodeType];
    }[];
    edges: readonly {
      from: { nodeId: NodeId; portId: string };
      to: { nodeId: NodeId; portId: string };
    }[];
  };
}

export interface LayoutSelectionCommand extends BlueprintGraphCommandBase {
  kind: 'layout-selection';
  nodeIds: readonly NodeId[];
}

export interface LayoutNeighborhoodCommand extends BlueprintGraphCommandBase {
  kind: 'layout-neighborhood';
  nodeIds: readonly NodeId[];
}

export type BlueprintLayoutRequest = LayoutSelectionCommand | LayoutNeighborhoodCommand;

export type BlueprintCommand =
  | AddNodeCommand
  | AddVariableAdjustmentCommand
  | UpdateNodeCommand
  | RemoveNodeCommand
  | ConnectNodesCommand
  | DisconnectNodesCommand
  | AddVariableCommand
  | UpdateVariableCommand
  | AddConditionCommand
  | UpdateConditionCommand
  | RemoveConditionCommand
  | AddCharacterCommand
  | AddCharacterFromTemplateCommand
  | UpdateCharacterCommand
  | AddSubstoryCommand
  | AddDialogueLineCommand
  | UpdateDialogueLineCommand
  | RemoveDialogueLineCommand
  | AddChoiceOptionCommand
  | UpdateChoiceOptionCommand
  | RemoveChoiceOptionCommand
  | SetExpressionCommand
  | LayoutSelectionCommand
  | LayoutNeighborhoodCommand;

export interface BlueprintCommandTransaction {
  format: typeof BLUEPRINT_COMMAND_FORMAT;
  version: typeof BLUEPRINT_COMMAND_VERSION;
  /** Rejects edits based on a stale Semantic Snapshot. */
  baseRevision: string;
  operations: readonly BlueprintCommand[];
}

export type BlueprintCommandDiagnosticCode =
  | 'INVALID_TRANSACTION'
  | 'REVISION_CONFLICT'
  | 'DUPLICATE_OPERATION_ID'
  | 'UNKNOWN_GRAPH'
  | 'UNKNOWN_NODE'
  | 'DUPLICATE_NODE_ID'
  | 'UNKNOWN_VARIABLE'
  | 'DUPLICATE_VARIABLE_ID'
  | 'UNKNOWN_CONDITION'
  | 'DUPLICATE_CONDITION_ID'
  | 'UNKNOWN_CHARACTER'
  | 'DUPLICATE_CHARACTER_ID'
  | 'UNKNOWN_LINE'
  | 'DUPLICATE_LINE_ID'
  | 'UNKNOWN_OPTION'
  | 'DUPLICATE_OPTION_ID'
  | 'INVALID_TARGET'
  | 'UNKNOWN_CONNECTION'
  | 'INVALID_CONNECTION'
  | 'INVALID_GRAPH';

export interface BlueprintCommandDiagnostic {
  code: BlueprintCommandDiagnosticCode;
  message: string;
  operationId?: string;
  operationIndex?: number;
  path?: string;
}
