import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeProgram } from '../../../packages/common/src';
import { validateRuntimeProgram } from '../../../packages/compiler/src';
import {
  runStoryWithAdapter,
  StoryRuntime,
  type ChoiceRequest,
  type DialogueRequest,
  type EventRequest,
  type NarrationRequest,
  type StoryAdapter,
} from '../../../packages/runtime/src';

const fixturePath = new URL('../samples/RuntimeDemo/Packages/com.storyblueprint.runtime/Tests/Fixtures/', import.meta.url);

function fixture(name: string): RuntimeProgram {
  return JSON.parse(readFileSync(new URL(name, fixturePath), 'utf8')) as RuntimeProgram;
}

function adapter(overrides: Partial<StoryAdapter> = {}): StoryAdapter {
  return {
    showDialogue: async () => undefined,
    showNarration: async () => undefined,
    showChoice: async () => 'opt_yes',
    callEvent: async () => ({ evo_reward: 7 }),
    waitForSignal: async () => {
      throw new Error('Fixture expects a buffered signal');
    },
    resolveText: async () => undefined,
    readExternalVariable: async (variable) => variable.defaultValue,
    writeExternalVariable: async () => undefined,
    ...overrides,
  };
}

describe('Unity shared native runtime fixtures', () => {
  it('validates the exact JSON artifacts used by the C# tests', () => {
    expect(validateRuntimeProgram(fixture('native-conformance.storyc.json'))).toEqual([]);
    expect(validateRuntimeProgram(fixture('sample-quest.storyc.json'))).toEqual([]);
    expect(readFileSync(new URL('sample-quest.storyc.json', fixturePath), 'utf8')).toBe(
      readFileSync(
        new URL('../../../docs/examples/sample-quest.storyc.json', import.meta.url),
        'utf8',
      ),
    );
  });

  it('matches C# localized interaction traces and final state', async () => {
    const dialogues: DialogueRequest[] = [];
    const narrations: NarrationRequest[] = [];
    const choices: ChoiceRequest[] = [];
    const events: EventRequest[] = [];
    const runtime = new StoryRuntime(fixture('native-conformance.storyc.json'), undefined, 'zh-CN');
    runtime.sendSignal('sig_ready', { bossId: 'red_dragon', amount: 3 });
    const result = await runStoryWithAdapter(
      runtime,
      adapter({
        showDialogue: async (request) => {
          dialogues.push(request);
        },
        showNarration: async (request) => {
          narrations.push(request);
        },
        showChoice: async (request) => {
          choices.push(request);
          return 'opt_yes';
        },
        callEvent: async (request) => {
          events.push(request);
          return { evo_reward: 7 };
        },
      }),
      new AbortController().signal,
    );
    expect(result.kind).toBe('completed');
    expect(runtime.state.storyVariables).toEqual({
      v_score: 17,
      v_items: [2, 5],
      v_map: { reward: 7 },
      v_profile: { level: 2, name: 'Hero' },
    });
    expect(dialogues).toMatchObject([
      {
        requestId: 'i_dialogue',
        textId: 't_greeting',
        defaultText: '你好 Hero，分数 17',
        speakerId: 'c_hero',
        emotion: 'happy',
        portraitId: 'a_portrait',
        tags: ['quest:complete'],
      },
    ]);
    expect(narrations).toMatchObject([{ requestId: 'i_narration', defaultText: 'Finished 17' }]);
    expect(choices[0]?.options).toMatchObject([
      { id: 'opt_yes', defaultText: 'Yes', enabled: true },
      { id: 'opt_disabled', defaultText: 'Disabled', enabled: false },
    ]);
    expect(choices[0]?.options).toHaveLength(2);
    expect(events).toMatchObject([{ eventId: 'ev_reward', arguments: { amount: 5 } }]);
    expect(runtime.state.eventOutputs).toEqual({ i_event: { evo_reward: 7 } });
    expect(runtime.state.substoryOutputs).toEqual({ i_chapter: { v_result: 17 } });
    expect(runtime.state.signalOutputs).toEqual({
      i_signal: { bossId: 'red_dragon', amount: 3 },
    });
  });

  it('matches C# published quest accept and decline branches', async () => {
    for (const optionId of ['opt_accept', 'opt_decline'] as const) {
      const runtime = new StoryRuntime(fixture('sample-quest.storyc.json'));
      runtime.sendSignal('sig_boss_slain', { bossId: 'other' });
      runtime.sendSignal('sig_boss_slain', { bossId: 'red_dragon' });
      const events: EventRequest[] = [];
      const result = await runStoryWithAdapter(
        runtime,
        adapter({
          showChoice: async () => optionId,
          callEvent: async (request) => {
            events.push(request);
            return { evo_success: true };
          },
        }),
        new AbortController().signal,
      );
      expect(result.kind).toBe('completed');
      expect(runtime.state.storyVariables.v_quest_accepted).toBe(optionId === 'opt_accept');
      expect(events).toHaveLength(optionId === 'opt_accept' ? 1 : 0);
    }
  });
});
