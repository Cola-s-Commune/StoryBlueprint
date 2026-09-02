import {
  runtimeValueMatchesType,
  parseInkDialogueMetadata,
  isStableId,
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
  type VariableDefinition,
  type VariableId,
} from '@story-blueprint/common';
import { Story as InkStory } from 'inkjs';
import { evaluateExpression, renderTextTemplate, resolveChoiceOptions } from './evaluator';
import type {
  ChoiceRequest,
  DialogueRequest,
  EventRequest,
  ExternalFunctionRequest,
  SignalRequest,
  SignalPayload,
  StoryControlRequest,
  StoryControlResult,
  RuntimeDiagnostic,
  RuntimeState,
} from './types';

export type RuntimeInteraction =
  | { kind: 'dialogue'; request: DialogueRequest }
  | { kind: 'choice'; request: ChoiceRequest }
  | { kind: 'event'; request: EventRequest }
  | { kind: 'signal'; request: SignalRequest }
  | { kind: 'story-control'; request: StoryControlRequest };

export type RuntimeRunResult =
  | { kind: 'waiting'; state: RuntimeState; interaction: RuntimeInteraction }
  | { kind: 'completed'; state: RuntimeState }
  | { kind: 'failed'; state: RuntimeState; diagnostic: RuntimeDiagnostic };

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    callStack: state.callStack.map((frame) => ({
      ...frame,
      resultVariableIds: { ...frame.resultVariableIds },
      locals: { ...frame.locals },
    })),
    storyVariables: { ...state.storyVariables },
    signalInbox: Object.fromEntries(
      Object.entries(state.signalInbox).map(([signalId, payloads]) => [
        signalId,
        payloads.map((payload) => ({ ...payload })),
      ]),
    ),
    pending: state.pending
      ? state.pending.kind === 'signal'
        ? { ...state.pending, matches: { ...state.pending.matches } }
        : state.pending.kind === 'ink-choice'
          ? {
              ...state.pending,
              options: state.pending.options.map((option) => ({ ...option })),
            }
          : state.pending.kind === 'ink-dialogue'
            ? {
                ...state.pending,
                tags: state.pending.tags ? [...state.pending.tags] : undefined,
              }
            : { ...state.pending }
      : undefined,
    ink: state.ink ? { ...state.ink } : undefined,
  };
}

function payloadMatches(payload: SignalPayload, matches: SignalPayload): boolean {
  return Object.entries(matches).every(
    ([name, expected]) => name in payload && jsonValueEquals(payload[name], expected),
  );
}

