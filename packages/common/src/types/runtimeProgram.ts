import type { TypedExpression } from './expressions';
import type {
  AssetId,
  BlockId,
  CharacterId,
  ChapterId,
  EventId,
  ExternalFunctionId,
  SignalId,
  InstructionId,
  OptionId,
  ProgramId,
  TextId,
  VariableId,
} from './ids';
import type { RuntimeValue, ValueType, VariableDefinition } from './values';

export const STORY_RUNTIME_FORMAT = 'story-runtime' as const;
export const STORY_RUNTIME_VERSION = 6 as const;

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

export interface RuntimeTextVariant {
  parts: readonly RuntimeTextPart[];
}

export interface RuntimeTextTemplate {
  id: TextId;
  parts: readonly RuntimeTextPart[];
  locales?: Readonly<Record<string, RuntimeTextVariant>>;
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

export interface InkBlockInstruction extends RuntimeInstructionBase {
  op: 'ink-block';
  /** Compiled Ink JSON, kept in the node-free runtime artifact. */
  inkJson: string;
  entryKnot?: string;
  variableBindings: readonly {
    inkName: string;
    variableId: VariableId;
    direction: 'story-to-ink' | 'ink-to-story' | 'two-way';
  }[];
  externalFunctionBindings?: readonly {
    inkName: string;
    functionId: ExternalFunctionId;
    parameterNames: readonly string[];
  }[];
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
  containerOperation?: 'append' | 'set-entry' | 'set-field';
  key?: TypedExpression;
  fieldName?: string;
}

export interface CallEventInstruction extends RuntimeInstructionBase {
  op: 'call-event';
  eventId: EventId;
  arguments: Readonly<Record<string, TypedExpression>>;
  outputs: readonly { id: string; name: string; valueType: ValueType }[];
  resultVariableIds: Readonly<Record<string, VariableId>>;
  instanceVariableId?: VariableId;
}

export interface WaitSignalInstruction extends RuntimeInstructionBase {
  op: 'wait-signal';
  signalId: SignalId;
  matches: Readonly<Record<string, TypedExpression>>;
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
  resultVariableIds: Readonly<Record<VariableId, VariableId>>;
}

export interface StoryControlArgumentSet {
  readonly [key: string]: TypedExpression;
}

export interface StartStoryInstruction extends RuntimeInstructionBase {
  op: 'start-story';
  storyId: import('./ids').StoryId;
  instanceId?: TypedExpression;
  arguments: StoryControlArgumentSet;
  resultVariableIds: Readonly<Record<string, VariableId>>;
  instanceVariableId?: VariableId;
  waitForCompletion: boolean;
}

export interface SwitchStoryInstruction extends RuntimeInstructionBase {
  op: 'switch-story';
  storyId: import('./ids').StoryId;
  instanceId?: TypedExpression;
  arguments: StoryControlArgumentSet;
  resultVariableIds: Readonly<Record<string, VariableId>>;
  instanceVariableId?: VariableId;
  waitForCompletion: boolean;
}

export interface ResumeStoryInstruction extends RuntimeInstructionBase {
  op: 'resume-story';
  instanceId: TypedExpression;
  resultVariableIds: Readonly<Record<string, VariableId>>;
  instanceVariableId?: VariableId;
  waitForCompletion: boolean;
}

export interface EndStoryInstanceInstruction extends RuntimeInstructionBase {
  op: 'end-story-instance';
  instanceId: TypedExpression;
  resultVariableIds: Readonly<Record<string, VariableId>>;
}

export interface ReturnInstruction extends RuntimeInstructionBase {
  op: 'return';
  values: Readonly<Record<VariableId, TypedExpression>>;
}

export interface EndStoryInstruction extends RuntimeInstructionBase {
  op: 'end-story';
}

export type RuntimeInstruction =
  | DialogueInstruction
  | InkBlockInstruction
  | NarrationInstruction
  | SetVariableInstruction
  | CallEventInstruction
  | WaitSignalInstruction
  | ChoiceInstruction
  | BranchInstruction
  | JumpInstruction
  | CallChapterInstruction
  | StartStoryInstruction
  | SwitchStoryInstruction
  | ResumeStoryInstruction
  | EndStoryInstanceInstruction
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
  parameters: readonly {
    variableId: VariableId;
    valueType: ValueType;
    defaultValue: RuntimeValue;
  }[];
  outputs: readonly {
    variableId: VariableId;
    valueType: ValueType;
  }[];
  localVariables: readonly VariableDefinition[];
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
  sourceLocale?: string;
  locales?: readonly string[];
  localeFallbacks?: Readonly<Record<string, string>>;
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
