import {
  isRuntimeTerminator,
  type BlockId,
  type RuntimeInstruction,
  type RuntimeProgram,
  type RuntimeValue,
  type ValueType,
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

function valueMatchesType(value: RuntimeValue, type: ValueType): boolean {
  if (value === null) return Boolean(type.nullable) || type.kind === 'any';
  switch (type.kind) {
    case 'any':
      return true;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'enum':
      return typeof value === 'string' && type.values.includes(value);
    case 'struct':
      return (
        typeof value === 'object' &&
        Object.entries(type.fields).every(
          ([name, fieldType]) => name in value && valueMatchesType(value[name], fieldType),
        )
      );
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
        const chapter = program.chapters[instruction.chapterId];
        if (!chapter) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Call ${instruction.id} references missing chapter ${instruction.chapterId}`,
            path: instructionPath,
          });
        } else {
          const parameters = new Map(chapter.parameters.map((item) => [item.variableId, item]));
          for (const [variableId, expression] of Object.entries(instruction.arguments)) {
            const parameter = parameters.get(variableId as keyof typeof instruction.arguments);
            if (!parameter) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Call ${instruction.id} passes unknown chapter parameter ${variableId}`,
                path: instructionPath,
              });
            } else if (
              expression.valueType.kind !== 'any' &&
              expression.valueType.kind !== parameter.valueType.kind
            ) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Call ${instruction.id} passes ${expression.valueType.kind} to ${parameter.valueType.kind} parameter ${variableId}`,
                path: instructionPath,
              });
            }
          }
          if (instruction.target !== chapter.entryBlockId) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Call ${instruction.id} does not target the chapter entry block`,
              path: instructionPath,
            });
          }
          const outputIds = new Set(chapter.outputs.map((output) => output.variableId));
          for (const outputId of Object.keys(instruction.resultVariableIds)) {
            if (!outputIds.has(outputId as never)) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Call ${instruction.id} stores unknown chapter output ${outputId}`,
                path: instructionPath,
              });
            }
          }
        }
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
    if (chapter.id !== key) {
      diagnostics.push({
        code: 'INVALID_NODE',
        severity: 'error',
        message: `Chapter key ${key} does not match its ID ${chapter.id}`,
        path: `chapters.${key}`,
      });
    }
    if (!blocks[chapter.entryBlockId]) {
      diagnostics.push({
        code: 'MISSING_BLOCK',
        severity: 'error',
        message: `Chapter ${key} targets missing entry block ${chapter.entryBlockId}`,
        path: `chapters.${key}.entryBlockId`,
      });
    }
    const ids = new Set<string>();
    for (const parameter of chapter.parameters) {
      if (ids.has(parameter.variableId)) {
        diagnostics.push({
          code: 'DUPLICATE_ID',
          severity: 'error',
          message: `Chapter ${key} repeats variable ${parameter.variableId}`,
          path: `chapters.${key}.parameters`,
        });
      }
      ids.add(parameter.variableId);
      if (!valueMatchesType(parameter.defaultValue, parameter.valueType)) {
        diagnostics.push({
          code: 'INVALID_NODE',
          severity: 'error',
          message: `Chapter parameter ${parameter.variableId} has an invalid default value`,
          path: `chapters.${key}.parameters`,
        });
      }
    }
    for (const output of chapter.outputs) {
      if (ids.has(output.variableId)) {
        diagnostics.push({
          code: 'DUPLICATE_ID',
          severity: 'error',
          message: `Chapter ${key} repeats interface variable ${output.variableId}`,
          path: `chapters.${key}.outputs`,
        });
      }
      ids.add(output.variableId);
    }
    for (const variable of chapter.localVariables) {
      if (ids.has(variable.id)) {
        diagnostics.push({
          code: 'DUPLICATE_ID',
          severity: 'error',
          message: `Chapter ${key} repeats variable ${variable.id}`,
          path: `chapters.${key}.localVariables`,
        });
      }
      ids.add(variable.id);
      if (!valueMatchesType(variable.defaultValue, variable.valueType)) {
        diagnostics.push({
          code: 'INVALID_NODE',
          severity: 'error',
          message: `Chapter local ${variable.id} has an invalid default value`,
          path: `chapters.${key}.localVariables`,
        });
      }
    }
  }

  return diagnostics;
}
