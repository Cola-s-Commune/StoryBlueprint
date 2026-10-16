import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  runtimeValueMatchesType,
  type RuntimeValue,
  type TypedExpression,
} from '../packages/common/src';
import {
  createRuntimeFromCompiledProject,
  evaluateExpression,
  parseCompiledStoryProject,
} from '../packages/runtime/src';

const fixture = (name: string) =>
  readFileSync(new URL(`../integrations/unreal/Fixtures/${name}`, import.meta.url), 'utf8');
const project = parseCompiledStoryProject(fixture('conditional-project.storyc.json'));

describe('Unreal shared runtime contract fixtures', () => {
  const outputProject = parseCompiledStoryProject(fixture('event-signal-project.storyc.json'));
  const payload = (bossId: string, score: number, tags = [1, 2]) => ({
    bossId,
    score,
    detail: { meta: { zone: 'cave' }, tags },
  });
  const reward = (amount: number) => ({ evo_amount: amount, evo_status: 'ok', evo_success: true });

  it('consumes the oldest matching signal once and retains full output payloads', () => {
    const runtime = createRuntimeFromCompiledProject(outputProject);
    runtime.sendSignal('sig_enemy', payload('red', 99, [2, 1]));
    runtime.sendSignal('sig_enemy', payload('blue', 7));
    runtime.sendSignal('sig_enemy', payload('red', 11));
    runtime.sendSignal('sig_enemy', payload('red', 22));
    expect(runtime.runUntilPause().kind).toBe('waiting');
    const event = runtime.continueDialogue();
    if (event.kind !== 'waiting' || event.interaction.kind !== 'event')
      throw new Error('Expected reward event');
    expect(event.interaction.request.arguments).toEqual({ amount: 11 });
    const report = runtime.continueEvent({ ...reward(500), extra: 123 });
    if (report.kind !== 'waiting' || report.interaction.kind !== 'dialogue')
      throw new Error('Expected report');
    expect(report.interaction.request.defaultText).toBe(
      'reward=500; event=500; signal=11; status=ok; ok=true',
    );
    const blue = runtime.continueDialogue();
    if (blue.kind !== 'waiting' || blue.interaction.kind !== 'dialogue')
      throw new Error('Expected blue report');
    expect(blue.interaction.request.defaultText).toBe('blue=7');
    const red = runtime.continueDialogue();
    if (red.kind !== 'waiting' || red.interaction.kind !== 'dialogue')
      throw new Error('Expected second red report');
    expect(red.interaction.request.defaultText).toBe('red2=22; cached=500');
    expect(runtime.continueDialogue().kind).toBe('completed');
    expect(runtime.state.eventOutputs?.i_reward).toEqual(reward(500));
    expect(runtime.state.storyVariables.v_reward).toBe(500);
    expect(runtime.state.signalOutputs?.i_wait_red).toEqual(payload('red', 11));
    expect(runtime.state.signalInbox.sig_enemy).toEqual([payload('red', 99, [2, 1])]);
  });

  it('replaces the same producer cache only when its next event completes', () => {
    const runtime = createRuntimeFromCompiledProject(outputProject, 's_repeat');
    runtime.runUntilPause();
    runtime.continueEvent(reward(500));
    runtime.continueDialogue();
    expect(runtime.state.eventOutputs?.i_repeat).toEqual(reward(500));
    const result = runtime.continueEvent(reward(750));
    if (result.kind !== 'waiting' || result.interaction.kind !== 'dialogue')
      throw new Error('Expected repeat report');
    expect(result.interaction.request.defaultText).toBe('value=750');
    expect(runtime.state.eventOutputs).toEqual({ i_repeat: reward(750) });
  });

  it('uses the same project envelope, conditions, and filtered option metadata as TypeScript', () => {
    const runtime = createRuntimeFromCompiledProject(project);
    const choice = runtime.runUntilPause();
    expect(choice.kind).toBe('waiting');
    if (choice.kind !== 'waiting' || choice.interaction.kind !== 'choice')
      throw new Error('Expected choice');
    expect(choice.interaction.request.defaultPrompt).toBe('gold=15');
    expect(
      choice.interaction.request.options.map(({ id, textId, enabled }) => ({
        id,
        textId,
        enabled,
      })),
    ).toEqual([
      { id: 'opt_locked', textId: 't_locked', enabled: false },
      { id: 'opt_ready', textId: 't_ready', enabled: true },
    ]);
    const result = runtime.choose('opt_ready');
    if (result.kind !== 'waiting' || result.interaction.kind !== 'dialogue')
      throw new Error('Expected result dialogue');
    expect(result.interaction.request.defaultText).toBe(
      'gold=15; member=12; index=8; map=4; hex=16; concat=AB; null=; decimal=0.1',
    );
    expect(runtime.continueDialogue().kind).toBe('completed');
    const alternate = createRuntimeFromCompiledProject(project, 's_alternate').runUntilPause();
    if (alternate.kind !== 'waiting' || alternate.interaction.kind !== 'narration')
      throw new Error('Expected alternate narration');
    expect(alternate.interaction.request.defaultText).toBe('Alternate Story');
  });

  const { cases } = JSON.parse(fixture('expression-cases.json')) as {
    cases: Array<{
      name: string;
      expression: TypedExpression;
      expected?: RuntimeValue;
      expectedText?: string;
      expectedError?: boolean;
      expectedValidationError?: boolean;
    }>;
  };
  for (const item of cases.filter((item) => !item.expectedValidationError)) {
    it(`expression reference: ${item.name}`, () => {
      const evaluate = () => {
        const value = evaluateExpression(item.expression, () => {
          throw new Error('Unexpected variable');
        });
        if (!runtimeValueMatchesType(value, item.expression.valueType))
          throw new Error('Invalid/non-finite expression result');
        return value;
      };
      if (item.expectedError) expect(evaluate).toThrow();
      else {
        const value = evaluate();
        expect(value).toEqual(item.expected);
        expect(String(value)).toBe(item.expectedText);
      }
    });
  }
});
