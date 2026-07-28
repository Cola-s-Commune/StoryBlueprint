import type { StoryAdapter } from './types';
import { StoryRuntime, type RuntimeRunResult } from './storyRuntime';

/** Drives the deterministic runtime through asynchronous engine adapter interactions. */
export class StoryRuntimeDriver {
  constructor(
    readonly runtime: StoryRuntime,
    readonly adapter: StoryAdapter,
  ) {}

  async run(signal: AbortSignal): Promise<RuntimeRunResult> {
    let result = this.runtime.runUntilPause();
    while (result.kind === 'waiting') {
      if (signal.aborted) return this.runtime.abort();
      try {
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
            await this.adapter.callEvent(result.interaction.request, signal);
            result = this.runtime.continueEvent();
            break;
          }
          case 'signal': {
            await this.adapter.waitForSignal(result.interaction.request, signal);
            result =
              this.runtime.sendSignal(result.interaction.request.signalId) ??
              this.runtime.runUntilPause();
            break;
          }
        }
      } catch (cause) {
        if (signal.aborted) return this.runtime.abort();
        return this.runtime.failAdapter(cause);
      }
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
