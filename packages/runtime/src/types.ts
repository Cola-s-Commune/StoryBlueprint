import type {
  AssetId,
  BlockId,
  CharacterId,
  ChapterId,
  EventId,
  ExternalFunctionId,
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
  /** Instruction that opened this frame, used by connected output Pins. */
  callInstructionId: string;
  returnTo: ProgramLocation;
  resultVariableIds: Record<string, VariableId>;
  locals: Record<string, RuntimeValue>;
}

export type PendingInteraction =
  | { kind: 'dialogue'; requestId: string; instructionId: InstructionId }
  | { kind: 'narration'; requestId: string; instructionId: InstructionId }
  | {
      kind: 'ink-dialogue';
      requestId: string;
      instructionId: InstructionId;
      defaultText: string;
      textId: TextId;
      speakerId?: CharacterId;
      voiceId?: AssetId;
      emotion?: string;
      tags?: readonly string[];
    }
  | {
      kind: 'choice';
      requestId: string;
      instructionId: InstructionId;
      optionIds: readonly OptionId[];
    }
  | {
      kind: 'ink-choice';
      requestId: string;
      instructionId: InstructionId;
      options: readonly { id: OptionId; text: string; choiceIndex: number }[];
    }
  | { kind: 'event'; requestId: string; instructionId: InstructionId; eventId: EventId }
  | {
      kind: 'signal';
      requestId: string;
      instructionId: InstructionId;
      signalId: SignalId;
      matches: SignalPayload;
    }
  | {
      kind: 'story-control';
      requestId: string;
      instructionId: InstructionId;
      action: 'start' | 'switch' | 'resume' | 'end';
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
  /** Return values from completed External Function calls, keyed by instruction and output ID. */
  eventOutputs?: Record<string, Record<string, RuntimeValue>>;
  /** Return values from completed Substory calls, keyed by call instruction and output ID. */
  substoryOutputs?: Record<string, Record<string, RuntimeValue>>;
  /** Payload values from matched Wait for Signal instructions, keyed by instruction and parameter name. */
  signalOutputs?: Record<string, Record<string, RuntimeValue>>;
  /** Serialized state for the currently executing embedded Ink Block. */
  ink?: { instructionId: InstructionId; stateJson: string; interactionIndex: number };
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

/** An unassigned narrative beat such as action, scene description, or inner thought. */
export interface NarrationRequest {
  requestId: string;
  textId: TextId;
  defaultText: string;
  voice?: LocalizedVoiceRef;
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
  outputs: readonly {
    id: string;
    name: string;
    valueType: import('@story-blueprint/common').ValueType;
  }[];
}

/** Synchronous bridge used only while Ink evaluates an EXTERNAL call. */
export interface ExternalFunctionRequest {
  functionId: ExternalFunctionId;
  arguments: Readonly<Record<string, RuntimeValue>>;
}

export type EventResult = Readonly<Record<string, RuntimeValue>>;

export interface SignalRequest {
  requestId: string;
  signalId: SignalId;
  /** Evaluated partial parameter constraints. Omitted parameters match any value. */
  matches: SignalPayload;
}

export type StoryControlAction = 'start' | 'switch' | 'resume' | 'end';

export interface StoryControlRequest {
  requestId: string;
  action: StoryControlAction;
  storyId?: import('@story-blueprint/common').StoryId;
  instanceId?: string;
  arguments: Readonly<Record<string, RuntimeValue>>;
  waitForCompletion: boolean;
}

export interface StoryControlResult {
  instanceId?: string;
  outputs?: Readonly<Record<string, RuntimeValue>>;
}

export interface StoryAdapter {
  showDialogue(request: DialogueRequest, signal: AbortSignal): Promise<void>;
  /** Optional dedicated presentation path. Omitted adapters receive narration as speakerless dialogue. */
  showNarration?(request: NarrationRequest, signal: AbortSignal): Promise<void>;
  showChoice(request: ChoiceRequest, signal: AbortSignal): Promise<OptionId>;
  /** Calls an engine action and resolves with values keyed by stable Event Output ID. */
  callEvent(request: EventRequest, signal: AbortSignal): Promise<EventResult>;
  /** Optional synchronous implementation for Ink EXTERNAL functions. */
  callExternalFunctionSync?(request: ExternalFunctionRequest): RuntimeValue;
  /** Resolves when the engine observes the requested signal. */
  waitForSignal(request: SignalRequest, signal: AbortSignal): Promise<SignalPayload>;
  /** Starts, switches, resumes, or ends independent Story runtime instances. */
  controlStory?(request: StoryControlRequest, signal: AbortSignal): Promise<StoryControlResult>;
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
  | 'ABORTED'
  | 'INK_METADATA_ERROR'
  | 'INK_VARIABLE_ERROR'
  | 'INK_EXTERNAL_FUNCTION_ERROR'
  | 'INK_RUNTIME_ERROR'
  | 'INK_CHOICE_ERROR';

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
