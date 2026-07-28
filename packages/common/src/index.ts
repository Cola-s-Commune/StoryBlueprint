// ---- Types ----
export {
  StoryNodeType,
  type NodePort,
  type StartNodeData,
  type DialogueNodeData,
  type DialogueLine,
  type ChoiceNodeData,
  type ChoiceOption,
  type BranchNodeData,
  type GetVariableNodeData,
  type SetVariableNodeData,
  type CallEventNodeData,
  type WaitSignalNodeData,
  type CallSubstoryNodeData,
  type RerouteNodeData,
  type FlowAnchorNodeData,
  type FlowJumpNodeData,
  type ReturnNodeData,
  type EndNodeData,
  type StoryNodeDataMap,
  type NodeDefinition,
} from './types/nodes';

// ---- Registry ----
export { NodeRegistry, nodeRegistry } from './registry/nodeRegistry';

// ---- Factory ----
export { NodeFactory, type NodeInstance } from './registry/nodeFactory';

// ---- AI-safe semantic editing foundation ----
export {
  STORY_SEMANTIC_FORMAT,
  STORY_SEMANTIC_VERSION,
  createStorySemanticSnapshot,
  type SemanticPort,
  type SemanticNode,
  type SemanticConnection,
  type SemanticGraph,
  type StorySemanticSnapshot,
} from './ai/semanticModel';
export {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  type BlueprintGraphTarget,
  type AddNodeCommand,
  type UpdateNodeCommand,
  type RemoveNodeCommand,
  type ConnectNodesCommand,
  type DisconnectNodesCommand,
  type BlueprintCommand,
  type BlueprintCommandTransaction,
  type BlueprintCommandDiagnosticCode,
  type BlueprintCommandDiagnostic,
} from './ai/blueprintCommands';
export {
  validateBlueprintCommandTransaction,
  executeBlueprintCommandTransaction,
  type BlueprintTransactionResult,
} from './ai/commandExecutor';

// ---- Typed graph connection rules ----
export {
  resolveNodePorts,
  validateGraphConnection,
  type GraphNodeLike,
  type GraphEdgeLike,
  type ConnectionCandidate,
  type ConnectionDiagnosticCode,
  type ConnectionDiagnostic,
  type ConnectionValidationResult,
} from './graph/connectionValidation';

// ---- .story KDL serialization ----
export { StoryFormatError, serializeStorySource, parseStorySource } from './serialization/storyKdl';
export { serializeStoryProject, parseStoryProject } from './serialization/projectKdl';
export {
  STORY_CHARACTER_FORMAT,
  STORY_CHARACTER_VERSION,
  STORY_ASSET_FORMAT,
  STORY_ASSET_VERSION,
  serializeCharacterResource,
  parseCharacterResource,
  serializeAssetResource,
  parseAssetResource,
} from './serialization/resourceKdl';

// ---- Stable IDs ----
export {
  createStableId,
  isStableId,
  type StableId,
  type StableIdKind,
  type StoryId,
  type ProjectId,
  type ChapterId,
  type NodeId,
  type EdgeId,
  type VariableId,
  type CharacterId,
  type AssetId,
  type EventId,
  type SignalId,
  type DialogueLineId,
  type TextId,
  type OptionId,
  type ProgramId,
  type BlockId,
  type InstructionId,
  type NamedObject,
} from './types/ids';

// ---- Values and expressions ----
export type {
  RuntimeScalar,
  RuntimeStruct,
  RuntimeValue,
  ValueType,
  VariableScope,
  VariableDefinition,
} from './types/values';
export type {
  ExpressionSource,
  TextTemplateSource,
  UnaryOperator,
  BinaryOperator,
  TypedExpression,
} from './types/expressions';

// ---- Versioned source model ----
export {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  type SourcePosition,
  type SourcePortRef,
  type SourceEdge,
  type DynamicPortItem,
  type SourceNode,
  type SourceGraph,
  type ChapterParameter,
  type ChapterSource,
  type CharacterSource,
  type AssetSource,
  type EventSource,
  type SignalSource,
  type LocalizedTextSource,
  type StorySourceDocument,
  type BoundExpressionSource,
} from './types/source';

export {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type ProjectStoryReference,
  type ProjectCharacterReference,
  type ProjectAssetReference,
  type StoryProjectDocument,
} from './types/project';

// ---- Runtime program contract ----
export {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  isRuntimeTerminator,
  type ProgramLocation,
  type LocalizedVoiceRef,
  type RuntimeTextPart,
  type RuntimeTextTemplate,
  type DialogueInstruction,
  type NarrationInstruction,
  type SetVariableInstruction,
  type CallEventInstruction,
  type WaitSignalInstruction,
  type ChoiceOptionInstruction,
  type ChoiceInstruction,
  type BranchInstruction,
  type JumpInstruction,
  type CallChapterInstruction,
  type ReturnInstruction,
  type EndStoryInstruction,
  type RuntimeInstruction,
  type RuntimeTerminator,
  type RuntimeBlock,
  type RuntimeChapterDefinition,
  type RuntimeProgram,
} from './types/runtimeProgram';

export {
  STORY_COMPILED_PROJECT_FORMAT,
  STORY_COMPILED_PROJECT_VERSION,
  type CompiledStoryProgram,
  type CompiledStoryProject,
} from './types/compiledProject';
