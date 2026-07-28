import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  type BlockId,
  type ChoiceInstruction,
  type CallEventInstruction,
  type SignalId,
  type OptionId,
  type RuntimeInstruction,
  type RuntimeProgram,
  type RuntimeValue,
  type VariableId,
} from '@story-blueprint/common';
import { evaluateExpression, renderTextTemplate, resolveChoiceOptions } from './evaluator';
import type {
  ChoiceRequest,
  DialogueRequest,
  EventRequest,
  SignalRequest,
  RuntimeDiagnostic,
  RuntimeState,
} from './types';

export type RuntimeInteraction =
  | { kind: 'dialogue'; request: DialogueRequest }
  | { kind: 'choice'; request: ChoiceRequest }
  | { kind: 'event'; request: EventRequest }
  | { kind: 'signal'; request: SignalRequest };

export type RuntimeRunResult =
  | { kind: 'waiting'; state: RuntimeState; interaction: RuntimeInteraction }
  | { kind: 'completed'; state: RuntimeState }
  | { kind: 'failed'; state: RuntimeState; diagnostic: RuntimeDiagnostic };

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    callStack: state.callStack.map((frame) => ({ ...frame, locals: { ...frame.locals } })),
    storyVariables: { ...state.storyVariables },
    signalInbox: { ...state.signalInbox },
    pending: state.pending ? { ...state.pending } : undefined,
  };
}

export function createRuntimeState(program: RuntimeProgram): RuntimeState {
  return {
    programId: program.id,
    programContentVersion: program.contentVersion,
    blockId: program.entryBlockId,
    instructionIndex: 0,
    callStack: [],
    storyVariables: Object.fromEntries(
      program.variables.map((variable) => [variable.id, variable.defaultValue]),
    ),
    signalInbox: {},
    status: 'running',
  };
}

/** Engine-independent executor that runs until it reaches a user interaction or termination. */
export class StoryRuntime {
  private readonly program: RuntimeProgram;
  private currentState: RuntimeState;
  private lastDiagnostic?: RuntimeDiagnostic;

  constructor(program: RuntimeProgram, restoredState?: RuntimeState) {
    if (program.format !== STORY_RUNTIME_FORMAT || program.version !== STORY_RUNTIME_VERSION) {
      throw new Error(`Unsupported runtime program ${program.format}@${program.version}`);
    }
    if (
      restoredState &&
      (restoredState.programId !== program.id ||
        restoredState.programContentVersion !== program.contentVersion)
    ) {
      throw new Error('Runtime state does not match the program content version');
    }
    this.program = program;
    this.currentState = cloneState(restoredState ?? createRuntimeState(program));
  }

  get state(): RuntimeState {
    return cloneState(this.currentState);
  }

  get diagnostic(): RuntimeDiagnostic | undefined {
    return this.lastDiagnostic;
  }

  runUntilPause(maxInstructions = 10_000): RuntimeRunResult {
    if (this.currentState.status === 'completed') return this.completed();
    if (this.currentState.status === 'failed') {
      return this.failed(
        this.lastDiagnostic ?? {
          code: 'INVALID_LOCATION',
          severity: 'error',
          message: 'Runtime is already in a failed state',
        },
      );
    }
    if (this.currentState.status === 'waiting') {
      const interaction = this.resolvePendingInteraction();
      return interaction ? this.waiting(interaction) : this.failInvalidLocation();
    }

    let executed = 0;
    try {
      while (executed < maxInstructions) {
        executed += 1;
        const instruction = this.currentInstruction();
        if (!instruction) return this.failInvalidLocation();
        const result = this.execute(instruction);
        if (result) return result;
      }
      return this.fail({
        code: 'TIGHT_LOOP',
        severity: 'error',
        message: `Runtime executed ${maxInstructions} instructions without reaching a stable point`,
        location: this.location(),
      });
    } catch (cause) {
      return this.fail({
        code: 'EXPRESSION_ERROR',
        severity: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        location: this.location(),
        instructionId: this.currentInstruction()?.id,
        cause,
      });
    }
  }

