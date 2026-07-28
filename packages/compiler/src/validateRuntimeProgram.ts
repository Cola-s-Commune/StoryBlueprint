import {
  isRuntimeTerminator,
  type BlockId,
  type RuntimeInstruction,
  type RuntimeProgram,
} from '@story-blueprint/common';
import type { CompilerDiagnostic } from './types';

function targetBlocks(instruction: RuntimeInstruction): readonly BlockId[] {
  switch (instruction.op) {
    case 'choice':
      return instruction.options.map((option) => option.target);
    case 'branch':
      return [instruction.whenTrue, instruction.whenFalse];
    case 'jump':
      return [instruction.target];
    case 'call-chapter':
      return [instruction.target, instruction.returnTo.blockId];
    default:
      return [];
  }
}

/** Validates the lowered, node-free runtime control-flow contract. */
export function validateRuntimeProgram(program: RuntimeProgram): readonly CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const blocks = program.blocks;

  if (!blocks[program.entryBlockId]) {
    diagnostics.push({
      code: 'MISSING_ENTRY_BLOCK',
      severity: 'error',
      message: `Entry block does not exist: ${program.entryBlockId}`,
      path: 'entryBlockId',
    });
  }

  for (const [key, block] of Object.entries(blocks)) {
    const blockPath = `blocks.${key}`;
    if (block.id !== key) {
      diagnostics.push({
        code: 'MISSING_BLOCK',
        severity: 'error',
        message: `Block key ${key} does not match its ID ${block.id}`,
        path: blockPath,
      });
    }

    if (block.instructions.length === 0) {
      diagnostics.push({
        code: 'EMPTY_BLOCK',
        severity: 'error',
        message: `Block ${key} has no terminator`,
        path: blockPath,
      });
      continue;
    }

    block.instructions.forEach((instruction, index) => {
      const instructionPath = `${blockPath}.instructions.${index}`;
      const isLast = index === block.instructions.length - 1;

      if (isRuntimeTerminator(instruction) && !isLast) {
        diagnostics.push({
          code: 'EARLY_TERMINATOR',
          severity: 'error',
          message: `Terminator ${instruction.op} must be the final instruction in block ${key}`,
          path: instructionPath,
        });
      }

      for (const target of targetBlocks(instruction)) {
        if (!blocks[target]) {
          diagnostics.push({
            code: 'MISSING_BLOCK',
            severity: 'error',
            message: `Instruction ${instruction.id} targets missing block ${target}`,
            path: instructionPath,
          });
        }
      }

      if (instruction.op === 'choice') {
        if (instruction.options.length === 0) {
          diagnostics.push({
            code: 'EMPTY_CHOICE',
            severity: 'error',
            message: `Choice ${instruction.id} has no options`,
            path: instructionPath,
          });
        }
        const optionIds = new Set<string>();
        for (const option of instruction.options) {
          if (optionIds.has(option.id)) {
            diagnostics.push({
              code: 'DUPLICATE_OPTION_ID',
              severity: 'error',
              message: `Choice ${instruction.id} repeats option ID ${option.id}`,
              path: instructionPath,
            });
          }
          optionIds.add(option.id);
        }
      }

      if (instruction.op === 'call-chapter') {
        const returnBlock = blocks[instruction.returnTo.blockId];
        if (
          returnBlock &&
          (instruction.returnTo.instructionIndex < 0 ||
            instruction.returnTo.instructionIndex >= returnBlock.instructions.length)
        ) {
          diagnostics.push({
            code: 'INVALID_RETURN_LOCATION',
            severity: 'error',
            message: `Call ${instruction.id} has an invalid return location`,
            path: instructionPath,
          });
        }
      }
    });

    const last = block.instructions[block.instructions.length - 1];
    if (!isRuntimeTerminator(last)) {
      diagnostics.push({
        code: 'MISSING_TERMINATOR',
        severity: 'error',
        message: `Block ${key} must end with an explicit control-flow instruction`,
        path: blockPath,
      });
    }
  }

  for (const [key, chapter] of Object.entries(program.chapters)) {
    if (!blocks[chapter.entryBlockId]) {
      diagnostics.push({
        code: 'MISSING_BLOCK',
        severity: 'error',
        message: `Chapter ${key} targets missing entry block ${chapter.entryBlockId}`,
        path: `chapters.${key}.entryBlockId`,
      });
    }
  }

  return diagnostics;
}
