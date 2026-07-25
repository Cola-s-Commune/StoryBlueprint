import type { TypedExpression } from './expressions';
import type {
  AssetId,
  BlockId,
  CharacterId,
  ChapterId,
  EventId,
  InstructionId,
  OptionId,
  ProgramId,
  TextId,
  VariableId,
} from './ids';
import type { RuntimeValue, ValueType, VariableDefinition } from './values';

export const STORY_RUNTIME_FORMAT = 'story-runtime' as const;
export const STORY_RUNTIME_VERSION = 1 as const;

export interface ProgramLocation {
  blockId: BlockId;
  instructionIndex: number;
}

export interface LocalizedVoiceRef {
  default?: AssetId;
  locales?: Readonly<Record<string, AssetId>>;
}

export type RuntimeTextPart =
  { kind: 'text'; value: string } | { kind: 'expression'; expression: TypedExpression };

export interface RuntimeTextTemplate {
  id: TextId;
  parts: readonly RuntimeTextPart[];
}

interface RuntimeInstructionBase {
  /** Compiler-generated stable ID. This is not an editor node ID. */
  id: InstructionId;
}

export interface DialogueInstruction extends RuntimeInstructionBase {
  op: 'dialogue';
  speakerId?: CharacterId;
  dynamicSpeaker?: TypedExpression;
  text: RuntimeTextTemplate;
  voice?: LocalizedVoiceRef;
  emotion?: string;
  portraitId?: AssetId;
  tags?: readonly string[];
}

export interface NarrationInstruction extends RuntimeInstructionBase {
  op: 'narration';
  textId: TextId;
  defaultText: string;
  voice?: LocalizedVoiceRef;
}

export interface SetVariableInstruction extends RuntimeInstructionBase {
  op: 'set-variable';
  variableId: VariableId;
  value: TypedExpression;
}

export type EventErrorPolicy =
  { kind: 'fail' } | { kind: 'continue' } | { kind: 'jump'; target: BlockId };

export interface CallEventInstruction extends RuntimeInstructionBase {
  op: 'call-event';
  eventId: EventId;
  arguments: Readonly<Record<string, TypedExpression>>;
  resultVariableId?: VariableId;
  onError: EventErrorPolicy;
}

export interface ChoiceOptionInstruction {
  id: OptionId;
  text: RuntimeTextTemplate;
  visibleIf?: TypedExpression;
  enabledIf?: TypedExpression;
  target: BlockId;
}

export interface ChoiceInstruction extends RuntimeInstructionBase {
  op: 'choice';
  prompt?: RuntimeTextTemplate;
  options: readonly ChoiceOptionInstruction[];
}

export interface BranchInstruction extends RuntimeInstructionBase {
  op: 'branch';
  condition: TypedExpression;
  whenTrue: BlockId;
  whenFalse: BlockId;
}

export interface JumpInstruction extends RuntimeInstructionBase {
  op: 'jump';
  target: BlockId;
}

export interface CallChapterInstruction extends RuntimeInstructionBase {
  op: 'call-chapter';
  chapterId: ChapterId;
  target: BlockId;
  arguments: Readonly<Record<VariableId, TypedExpression>>;
  returnTo: ProgramLocation;
  resultVariableId?: VariableId;
}

export interface ReturnInstruction extends RuntimeInstructionBase {
  op: 'return';
  value?: TypedExpression;
}

export interface EndStoryInstruction extends RuntimeInstructionBase {
  op: 'end-story';
}

export type RuntimeInstruction =
  | DialogueInstruction
  | NarrationInstruction
  | SetVariableInstruction
  | CallEventInstruction
  | ChoiceInstruction
  | BranchInstruction
  | JumpInstruction
  | CallChapterInstruction
  | ReturnInstruction
  | EndStoryInstruction;

export type RuntimeTerminator =
  | ChoiceInstruction
  | BranchInstruction
  | JumpInstruction
  | CallChapterInstruction
  | ReturnInstruction
  | EndStoryInstruction;

export interface RuntimeBlock {
  id: BlockId;
  instructions: readonly RuntimeInstruction[];
}

export interface RuntimeChapterDefinition {
  id: ChapterId;
  entryBlockId: BlockId;
  parameters: readonly { variableId: VariableId; valueType: ValueType }[];
  localVariables: readonly VariableDefinition[];
  returnType?: ValueType;
}

export interface RuntimeProgram {
  format: typeof STORY_RUNTIME_FORMAT;
  version: typeof STORY_RUNTIME_VERSION;
  id: ProgramId;
  /** Changes whenever executable content changes and is stored in save games. */
  contentVersion: string;
  entryBlockId: BlockId;
  blocks: Readonly<Record<string, RuntimeBlock>>;
  chapters: Readonly<Record<string, RuntimeChapterDefinition>>;
  variables: readonly VariableDefinition[];
  constants?: Readonly<Record<string, RuntimeValue>>;
}

export function isRuntimeTerminator(
  instruction: RuntimeInstruction,
): instruction is RuntimeTerminator {
  return (
    instruction.op === 'choice' ||
    instruction.op === 'branch' ||
    instruction.op === 'jump' ||
    instruction.op === 'call-chapter' ||
    instruction.op === 'return' ||
    instruction.op === 'end-story'
  );
}
