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
    id: 'program_test',
    contentVersion: 'test-1',
    entryBlockId: 'block_entry',
    blocks: {
      block_entry: {
        id: 'block_entry',
        instructions: [{ id: 'instruction_end', op: 'end-story' }],
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
    invalid.blocks.block_entry.instructions = [
      {
        id: 'instruction_dialogue',
        op: 'dialogue',
        textId: 'text_hello',
        defaultText: 'Hello',
      },
    ];
    expect(validateRuntimeProgram(invalid)).toContainEqual(
      expect.objectContaining({ code: 'MISSING_TERMINATOR' }),
    );
  });
});