  continueDialogue(): RuntimeRunResult {
    if (this.currentState.pending?.kind !== 'dialogue') {
      return this.fail({
        code: 'INVALID_ADAPTER_RESULT',
        severity: 'error',
        message: 'Runtime is not waiting for dialogue continuation',
        location: this.location(),
      });
    }
    this.currentState.pending = undefined;
    this.currentState.status = 'running';
    this.currentState.instructionIndex += 1;
    return this.runUntilPause();
  }

  choose(optionId: OptionId): RuntimeRunResult {
    const instruction = this.currentInstruction();
    if (this.currentState.pending?.kind !== 'choice' || instruction?.op !== 'choice') {
      return this.fail({
        code: 'INVALID_ADAPTER_RESULT',
        severity: 'error',
        message: 'Runtime is not waiting for a choice',
        location: this.location(),
      });
    }
    const option = this.resolvedOptions(instruction).find(
      (candidate) => candidate.id === optionId && candidate.enabled,
    );
    if (!option) {
      return this.fail({
        code: 'INVALID_OPTION',
        severity: 'error',
        message: `Choice option ${optionId} is missing, hidden, or disabled`,
        location: this.location(),
        instructionId: instruction.id,
      });
    }
    this.currentState.pending = undefined;
    this.jump(option.target);
    return this.runUntilPause();
  }

  continueEvent(): RuntimeRunResult {
    const instruction = this.currentInstruction();
    if (this.currentState.pending?.kind !== 'event' || instruction?.op !== 'call-event') {
      return this.fail({
        code: 'INVALID_ADAPTER_RESULT',
        severity: 'error',
        message: 'Runtime is not waiting for an event dispatch',
        location: this.location(),
      });
    }
    this.currentState.pending = undefined;
    this.currentState.status = 'running';
    this.currentState.instructionIndex += 1;
    return this.runUntilPause();
  }

  /** Delivers a signal. Early signals are buffered in serializable runtime state. */
  sendSignal(signalId: SignalId): RuntimeRunResult | undefined {
    if (
      this.currentState.pending?.kind === 'signal' &&
      this.currentState.pending.signalId === signalId
    ) {
      this.currentState.pending = undefined;
      this.currentState.status = 'running';
      this.currentState.instructionIndex += 1;
      return this.runUntilPause();
    }
    this.currentState.signalInbox[signalId] = (this.currentState.signalInbox[signalId] ?? 0) + 1;
    return undefined;
  }

  abort(): RuntimeRunResult {
    return this.fail({
      code: 'ABORTED',
      severity: 'error',
      message: 'Runtime execution was aborted',
      location: this.location(),
    });
  }

  failAdapter(cause: unknown): RuntimeRunResult {
    return this.fail({
      code: 'ADAPTER_ERROR',
      severity: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
      location: this.location(),
      instructionId: this.currentInstruction()?.id,
      cause,
    });
  }

