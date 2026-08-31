import {
  isRuntimeTerminator,
  runtimeValueMatchesType,
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
  const variableTypes = new Map(
    program.variables.map((variable) => [variable.id, variable.valueType] as const),
  );
  for (const chapter of Object.values(program.chapters)) {
    for (const parameter of chapter.parameters) {
      variableTypes.set(parameter.variableId, parameter.valueType);
    }
    for (const variable of chapter.localVariables) {
      variableTypes.set(variable.id, variable.valueType);
    }
  }

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

      if (instruction.op === 'ink-block') {
        const inkNames = new Set<string>();
        for (const binding of instruction.variableBindings) {
          const valueType = variableTypes.get(binding.variableId);
          if (inkNames.has(binding.inkName)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Ink instruction ${instruction.id} repeats variable ${binding.inkName}`,
              path: instructionPath,
            });
          }
          inkNames.add(binding.inkName);
          if (!valueType) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Ink instruction ${instruction.id} references missing variable ${binding.variableId}`,
              path: instructionPath,
            });
          } else if (!['boolean', 'number', 'string', 'enum'].includes(valueType.kind)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Ink instruction ${instruction.id} cannot bridge ${valueType.kind}`,
              path: instructionPath,
            });
          }
        }
        const externalNames = new Set<string>();
        for (const binding of instruction.externalFunctionBindings ?? []) {
          if (externalNames.has(binding.inkName)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Ink instruction ${instruction.id} repeats external function ${binding.inkName}`,
              path: instructionPath,
            });
          }
          externalNames.add(binding.inkName);
          if (binding.parameterNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Ink instruction ${instruction.id} has an invalid external parameter name`,
              path: instructionPath,
            });
          }
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
      if (!runtimeValueMatchesType(parameter.defaultValue, parameter.valueType)) {
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
      if (!runtimeValueMatchesType(variable.defaultValue, variable.valueType)) {
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
