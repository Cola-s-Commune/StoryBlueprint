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
    const writes: unknown[] = [];
    const adapter: StoryAdapter = {
      showDialogue: async () => undefined,
      showChoice: async () => 'o_unused',
      callEvent: async () => undefined,
      waitForSignal: async () => ({}),
      resolveText: async () => undefined,
      readExternalVariable: async () => 4,
      writeExternalVariable: async (id, value) => writes.push([id, value]),
    };

    const result = await runStoryWithAdapter(
      new StoryRuntime(program),
      adapter,
      new AbortController().signal,
    );

    expect(result.kind).toBe('completed');
    expect(writes).toEqual([['v_affinity', 5]]);
  });
});
