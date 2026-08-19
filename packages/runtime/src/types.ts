import type {
  AssetId,
  BlockId,
  CharacterId,
  ChapterId,
  EventId,
  SignalId,
  InstructionId,
  LocalizedVoiceRef,
  OptionId,
  ProgramId,
  ProgramLocation,
  RuntimeProgram,
  RuntimeValue,
  TextId,
  VariableDefinition,
  VariableId,
} from '@story-blueprint/common';

export type RuntimeStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface CallFrame {
  chapterId: ChapterId;
  returnTo: ProgramLocation;
  resultVariableIds: Record<string, VariableId>;
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
  | { kind: 'event'; requestId: string; instructionId: InstructionId; eventId: EventId }
  | {
      kind: 'signal';
      requestId: string;
      instructionId: InstructionId;
      signalId: SignalId;
      matches: SignalPayload;
    };

export type SignalPayload = Readonly<Record<string, RuntimeValue>>;

/** Serializable state owned by the engine save system. */
export interface RuntimeState {
  programId: ProgramId;
  programContentVersion: string;
  blockId: BlockId;
  instructionIndex: number;
  callStack: CallFrame[];
  storyVariables: Record<string, RuntimeValue>;
  /** Full payloads received before a matching Wait for Signal instruction. */
  signalInbox: Record<string, SignalPayload[]>;
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

export interface SignalRequest {
  requestId: string;
  signalId: SignalId;
  /** Evaluated partial parameter constraints. Omitted parameters match any value. */
  matches: SignalPayload;
}

export interface StoryAdapter {
  showDialogue(request: DialogueRequest, signal: AbortSignal): Promise<void>;
  showChoice(request: ChoiceRequest, signal: AbortSignal): Promise<OptionId>;
  /** Dispatches an engine action. Resolving means dispatched, not completed. */
  callEvent(request: EventRequest, signal: AbortSignal): Promise<void>;
  /** Resolves when the engine observes the requested signal. */
  waitForSignal(request: SignalRequest, signal: AbortSignal): Promise<SignalPayload>;
  resolveText(textId: TextId, locale: string): Promise<string | undefined>;
  readExternalVariable(variable: VariableDefinition): Promise<RuntimeValue>;
  writeExternalVariable(variable: VariableDefinition, value: RuntimeValue): Promise<void>;
}

export type RuntimeDiagnosticCode =
  | 'PROGRAM_VERSION_MISMATCH'
  | 'INVALID_LOCATION'
  | 'INVALID_OPTION'
  | 'INVALID_ADAPTER_RESULT'
  | 'EXPRESSION_ERROR'
  | 'ADAPTER_ERROR'
  | 'UNSUPPORTED_INSTRUCTION'
  | 'TIGHT_LOOP'
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