  private execute(instruction: RuntimeInstruction): RuntimeRunResult | undefined {
    switch (instruction.op) {
      case 'dialogue': {
        this.currentState.pending = {
          kind: 'dialogue',
          requestId: instruction.id,
          instructionId: instruction.id,
        };
        this.currentState.status = 'waiting';
        return this.waiting({
          kind: 'dialogue',
          request: {
            requestId: instruction.id,
            speakerId: instruction.speakerId,
            textId: instruction.text.id,
            defaultText: renderTextTemplate(instruction.text, this.readVariable),
            voice: instruction.voice,
            emotion: instruction.emotion,
            portraitId: instruction.portraitId,
            tags: instruction.tags,
          },
        });
      }
      case 'set-variable':
        this.writeVariable(
          instruction.variableId,
          evaluateExpression(instruction.value, this.readVariable),
        );
        this.currentState.instructionIndex += 1;
        return undefined;
      case 'call-event': {
        this.currentState.pending = {
          kind: 'event',
          requestId: instruction.id,
          instructionId: instruction.id,
          eventId: instruction.eventId,
        };
        this.currentState.status = 'waiting';
        return this.waiting(this.eventInteraction(instruction));
      }
      case 'wait-signal': {
        const buffered = this.currentState.signalInbox[instruction.signalId] ?? 0;
        if (buffered > 0) {
          if (buffered === 1) delete this.currentState.signalInbox[instruction.signalId];
          else this.currentState.signalInbox[instruction.signalId] = buffered - 1;
          this.currentState.instructionIndex += 1;
          return undefined;
        }
        this.currentState.pending = {
          kind: 'signal',
          requestId: instruction.id,
          instructionId: instruction.id,
          signalId: instruction.signalId,
        };
        this.currentState.status = 'waiting';
        return this.waiting({
          kind: 'signal',
          request: { requestId: instruction.id, signalId: instruction.signalId },
        });
      }
      case 'branch': {
        const condition = evaluateExpression(instruction.condition, this.readVariable);
        if (typeof condition !== 'boolean') throw new TypeError('Branch condition must be boolean');
        this.jump(condition ? instruction.whenTrue : instruction.whenFalse);
        return undefined;
      }
      case 'jump':
        this.jump(instruction.target);
        return undefined;
      case 'choice': {
        const options = this.resolvedOptions(instruction);
        if (options.length === 0) {
          return this.fail({
            code: 'INVALID_OPTION',
            severity: 'error',
            message: 'Choice has no visible options',
            location: this.location(),
            instructionId: instruction.id,
          });
        }
        this.currentState.pending = {
          kind: 'choice',
          requestId: instruction.id,
          instructionId: instruction.id,
          optionIds: options.map((option) => option.id),
        };
        this.currentState.status = 'waiting';
        return this.waiting(this.choiceInteraction(instruction));
      }
      case 'call-chapter': {
        const chapter = this.program.chapters[instruction.chapterId];
        if (!chapter) {
          return this.fail({
            code: 'INVALID_LOCATION',
            severity: 'error',
            message: `Missing substory ${instruction.chapterId}`,
            location: this.location(),
            instructionId: instruction.id,
          });
        }
        const locals: Record<string, RuntimeValue> = Object.fromEntries(
          chapter.localVariables.map((variable) => [variable.id, variable.defaultValue]),
        );
        for (const [variableId, expression] of Object.entries(instruction.arguments)) {
          locals[variableId] = evaluateExpression(expression, this.readVariable);
        }
        this.currentState.callStack.push({
          chapterId: instruction.chapterId,
          returnTo: instruction.returnTo,
          resultVariableId: instruction.resultVariableId,
          locals,
        });
        this.jump(instruction.target);
        return undefined;
      }
      case 'return': {
        const value = instruction.value
          ? evaluateExpression(instruction.value, this.readVariable)
          : undefined;
        const frame = this.currentState.callStack.pop();
        if (!frame) {
          return this.fail({
            code: 'INVALID_LOCATION',
            severity: 'error',
            message: 'Return executed without a calling substory frame',
            location: this.location(),
            instructionId: instruction.id,
          });
        }
        this.currentState.blockId = frame.returnTo.blockId;
        this.currentState.instructionIndex = frame.returnTo.instructionIndex;
        this.currentState.status = 'running';
        if (frame.resultVariableId && value !== undefined) {
          this.writeVariable(frame.resultVariableId, value);
        }
        return undefined;
      }
      case 'end-story':
        this.currentState.pending = undefined;
        this.currentState.status = 'completed';
        return this.completed();
      default:
        return this.fail({
          code: 'UNSUPPORTED_INSTRUCTION',
          severity: 'error',
          message: `Instruction ${instruction.op} is not supported by the core runtime yet`,
          location: this.location(),
          instructionId: instruction.id,
        });
    }
  }

