// ---- Types ----
export {
  StoryNodeType,
  type NodePort,
  type StartNodeData,
  type DialogueNodeData,
  type ChoiceNodeData,
  type ChoiceOption,
  type BranchNodeData,
  type EndNodeData,
  type StoryNodeDataMap,
  type NodeDefinition,
} from './types/nodes';

// ---- Registry ----
export { NodeRegistry, nodeRegistry } from './registry/nodeRegistry';

// ---- Factory ----
export { NodeFactory, type NodeInstance } from './registry/nodeFactory';

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

// ---- Stable IDs ----
export {
  createStableId,
  isStableId,
  type StableId,
  type StoryId,
  type ChapterId,
  type NodeId,
  type EdgeId,
  type VariableId,
  type CharacterId,
  type AssetId,
  type EventId,
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
  type LocalizedTextSource,
  type StorySourceDocument,
  type BoundExpressionSource,
} from './types/source';

// ---- Runtime program contract ----
export {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  isRuntimeTerminator,
  type ProgramLocation,
  type LocalizedVoiceRef,
  type DialogueInstruction,
  type NarrationInstruction,
  type SetVariableInstruction,
  type EventErrorPolicy,
  type CallEventInstruction,
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
