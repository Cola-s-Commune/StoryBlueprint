import { describe, expect, it } from 'vitest';
import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  type RuntimeProgram,
} from '../packages/common/src';
import { validateRuntimeProgram } from '../packages/compiler/src';

function program(): RuntimeProgram {
  return {
    format: STORY_RUNTIME_FORMAT,
    version: STORY_RUNTIME_VERSION,
    id: 'p_test',
    contentVersion: 'test-1',
    entryBlockId: 'b_entry',
    blocks: {
      b_entry: {
        id: 'b_entry',
        instructions: [{ id: 'i_endx', op: 'end-story' }],
      },
    },
    chapters: {},
    variables: [],
  };
}

describe('runtime program validation', () => {
  it('accepts a minimal terminated program', () => {
    expect(validateRuntimeProgram(program())).toEqual([]);
  });

  it('rejects blocks without an explicit terminator', () => {
    const invalid = program();
    invalid.blocks.b_entry.instructions = [
      {
        id: 'i_talk',
        op: 'dialogue',
        text: { id: 't_hello', parts: [{ kind: 'text', value: 'Hello' }] },
      },
    ];
    expect(validateRuntimeProgram(invalid)).toContainEqual(
      expect.objectContaining({ code: 'MISSING_TERMINATOR' }),
    );
  });
});
