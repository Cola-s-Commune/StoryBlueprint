import { describe, expect, it } from 'vitest';
import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  type RuntimeProgram,
} from '../packages/common/src';
import { runStoryWithAdapter, StoryRuntime, type StoryAdapter } from '../packages/runtime/src';

describe('character field adapter bridge', () => {
  it('hydrates engine-owned fields and writes mutations back', async () => {
    const program: RuntimeProgram = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: 'p_external',
      contentVersion: '1',
      entryBlockId: 'b_start',
      chapters: {},
      variables: [
        {
          id: 'v_affinity',
          name: 'affinity',
          displayName: 'Affinity',
          scope: 'character',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      blocks: {
        b_start: {
          id: 'b_start',
          instructions: [
            {
              id: 'i_set',
              op: 'set-variable',
              variableId: 'v_affinity',
              value: {
                kind: 'binary',
                operator: 'add',
                left: {
                  kind: 'variable',
                  variableId: 'v_affinity',
                  valueType: { kind: 'number' },
                },
                right: { kind: 'literal', value: 1, valueType: { kind: 'number' } },
                valueType: { kind: 'number' },
              },
            },
            { id: 'i_end', op: 'end-story' },
          ],
        },
      },
    };
    const reads: unknown[] = [];
    const writes: unknown[] = [];
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async () => undefined,
      waitForSignal: async () => ({}),
      resolveText: async () => undefined,
      readExternalVariable: async (variable) => {
        reads.push(variable);
        return 4;
      },
      writeExternalVariable: async (variable, value) => writes.push([variable.id, value]),
    };

    const result = await runStoryWithAdapter(
      new StoryRuntime(program),
      adapter,
      new AbortController().signal,
    );

    expect(result.kind).toBe('completed');
    expect(reads).toEqual([
      expect.objectContaining({ id: 'v_affinity', name: 'affinity', scope: 'character' }),
    ]);
    expect(writes).toEqual([['v_affinity', 5]]);
  });

  it('reports an invalid adapter result separately from an adapter failure', async () => {
    const program: RuntimeProgram = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: 'p_invalid_external',
      contentVersion: '1',
      entryBlockId: 'b_end',
      chapters: {},
      variables: [
        {
          id: 'v_score',
          name: 'score',
          displayName: 'Score',
          scope: 'project',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      blocks: {
        b_end: { id: 'b_end', instructions: [{ id: 'i_end', op: 'end-story' }] },
      },
    };
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async () => undefined,
      waitForSignal: async () => ({}),
      resolveText: async () => undefined,
      readExternalVariable: async () => 'not a number',
      writeExternalVariable: async () => undefined,
    };

    const result = await runStoryWithAdapter(
      new StoryRuntime(program),
      adapter,
      new AbortController().signal,
    );

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    expect(result.diagnostic.code).toBe('INVALID_ADAPTER_RESULT');
    expect(result.diagnostic.message).toContain('score must be number');
  });

  it('retains external writes when the adapter cannot persist them', async () => {
    const program: RuntimeProgram = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: 'p_retry_external',
      contentVersion: '1',
      entryBlockId: 'b_start',
      chapters: {},
      variables: [
        {
          id: 'v_score',
          name: 'score',
          displayName: 'Score',
          scope: 'project',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      blocks: {
        b_start: {
          id: 'b_start',
          instructions: [
            {
              id: 'i_set',
              op: 'set-variable',
              variableId: 'v_score',
              value: { kind: 'literal', value: 8, valueType: { kind: 'number' } },
            },
            { id: 'i_end', op: 'end-story' },
          ],
        },
      },
    };
    const runtime = new StoryRuntime(program);
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async () => undefined,
      waitForSignal: async () => ({}),
      resolveText: async () => undefined,
      readExternalVariable: async () => 1,
      writeExternalVariable: async () => {
        throw new Error('storage unavailable');
      },
    };

    const result = await runStoryWithAdapter(runtime, adapter, new AbortController().signal);

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    expect(result.diagnostic.code).toBe('ADAPTER_ERROR');
    expect(runtime.peekExternalVariableWrites()).toEqual([
      { variable: expect.objectContaining({ id: 'v_score', scope: 'project' }), value: 8 },
    ]);
  });

  it('treats project variables as engine-owned external state', () => {
    const program: RuntimeProgram = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: 'p_project_external',
      contentVersion: '1',
      entryBlockId: 'b_end',
      chapters: {},
      variables: [
        {
          id: 'v_projectscore',
          name: 'projectScore',
          displayName: 'Project Score',
          scope: 'project',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      blocks: {
        b_end: { id: 'b_end', instructions: [{ id: 'i_end', op: 'end-story' }] },
      },
    };
    const runtime = new StoryRuntime(program);
    expect(runtime.externalVariableIds).toEqual(['v_projectscore']);
    runtime.hydrateExternalVariable('v_projectscore', 12);
    expect(runtime.state.storyVariables.v_projectscore).toBe(12);
  });

  it('rejects restored variable values that violate the program contract', () => {
    const program: RuntimeProgram = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: 'p_restore_type',
      contentVersion: '1',
      entryBlockId: 'b_end',
      chapters: {},
      variables: [
        {
          id: 'v_score',
          name: 'score',
          displayName: 'Score',
          scope: 'story',
          valueType: { kind: 'number' },
          defaultValue: 0,
        },
      ],
      blocks: {
        b_end: { id: 'b_end', instructions: [{ id: 'i_end', op: 'end-story' }] },
      },
    };
    const state = new StoryRuntime(program).state;
    state.storyVariables.v_score = 'invalid';

    expect(() => new StoryRuntime(program, state)).toThrow(
      'Runtime state variable score must be number',
    );
  });
});