  private resolvePendingInteraction(): RuntimeInteraction | undefined {
    const instruction = this.currentInstruction();
    if (this.currentState.pending?.kind === 'dialogue' && instruction?.op === 'dialogue') {
      return {
        kind: 'dialogue',
        request: {
          requestId: instruction.id,
          speakerId: instruction.speakerId,
          textId: instruction.text.id,
          defaultText: renderTextTemplate(instruction.text, this.readVariable),
          voice: instruction.voice,
          emotion: instruction.emotion,
          portraitId: instruction.portraitId,
          tags: instruction.tags,
        },
      };
    }
    if (this.currentState.pending?.kind === 'choice' && instruction?.op === 'choice') {
      return this.choiceInteraction(instruction);
    }
    if (this.currentState.pending?.kind === 'event' && instruction?.op === 'call-event') {
      return this.eventInteraction(instruction);
    }
    if (this.currentState.pending?.kind === 'signal' && instruction?.op === 'wait-signal') {
      return {
        kind: 'signal',
        request: { requestId: instruction.id, signalId: instruction.signalId },
      };
    }
    return undefined;
  }

  private eventInteraction(instruction: CallEventInstruction): RuntimeInteraction {
    return {
      kind: 'event',
      request: {
        requestId: instruction.id,
        eventId: instruction.eventId,
        arguments: Object.fromEntries(
          Object.entries(instruction.arguments).map(([name, expression]) => [
            name,
            evaluateExpression(expression, this.readVariable),
          ]),
        ),
      },
    };
  }

  private choiceInteraction(instruction: ChoiceInstruction): RuntimeInteraction {
    const options = this.resolvedOptions(instruction);
    return {
      kind: 'choice',
      request: {
        requestId: instruction.id,
        promptTextId: instruction.prompt?.id,
        defaultPrompt: instruction.prompt
          ? renderTextTemplate(instruction.prompt, this.readVariable)
          : undefined,
        options: options.map((option) => ({
          id: option.id,
          textId: instruction.options.find((source) => source.id === option.id)!.text.id,
          defaultText: option.text,
          enabled: option.enabled,
        })),
      },
    };
  }

  private resolvedOptions(instruction: ChoiceInstruction) {
    return resolveChoiceOptions(instruction, this.readVariable);
  }

  private readonly readVariable = (id: VariableId): RuntimeValue => {
    const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
    if (frame && id in frame.locals) return frame.locals[id];
    if (!(id in this.currentState.storyVariables)) throw new TypeError(`Missing variable ${id}`);
    return this.currentState.storyVariables[id];
  };

  private writeVariable(id: VariableId, value: RuntimeValue): void {
    const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
    if (frame && id in frame.locals) frame.locals[id] = value;
    else this.currentState.storyVariables[id] = value;
  }

  private currentInstruction(): RuntimeInstruction | undefined {
    return this.program.blocks[this.currentState.blockId]?.instructions[
      this.currentState.instructionIndex
    ];
  }

  private jump(target: BlockId): void {
    this.currentState.blockId = target;
    this.currentState.instructionIndex = 0;
    this.currentState.status = 'running';
  }

  private location() {
    return {
      blockId: this.currentState.blockId,
      instructionIndex: this.currentState.instructionIndex,
    };
  }

  private waiting(interaction: RuntimeInteraction): RuntimeRunResult {
    return { kind: 'waiting', state: this.state, interaction };
  }

  private completed(): RuntimeRunResult {
    return { kind: 'completed', state: this.state };
  }

  private failed(diagnostic: RuntimeDiagnostic): RuntimeRunResult {
    return { kind: 'failed', state: this.state, diagnostic };
  }

  private fail(diagnostic: RuntimeDiagnostic): RuntimeRunResult {
    this.lastDiagnostic = diagnostic;
    this.currentState.pending = undefined;
    this.currentState.status = 'failed';
    return this.failed(diagnostic);
  }

  private failInvalidLocation(): RuntimeRunResult {
    return this.fail({
      code: 'INVALID_LOCATION',
      severity: 'error',
      message: `No instruction at ${this.currentState.blockId}:${this.currentState.instructionIndex}`,
      location: this.location(),
    });
  }
}
