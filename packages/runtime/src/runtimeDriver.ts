import type { StoryAdapter } from './types';
import { StoryRuntime, type RuntimeRunResult } from './storyRuntime';

/** Drives the deterministic runtime through asynchronous engine adapter interactions. */
export class StoryRuntimeDriver {
  private hydratedExternalVariables = false;
  constructor(
    readonly runtime: StoryRuntime,
    readonly adapter: StoryAdapter,
  ) {}

  async run(signal: AbortSignal): Promise<RuntimeRunResult> {
    this.runtime.setExternalFunctionResolver(
      this.adapter.callExternalFunctionSync
        ? (request) => this.adapter.callExternalFunctionSync!(request)
        : undefined,
    );
    if (!this.hydratedExternalVariables) {
      for (const variable of this.runtime.externalVariables) {
        let value;
        try {
          value = await this.adapter.readExternalVariable(variable);
        } catch (cause) {
          return this.runtime.failAdapter(cause);
        }
        try {
          this.runtime.hydrateExternalVariable(variable.id, value);
        } catch (cause) {
          return this.runtime.failAdapterResult(
            cause instanceof Error ? cause.message : String(cause),
            cause,
          );
        }
      }
      this.hydratedExternalVariables = true;
    }

    let result = this.runtime.runUntilPause();
    const flushExternalWrites = async () => {
      for (const write of this.runtime.peekExternalVariableWrites()) {
        await this.adapter.writeExternalVariable(write.variable, write.value);
        this.runtime.acknowledgeExternalVariableWrite(write.variable.id);
      }
    };
    while (result.kind === 'waiting') {
      if (signal.aborted) return this.runtime.abort();
      try {
        await flushExternalWrites();
        switch (result.interaction.kind) {
          case 'dialogue':
            await this.adapter.showDialogue(result.interaction.request, signal);
            result = this.runtime.continueDialogue();
            break;
          case 'choice': {
            const optionId = await this.adapter.showChoice(result.interaction.request, signal);
            result = this.runtime.choose(optionId);
            break;
          }
          case 'event': {
            const eventResult = await this.adapter.callEvent(result.interaction.request, signal);
            result = this.runtime.continueEvent(eventResult);
            break;
          }
          case 'signal': {
            const payload = await this.adapter.waitForSignal(result.interaction.request, signal);
            result =
              this.runtime.sendSignal(result.interaction.request.signalId, payload) ??
              this.runtime.runUntilPause();
            break;
          }
          case 'story-control': {
            if (!this.adapter.controlStory) {
              return this.runtime.failAdapterResult(
                'Story Control requires an adapter.controlStory implementation',
              );
            }
            const controlResult = await this.adapter.controlStory(
              result.interaction.request,
              signal,
            );
            result = this.runtime.continueStoryControl(controlResult);
            break;
          }
        }
      } catch (cause) {
        if (signal.aborted) return this.runtime.abort();
        return this.runtime.failAdapter(cause);
      }
    }
    try {
      await flushExternalWrites();
    } catch (cause) {
      return this.runtime.failAdapter(cause);
    }
    return result;
  }
}

export function runStoryWithAdapter(
  runtime: StoryRuntime,
  adapter: StoryAdapter,
  signal: AbortSignal,
): Promise<RuntimeRunResult> {
  return new StoryRuntimeDriver(runtime, adapter).run(signal);
}
