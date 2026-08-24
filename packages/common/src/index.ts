// ---- Types ----
export {
  parseInkDialogueMetadata,
  collectInkReservedTagGroups,
  type InkDialogueMetadata,
} from './inkMetadata';

export {
  StoryNodeType,
  type NodePort,
  type StartNodeData,
  type DialogueNodeData,
  type InkBlockNodeData,
  type InkVariableBinding,
  type InkVariableDirection,
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
  type AddVariableCommand,
  type UpdateVariableCommand,
  type AddDialogueLineCommand,
  type UpdateDialogueLineCommand,
  type RemoveDialogueLineCommand,
  type AddChoiceOptionCommand,
  type UpdateChoiceOptionCommand,
  type RemoveChoiceOptionCommand,
  type ExpressionTarget,
  type SetExpressionCommand,
  type LayoutSelectionCommand,
  type LayoutNeighborhoodCommand,
  type BlueprintLayoutRequest,
  type BlueprintCommand,
  type BlueprintCommandTransaction,
  type BlueprintCommandDiagnosticCode,
  type BlueprintCommandDiagnostic,
} from './ai/blueprintCommands';
export {
  BLUEPRINT_COMMAND_JSON_SCHEMA,
  BLUEPRINT_NODE_CATALOG,
  BLUEPRINT_COMMAND_EXAMPLE,
} from './ai/commandSchema';
export {
  validateBlueprintCommandTransaction,
  executeBlueprintCommandTransaction,
  type BlueprintTransactionResult,
  type BlueprintSemanticContext,
  type BlueprintTransactionOptions,
} from './ai/commandExecutor';

// ---- Typed graph connection rules ----
export {
  createGraphConnectionValidator,
  resolveNodePorts,
  validateGraphConnection,
  type GraphNodeLike,
  type GraphEdgeLike,
  type ConnectionCandidate,
  type ConnectionDiagnosticCode,
  type ConnectionDiagnostic,
  type ConnectionValidationResult,
  type GraphConnectionValidator,
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
  type EngineTypeId,
  type EngineFieldId,
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
export { runtimeValueMatchesType } from './types/values';
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
  type ChapterOutput,
  type ChapterSource,
  type CharacterSource,
  type AssetSource,
  type EventSource,
  type SignalSource,
  type LocalizedTextSource,
  type StorySourceDocument,
  type BoundExpressionSource,
} from './types/source';
export type { CharacterTemplateField, CharacterTemplateSource } from './types/characterTemplate';
export {
  STORY_LOCALIZATION_FORMAT,
  STORY_LOCALIZATION_VERSION,
  type LocalizationSourceEntry,
  type LocalizationTranslationEntry,
  type LocalizationLocale,
  type StoryLocalizationDocument,
} from './types/localization';
export {
  choicePromptTextId,
  choiceOptionTextId,
  extractLocalizationSources,
  mergeLocalizationSources,
  localizationTranslationsForStory,
} from './localization/storyLocalization';
export {
  parseStoryLocalization,
  serializeStoryLocalization,
} from './serialization/localizationKdl';
export {
  STORY_CHARACTER_TEMPLATE_FORMAT,
  STORY_CHARACTER_TEMPLATE_VERSION,
  parseCharacterTemplate,
  serializeCharacterTemplate,
} from './serialization/characterTemplateKdl';
export {
  ENGINE_OBJECT_TYPE_MARKER,
  engineObjectTypeId,
  tagEngineObject,
  stripEngineObjectTypeMarkers,
  migrateEngineJsonValue,
  migrateEmbeddedEngineObjects,
  normalizeEngineTypeDefaults,
  summarizeEngineSchemaMigration,
  type EngineSchemaMigrationSummary,
} from './engineSchema';
export {
  replaceStoryResourceReferences,
  clearStoryResourceReferences,
  type StoryResourceReplacementContext,
} from './resourceReplacement';

export {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type ProjectStoryReference,
  type ProjectCharacterReference,
  type ProjectAssetReference,
  type EngineFieldType,
  type EngineMapKeyType,
  type EngineTypeField,
  type EngineTypeDefinition,
  engineValueMatchesFieldType,
  collectEngineResourceValueReferences,
  replaceEngineResourceValueReferences,
  clearEngineResourceValueReferences,
  type EngineResourceValueReference,
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
  type RuntimeTextVariant,
  type RuntimeTextTemplate,
  type DialogueInstruction,
  type InkBlockInstruction,
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