function jsonValueEquals(left: RuntimeValue, right: RuntimeValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValueEquals(value, right[index]!))
    );
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const leftRecord = left as Readonly<Record<string, RuntimeValue>>;
  const rightRecord = right as Readonly<Record<string, RuntimeValue>>;
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => key in rightRecord && jsonValueEquals(leftRecord[key]!, rightRecord[key]!),
    )
  );
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
  private readonly pendingExternalWrites = new Map<VariableId, RuntimeValue>();
  private readonly variableDefinitions: ReadonlyMap<VariableId, VariableDefinition>;
  private readonly externalVariableDefinitions: ReadonlyMap<VariableId, VariableDefinition>;
  private readonly externalVariableIdSet: ReadonlySet<VariableId>;
  private locale?: string;
  private externalFunctionResolver?: (request: ExternalFunctionRequest) => RuntimeValue;

  constructor(program: RuntimeProgram, restoredState?: RuntimeState, locale?: string) {
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
    this.variableDefinitions = new Map(
      program.variables.map((variable) => [variable.id, variable]),
    );
    this.externalVariableDefinitions = new Map(
      program.variables
        .filter((variable) => variable.scope === 'character' || variable.scope === 'project')
        .map((variable) => [variable.id, variable]),
    );
    this.externalVariableIdSet = new Set(this.externalVariableDefinitions.keys());
    this.currentState = cloneState(restoredState ?? createRuntimeState(program));
    this.validateRestoredState(this.currentState);
    this.locale = locale ?? program.sourceLocale;
  }

  get state(): RuntimeState {
    return cloneState(this.currentState);
  }

  get externalVariableIds(): readonly VariableId[] {
    return [...this.externalVariableIdSet];
  }

  get externalVariables(): readonly VariableDefinition[] {
    return [...this.externalVariableDefinitions.values()];
  }

  get currentLocale(): string | undefined {
    return this.locale;
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }

  /** Installs the synchronous bridge used by embedded Ink EXTERNAL calls. */
  setExternalFunctionResolver(
    resolver: ((request: ExternalFunctionRequest) => RuntimeValue) | undefined,
  ): void {
    this.externalFunctionResolver = resolver;
  }

  /** Supplies the engine-owned value before story execution begins. */
  hydrateExternalVariable(id: VariableId, value: RuntimeValue): void {
    const definition = this.externalVariableDefinitions.get(id);
    if (!definition) {
      throw new TypeError(`Unknown external variable ${id}`);
    }
    this.assertValueType(value, definition, 'External variable');
    this.currentState.storyVariables[id] = value;
  }

  /** Returns coalesced engine writes without removing them from the retryable queue. */
  peekExternalVariableWrites(): readonly {
    variable: VariableDefinition;
    value: RuntimeValue;
  }[] {
    return [...this.pendingExternalWrites].map(([id, value]) => ({
      variable: this.externalVariableDefinitions.get(id)!,
      value,
    }));
  }

  /** Confirms one successful engine write. Failed and later writes remain retryable. */
  acknowledgeExternalVariableWrite(id: VariableId): void {
    this.pendingExternalWrites.delete(id);
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
    const instruction = this.currentInstruction();
    if (this.currentState.pending?.kind === 'ink-dialogue' && instruction?.op === 'ink-block') {
      this.currentState.pending = undefined;
      this.currentState.status = 'running';
      return this.advanceInk(instruction) ?? this.runUntilPause();
    }
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
    if (this.currentState.pending?.kind === 'ink-choice' && instruction?.op === 'ink-block') {
      const choice = this.currentState.pending.options.find((option) => option.id === optionId);
      if (!choice) {
        return this.fail({
          code: 'INVALID_OPTION',
          severity: 'error',
          message: `Ink choice option ${optionId} is missing`,
          location: this.location(),
          instructionId: instruction.id,
        });
      }
      try {
        const story = this.inkStory(instruction);
        story.ChooseChoiceIndex(choice.choiceIndex);
        this.currentState.pending = undefined;
        this.currentState.status = 'running';
        return this.advanceInk(instruction, story) ?? this.runUntilPause();
      } catch (cause) {
        return this.fail({
          code: 'INK_EXTERNAL_FUNCTION_ERROR',
          severity: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
          location: this.location(),
          instructionId: instruction.id,
          cause,
        });
      }
    }
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

  continueEvent(result: Readonly<Record<string, RuntimeValue>> = {}): RuntimeRunResult {
    const instruction = this.currentInstruction();
    if (this.currentState.pending?.kind !== 'event' || instruction?.op !== 'call-event') {
      return this.fail({
        code: 'INVALID_ADAPTER_RESULT',
        severity: 'error',
        message: 'Runtime is not waiting for an event dispatch',
        location: this.location(),
      });
    }
    for (const output of instruction.outputs) {
      if (!(output.id in result)) {
        return this.fail({
          code: 'INVALID_ADAPTER_RESULT',
          severity: 'error',
          message: `Event result is missing ${output.name}`,
          location: this.location(),
          instructionId: instruction.id,
        });
      }
      const value = result[output.id]!;
      if (!runtimeValueMatchesType(value, output.valueType)) {
        return this.fail({
          code: 'INVALID_ADAPTER_RESULT',
          severity: 'error',
          message: `Event result ${output.name} does not match ${output.valueType.kind}`,
          location: this.location(),
          instructionId: instruction.id,
        });
      }
    }
    for (const [outputId, variableId] of Object.entries(instruction.resultVariableIds)) {
      const value = result[outputId];
      if (value !== undefined) this.writeVariable(variableId as VariableId, value);
    }
    this.currentState.pending = undefined;
    this.currentState.status = 'running';
    this.currentState.instructionIndex += 1;
    return this.runUntilPause();
  }

  /** Completes a Story Control interaction and applies any Adapter-returned values. */
  continueStoryControl(result: StoryControlResult = {}): RuntimeRunResult {
    const instruction = this.currentInstruction();
    if (
      this.currentState.pending?.kind !== 'story-control' ||
      !instruction ||
      !['start-story', 'switch-story', 'resume-story', 'end-story-instance'].includes(
        instruction.op,
      )
    ) {
      return this.fail({
        code: 'INVALID_ADAPTER_RESULT',
        severity: 'error',
        message: 'Runtime is not waiting for Story Control',
        location: this.location(),
      });
    }
    const controlInstruction = instruction as Extract<
      RuntimeInstruction,
      { op: 'start-story' | 'switch-story' | 'resume-story' | 'end-story-instance' }
    >;
    const mappings = controlInstruction.resultVariableIds;
    if (result.instanceId !== undefined) {
      if (typeof result.instanceId !== 'string') {
        return this.failAdapterResult('Story Control instanceId must be a string');
      }
      const instanceVariableId =
        'instanceVariableId' in controlInstruction
          ? controlInstruction.instanceVariableId
          : undefined;
      if (instanceVariableId) {
        const definition = this.variableDefinitions.get(instanceVariableId);
        if (!definition || definition.valueType.kind !== 'string') {
          return this.failAdapterResult('Story Control instance variable must be a String');
        }
        this.writeVariable(instanceVariableId, result.instanceId);
      }
    }
    const outputs = result.outputs ?? {};
    for (const [outputId, variableId] of Object.entries(mappings)) {
      if (!(outputId in outputs)) continue;
      const definition =
        this.variableDefinitions.get(variableId as VariableId) ??
        (() => {
          const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
          const chapter = frame ? this.program.chapters[frame.chapterId] : undefined;
          return [...(chapter?.parameters ?? []), ...(chapter?.localVariables ?? [])].find(
            (candidate) =>
              ('variableId' in candidate ? candidate.variableId : candidate.id) === variableId,
          );
        })();
      if (!definition) {
        return this.failAdapterResult(
          `Story Control result references missing variable ${variableId}`,
        );
      }
      const value = outputs[outputId]!;
      if (!runtimeValueMatchesType(value, definition.valueType)) {
        return this.failAdapterResult(
          `Story Control result ${outputId} does not match ${definition.valueType.kind}`,
        );
      }
      this.writeVariable(variableId as VariableId, value);
    }
    this.currentState.pending = undefined;
    this.currentState.status = 'running';
    this.currentState.instructionIndex += 1;
    return this.runUntilPause();
  }

  /** Delivers a signal. Early signals are buffered in serializable runtime state. */
  sendSignal(signalId: SignalId, payload: SignalPayload = {}): RuntimeRunResult | undefined {
    if (
      this.currentState.pending?.kind === 'signal' &&
      this.currentState.pending.signalId === signalId &&
      payloadMatches(payload, this.currentState.pending.matches)
    ) {
      this.currentState.pending = undefined;
      this.currentState.status = 'running';
      this.currentState.instructionIndex += 1;
      return this.runUntilPause();
    }
    (this.currentState.signalInbox[signalId] ??= []).push({ ...payload });
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

  failAdapterResult(message: string, cause?: unknown): RuntimeRunResult {
    return this.fail({
      code: 'INVALID_ADAPTER_RESULT',
      severity: 'error',
      message,
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
            requestId: this.currentState.pending.requestId,
            speakerId: instruction.speakerId,
            textId: instruction.text.id,
            defaultText: renderTextTemplate(
              instruction.text,
              this.readVariable,
              this.locale,
              this.program.localeFallbacks,
              this.program.sourceLocale,
            ),
            voice: instruction.voice,
            emotion: instruction.emotion,
            portraitId: instruction.portraitId,
            tags: instruction.tags,
          },
        });
      }
      case 'ink-block':
        return this.advanceInk(instruction);
      case 'set-variable':
        if (instruction.containerOperation === 'append') {
          const current = this.readVariable(instruction.variableId);
          if (!Array.isArray(current)) {
            throw new Error(`Variable ${instruction.variableId} is not an Array`);
          }
          this.writeVariable(instruction.variableId, [
            ...current,
            evaluateExpression(instruction.value, this.readVariable),
          ]);
        } else if (instruction.containerOperation === 'set-entry') {
          const current = this.readVariable(instruction.variableId);
          if (current === null || Array.isArray(current) || typeof current !== 'object') {
            throw new Error(`Variable ${instruction.variableId} is not a Map`);
          }
          const key = instruction.key
            ? evaluateExpression(instruction.key, this.readVariable)
            : undefined;
          if (typeof key !== 'string' && typeof key !== 'number') {
            throw new Error('Map key must be a String or Number');
          }
          this.writeVariable(instruction.variableId, {
            ...current,
            [String(key)]: evaluateExpression(instruction.value, this.readVariable),
          });
        } else if (instruction.containerOperation === 'set-field') {
          const current = this.readVariable(instruction.variableId);
          if (current === null || Array.isArray(current) || typeof current !== 'object') {
            throw new Error(`Variable ${instruction.variableId} is not an Engine Object`);
          }
          if (!instruction.fieldName) throw new Error('Set Object Field is missing its field');
          this.writeVariable(instruction.variableId, {
            ...current,
            [instruction.fieldName]: evaluateExpression(instruction.value, this.readVariable),
          });
        } else {
          this.writeVariable(
            instruction.variableId,
            evaluateExpression(instruction.value, this.readVariable),
          );
        }
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
        const matches = Object.fromEntries(
          Object.entries(instruction.matches).map(([name, expression]) => [
            name,
            evaluateExpression(expression, this.readVariable),
          ]),
        );
        const buffered = this.currentState.signalInbox[instruction.signalId] ?? [];
        const matchIndex = buffered.findIndex((payload) => payloadMatches(payload, matches));
        if (matchIndex >= 0) {
          buffered.splice(matchIndex, 1);
          if (buffered.length === 0) delete this.currentState.signalInbox[instruction.signalId];
          this.currentState.instructionIndex += 1;
          return undefined;
        }
        this.currentState.pending = {
          kind: 'signal',
          requestId: instruction.id,
          instructionId: instruction.id,
          signalId: instruction.signalId,
          matches,
        };
        this.currentState.status = 'waiting';
        return this.waiting({
          kind: 'signal',
          request: { requestId: instruction.id, signalId: instruction.signalId, matches },
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
        const locals: Record<string, RuntimeValue> = Object.fromEntries([
          ...chapter.parameters.map((parameter) => [parameter.variableId, parameter.defaultValue]),
          ...chapter.localVariables.map((variable) => [variable.id, variable.defaultValue]),
        ]);
        for (const [variableId, expression] of Object.entries(instruction.arguments)) {
          const parameter = chapter.parameters.find(
            (candidate) => candidate.variableId === variableId,
          );
          if (!parameter) throw new TypeError(`Unknown substory input ${variableId}`);
          const value = evaluateExpression(expression, this.readVariable);
          this.assertValueType(value, parameter, 'Substory input');
          locals[variableId] = value;
        }
        this.currentState.callStack.push({
          chapterId: instruction.chapterId,
          returnTo: instruction.returnTo,
          resultVariableIds: { ...instruction.resultVariableIds },
          locals,
        });
        this.jump(instruction.target);
        return undefined;
      }
      case 'start-story':
      case 'switch-story':
      case 'resume-story':
      case 'end-story-instance': {
        const instanceExpression = instruction.instanceId;
        const instanceValue = instanceExpression
          ? evaluateExpression(instanceExpression, this.readVariable)
          : undefined;
        if (instanceValue !== undefined && typeof instanceValue !== 'string') {
          throw new TypeError('Story instance ID must be a string');
        }
        const argumentsValue =
          instruction.op === 'resume-story' || instruction.op === 'end-story-instance'
            ? {}
            : Object.fromEntries(
                Object.entries(instruction.arguments).map(([key, expression]) => [
                  key,
                  evaluateExpression(expression, this.readVariable),
                ]),
              );
        const request: StoryControlRequest = {
          requestId: instruction.id,
          action:
            instruction.op === 'start-story'
              ? 'start'
              : instruction.op === 'switch-story'
                ? 'switch'
                : instruction.op === 'resume-story'
                  ? 'resume'
                  : 'end',
          ...(instruction.op === 'start-story' || instruction.op === 'switch-story'
            ? { storyId: instruction.storyId }
            : {}),
          ...(instanceValue === undefined ? {} : { instanceId: instanceValue }),
          arguments: argumentsValue,
          waitForCompletion:
            instruction.op === 'end-story-instance'
              ? false
              : 'waitForCompletion' in instruction
                ? instruction.waitForCompletion
                : false,
        };
        this.currentState.pending = {
          kind: 'story-control',
          requestId: instruction.id,
          instructionId: instruction.id,
          action: request.action,
        };
        this.currentState.status = 'waiting';
        return this.waiting({ kind: 'story-control', request });
      }
      case 'return': {
        const values = Object.fromEntries(
          Object.entries(instruction.values).map(([outputId, expression]) => [
            outputId,
            evaluateExpression(expression, this.readVariable),
          ]),
        );
        const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
        if (!frame) {
          return this.fail({
            code: 'INVALID_LOCATION',
            severity: 'error',
            message: 'Return executed without a calling substory frame',
            location: this.location(),
            instructionId: instruction.id,
          });
        }
        const chapter = this.program.chapters[frame.chapterId];
        if (!chapter) throw new TypeError(`Missing substory ${frame.chapterId}`);
        for (const [outputId, value] of Object.entries(values)) {
          const output = chapter.outputs.find((candidate) => candidate.variableId === outputId);
          if (!output) throw new TypeError(`Unknown substory output ${outputId}`);
          this.assertValueType(value, output, 'Substory output');
        }
        this.currentState.callStack.pop();
        this.currentState.blockId = frame.returnTo.blockId;
        this.currentState.instructionIndex = frame.returnTo.instructionIndex;
        this.currentState.status = 'running';
        for (const [outputId, resultVariableId] of Object.entries(frame.resultVariableIds)) {
          if (outputId in values) this.writeVariable(resultVariableId, values[outputId]);
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
          defaultText: renderTextTemplate(
            instruction.text,
            this.readVariable,
            this.locale,
            this.program.localeFallbacks,
            this.program.sourceLocale,
          ),
          voice: instruction.voice,
          emotion: instruction.emotion,
          portraitId: instruction.portraitId,
          tags: instruction.tags,
        },
      };
    }
    if (this.currentState.pending?.kind === 'ink-dialogue' && instruction?.op === 'ink-block') {
      return {
        kind: 'dialogue',
        request: {
          requestId: this.currentState.pending.requestId,
          speakerId: this.currentState.pending.speakerId,
          textId: this.currentState.pending.textId,
          defaultText: this.currentState.pending.defaultText,
          voice: this.currentState.pending.voiceId
            ? { default: this.currentState.pending.voiceId }
            : undefined,
          emotion: this.currentState.pending.emotion,
          tags: this.currentState.pending.tags,
        },
      };
    }
    if (this.currentState.pending?.kind === 'choice' && instruction?.op === 'choice') {
      return this.choiceInteraction(instruction);
    }
    if (this.currentState.pending?.kind === 'ink-choice' && instruction?.op === 'ink-block') {
      return {
        kind: 'choice',
        request: {
          requestId: this.currentState.pending.requestId,
          options: this.currentState.pending.options.map((option) => ({
            id: option.id,
            textId: instruction.id as unknown as import('@story-blueprint/common').TextId,
            defaultText: option.text,
            enabled: true,
          })),
        },
      };
    }
    if (this.currentState.pending?.kind === 'event' && instruction?.op === 'call-event') {
      return this.eventInteraction(instruction);
    }
    if (this.currentState.pending?.kind === 'signal' && instruction?.op === 'wait-signal') {
      return {
        kind: 'signal',
        request: {
          requestId: instruction.id,
          signalId: instruction.signalId,
          matches: this.currentState.pending.matches,
        },
      };
    }
    if (
      this.currentState.pending?.kind === 'story-control' &&
      instruction &&
      ['start-story', 'switch-story', 'resume-story', 'end-story-instance'].includes(instruction.op)
    ) {
      const result = this.execute(instruction);
      return result?.kind === 'waiting' ? result.interaction : undefined;
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
        outputs: instruction.outputs,
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
          ? renderTextTemplate(
              instruction.prompt,
              this.readVariable,
              this.locale,
              this.program.localeFallbacks,
              this.program.sourceLocale,
            )
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
    return resolveChoiceOptions(
      instruction,
      this.readVariable,
      this.locale,
      this.program.localeFallbacks,
      this.program.sourceLocale,
    );
  }

  private readonly readVariable = (id: VariableId): RuntimeValue => {
    const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
    if (frame && id in frame.locals) return frame.locals[id];
    if (!(id in this.currentState.storyVariables)) throw new TypeError(`Missing variable ${id}`);
    return this.currentState.storyVariables[id];
  };

  private writeVariable(id: VariableId, value: RuntimeValue): void {
    const frame = this.currentState.callStack[this.currentState.callStack.length - 1];
    if (frame && id in frame.locals) {
      const chapter = this.program.chapters[frame.chapterId];
      const definition = [...(chapter?.parameters ?? []), ...(chapter?.localVariables ?? [])].find(
        (candidate) => ('variableId' in candidate ? candidate.variableId : candidate.id) === id,
      );
      if (!definition) throw new TypeError(`Missing local variable definition ${id}`);
      this.assertValueType(value, definition, 'Local variable');
      frame.locals[id] = value;
    } else {
      const definition = this.variableDefinitions.get(id);
      if (!definition) throw new TypeError(`Missing variable ${id}`);
      this.assertValueType(value, definition, 'Variable');
      this.currentState.storyVariables[id] = value;
      if (this.externalVariableIdSet.has(id)) this.pendingExternalWrites.set(id, value);
    }
  }

  private assertValueType(
    value: RuntimeValue,
    definition:
      | Pick<VariableDefinition, 'name' | 'valueType'>
      | { variableId: VariableId; valueType: VariableDefinition['valueType'] },
    label: string,
  ): void {
    if (runtimeValueMatchesType(value, definition.valueType)) return;
    const name = 'name' in definition ? definition.name : definition.variableId;
    throw new TypeError(`${label} ${name} must be ${definition.valueType.kind}`);
  }

  private validateRestoredState(state: RuntimeState): void {
    for (const definition of this.program.variables) {
      if (!(definition.id in state.storyVariables)) {
        throw new TypeError(`Runtime state is missing variable ${definition.name}`);
      }
      this.assertValueType(
        state.storyVariables[definition.id],
        definition,
        'Runtime state variable',
      );
    }
    for (const frame of state.callStack) {
      const chapter = this.program.chapters[frame.chapterId];
      if (!chapter)
        throw new TypeError(`Runtime state references missing substory ${frame.chapterId}`);
      for (const definition of [...chapter.parameters, ...chapter.localVariables]) {
        const id = 'variableId' in definition ? definition.variableId : definition.id;
        if (!(id in frame.locals))
          throw new TypeError(`Runtime state is missing local variable ${id}`);
        this.assertValueType(frame.locals[id], definition, 'Runtime state local');
      }
    }
    if (state.ink) {
      if (
        typeof state.ink.stateJson !== 'string' ||
        !Number.isInteger(state.ink.interactionIndex) ||
        state.ink.interactionIndex < 1
      ) {
        throw new TypeError('Runtime state contains an invalid Ink snapshot');
      }
      const instruction = this.program.blocks[state.blockId]?.instructions[state.instructionIndex];
      if (instruction?.op !== 'ink-block' || instruction.id !== state.ink.instructionId) {
        throw new TypeError('Runtime Ink snapshot does not match the current instruction');
      }
      if (state.pending?.kind === 'ink-dialogue' || state.pending?.kind === 'ink-choice') {
        const expectedRequestId = `${state.ink.instructionId}:ink:${state.ink.interactionIndex}`;
        if (
          state.pending.instructionId !== state.ink.instructionId ||
          state.pending.requestId !== expectedRequestId
        ) {
          throw new TypeError('Runtime pending Ink interaction does not match its snapshot');
        }
        if (
          state.pending.kind === 'ink-dialogue' &&
          (typeof state.pending.defaultText !== 'string' ||
            !isStableId(state.pending.textId, 'text') ||
            (state.pending.speakerId !== undefined &&
              !isStableId(state.pending.speakerId, 'character')) ||
            (state.pending.voiceId !== undefined && !isStableId(state.pending.voiceId, 'asset')) ||
            (state.pending.emotion !== undefined && typeof state.pending.emotion !== 'string') ||
            (state.pending.tags !== undefined &&
              !state.pending.tags.every((tag) => typeof tag === 'string')))
        ) {
          throw new TypeError('Runtime pending Ink dialogue metadata is invalid');
        }
      }
    } else if (state.pending?.kind === 'ink-dialogue' || state.pending?.kind === 'ink-choice') {
      throw new TypeError('Runtime pending Ink interaction is missing its snapshot');
    }
    if (state.pending?.kind === 'story-control') {
      const instruction = this.program.blocks[state.blockId]?.instructions[state.instructionIndex];
      const expectedAction =
        instruction?.op === 'start-story'
          ? 'start'
          : instruction?.op === 'switch-story'
            ? 'switch'
            : instruction?.op === 'resume-story'
              ? 'resume'
              : instruction?.op === 'end-story-instance'
                ? 'end'
                : undefined;
      if (
        !expectedAction ||
        state.pending.instructionId !== instruction?.id ||
        state.pending.action !== expectedAction
      ) {
        throw new TypeError(
          'Runtime pending Story Control interaction does not match its instruction',
        );
      }
    }
  }

  /** Rehydrates an Ink story only from serializable runtime state. */
  private inkStory(instruction: Extract<RuntimeInstruction, { op: 'ink-block' }>): InkStory {
    const story = new InkStory(instruction.inkJson);
    for (const binding of instruction.externalFunctionBindings ?? []) {
      story.BindExternalFunction(binding.inkName, (...args: RuntimeValue[]) => {
        if (!this.externalFunctionResolver) {
          throw new Error(
            `Ink external function ${binding.inkName} has no synchronous runtime adapter`,
          );
        }
        const request: ExternalFunctionRequest = {
          functionId: binding.functionId,
          arguments: Object.fromEntries(
            binding.parameterNames.map((name, index) => [name, args[index] ?? null]),
          ),
        };
        return this.externalFunctionResolver(request);
      });
    }
    if (this.currentState.ink?.instructionId === instruction.id) {
      story.state.LoadJson(this.currentState.ink.stateJson);
    } else {
      this.syncStoryVariablesToInk(instruction, story);
      if (instruction.entryKnot) story.ChoosePathString(instruction.entryKnot);
    }
    return story;
  }

  private syncStoryVariablesToInk(
    instruction: Extract<RuntimeInstruction, { op: 'ink-block' }>,
    story: InkStory,
  ): void {
    for (const binding of instruction.variableBindings) {
      if (binding.direction === 'ink-to-story') continue;
      const value = this.readVariable(binding.variableId);
      if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
        throw new TypeError(`Story variable ${binding.variableId} cannot be passed to Ink`);
      }
      story.variablesState.$(binding.inkName, value);
    }
  }

  private syncInkVariablesToStory(
    instruction: Extract<RuntimeInstruction, { op: 'ink-block' }>,
    story: InkStory,
  ): void {
    for (const binding of instruction.variableBindings) {
      if (binding.direction === 'story-to-ink') continue;
      const value = story.variablesState.$(binding.inkName);
      if (
        value !== null &&
        typeof value !== 'boolean' &&
        typeof value !== 'number' &&
        typeof value !== 'string'
      ) {
        throw new TypeError(`Ink variable ${binding.inkName} is not a scalar value`);
      }
      this.writeVariable(binding.variableId, value);
    }
  }

  private saveInkState(
    instruction: Extract<RuntimeInstruction, { op: 'ink-block' }>,
    story: InkStory,
  ): string {
    const previousIndex =
      this.currentState.ink?.instructionId === instruction.id
        ? this.currentState.ink.interactionIndex
        : 0;
    const interactionIndex = previousIndex + 1;
    this.currentState.ink = {
      instructionId: instruction.id,
      stateJson: story.state.ToJson(),
      interactionIndex,
    };
    return `${instruction.id}:ink:${interactionIndex}`;
  }

  private advanceInk(
    instruction: Extract<RuntimeInstruction, { op: 'ink-block' }>,
    existingStory?: InkStory,
  ): RuntimeRunResult | undefined {
    let story: InkStory;
    try {
      story = existingStory ?? this.inkStory(instruction);
    } catch (cause) {
      return this.fail({
        code: 'INK_VARIABLE_ERROR',
        severity: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        location: this.location(),
        instructionId: instruction.id,
        cause,
      });
    }
    while (story.canContinue) {
      let text: string | null;
      try {
        text = story.Continue();
      } catch (cause) {
        return this.fail({
          code: 'INK_EXTERNAL_FUNCTION_ERROR',
          severity: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
          location: this.location(),
          instructionId: instruction.id,
          cause,
        });
      }
      if (!text) continue;
      const normalizedText = text.replace(/[\r\n]+$/g, '');
      if (!normalizedText) continue;
      const requestId = this.saveInkState(instruction, story);
      const metadata = parseInkDialogueMetadata(story.currentTags ?? []);
      if (metadata.errors.length > 0) {
        return this.fail({
          code: 'INK_METADATA_ERROR',
          severity: 'error',
          message: metadata.errors.join('; '),
          location: this.location(),
          instructionId: instruction.id,
        });
      }
      const textId =
        metadata.textId ??
        (`t_ink_${instruction.id.replace(/[^a-z0-9_-]/gi, '_')}_${this.currentState.ink!.interactionIndex}` as import('@story-blueprint/common').TextId);
      this.currentState.pending = {
        kind: 'ink-dialogue',
        requestId,
        instructionId: instruction.id,
        defaultText: normalizedText,
        textId,
        speakerId: metadata.speakerId,
        voiceId: metadata.voiceId,
        emotion: metadata.emotion,
        tags: metadata.tags.length > 0 ? metadata.tags : undefined,
      };
      this.currentState.status = 'waiting';
      return this.waiting({
        kind: 'dialogue',
        request: {
          requestId,
          speakerId: metadata.speakerId,
          textId,
          defaultText: normalizedText,
          voice: metadata.voiceId ? { default: metadata.voiceId } : undefined,
          emotion: metadata.emotion,
          tags: metadata.tags.length > 0 ? metadata.tags : undefined,
        },
      });
    }
    let currentChoices: readonly { text: string }[];
    try {
      currentChoices = story.currentChoices;
    } catch (cause) {
      return this.fail({
        code: 'INK_EXTERNAL_FUNCTION_ERROR',
        severity: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        location: this.location(),
        instructionId: instruction.id,
        cause,
      });
    }
    if (currentChoices.length > 0) {
      const requestId = this.saveInkState(instruction, story);
      const options = currentChoices.map((choice, index) => ({
        id: `${requestId}:choice:${index}` as OptionId,
        text: choice.text,
        choiceIndex: index,
      }));
      this.currentState.pending = {
        kind: 'ink-choice',
        requestId,
        instructionId: instruction.id,
        options,
      };
      this.currentState.status = 'waiting';
      return this.waiting({
        kind: 'choice',
        request: {
          requestId,
          options: options.map((option) => ({
            id: option.id,
            textId: instruction.id as unknown as import('@story-blueprint/common').TextId,
            defaultText: option.text,
            enabled: true,
          })),
        },
      });
    }
    try {
      this.syncInkVariablesToStory(instruction, story);
    } catch (cause) {
      return this.fail({
        code: 'INK_VARIABLE_ERROR',
        severity: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        location: this.location(),
        instructionId: instruction.id,
        cause,
      });
    }
    this.currentState.ink = undefined;
    this.currentState.pending = undefined;
    this.currentState.status = 'running';
    this.currentState.instructionIndex += 1;
    return undefined;
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
