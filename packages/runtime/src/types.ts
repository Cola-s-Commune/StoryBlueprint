import type {
  AssetId,
  BlockId,
  CharacterId,
  ChapterId,
  EventId,
  InstructionId,
  LocalizedVoiceRef,
  OptionId,
  ProgramId,
  ProgramLocation,
  RuntimeProgram,
  RuntimeValue,
  TextId,
  VariableId,
} from '@story-blueprint/common';

export type RuntimeStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface CallFrame {
  chapterId: ChapterId;
  returnTo: ProgramLocation;
  resultVariableId?: VariableId;
  locals: Record<string, RuntimeValue>;
}

export type PendingInteraction =
  | { kind: 'dialogue'; requestId: string; instructionId: InstructionId }
  | {
      kind: 'choice';
      requestId: string;
      instructionId: InstructionId;
      optionIds: readonly OptionId[];
    }
  | { kind: 'event'; requestId: string; instructionId: InstructionId; eventId: EventId };

/** Serializable state owned by the engine save system. */
export interface RuntimeState {
  programId: ProgramId;
  programContentVersion: string;
  blockId: BlockId;
  instructionIndex: number;
  callStack: CallFrame[];
  storyVariables: Record<string, RuntimeValue>;
  pending?: PendingInteraction;
  status: RuntimeStatus;
  randomSeed?: number;
}

export interface DialogueRequest {
  requestId: string;
  speakerId?: CharacterId;
  textId: TextId;
  defaultText: string;
  voice?: LocalizedVoiceRef;
  emotion?: string;
  portraitId?: AssetId;
  tags?: readonly string[];
}

export interface ChoiceRequest {
  requestId: string;
  promptTextId?: TextId;
  defaultPrompt?: string;
  options: readonly {
    id: OptionId;
    textId: TextId;
    defaultText: string;
    enabled: boolean;
  }[];
}

export interface EventRequest {
  requestId: string;
  eventId: EventId;
  arguments: Readonly<Record<string, RuntimeValue>>;
}

export interface StoryAdapter {
  showDialogue(request: DialogueRequest, signal: AbortSignal): Promise<void>;
  showChoice(request: ChoiceRequest, signal: AbortSignal): Promise<OptionId>;
  callEvent(request: EventRequest, signal: AbortSignal): Promise<RuntimeValue>;
  resolveText(textId: TextId, locale: string): Promise<string | undefined>;
  readExternalVariable(id: VariableId): Promise<RuntimeValue>;
  writeExternalVariable(id: VariableId, value: RuntimeValue): Promise<void>;
}

export type RuntimeDiagnosticCode =
  | 'PROGRAM_VERSION_MISMATCH'
  | 'INVALID_LOCATION'
  | 'INVALID_OPTION'
  | 'INVALID_ADAPTER_RESULT'
  | 'EXPRESSION_ERROR'
  | 'ADAPTER_ERROR'
  | 'ABORTED';

export interface RuntimeDiagnostic {
  code: RuntimeDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  location?: ProgramLocation;
  instructionId?: InstructionId;
  cause?: unknown;
}

export interface RuntimeSnapshot {
  program: RuntimeProgram;
  state: RuntimeState;
}
