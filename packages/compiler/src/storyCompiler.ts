import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type BlockId,
  type BranchNodeData,
  type ChoiceNodeData,
  type DialogueNodeData,
  type GetVariableNodeData,
  type InstructionId,
  type NodeId,
  type ProgramId,
  type RuntimeBlock,
  type RuntimeInstruction,
  type SetVariableNodeData,
  type SourceEdge,
  type SourceNode,
  type StorySourceDocument,
  type TextId,
} from '@story-blueprint/common';
import {
  compileExpression,
  compileTextTemplate,
  ExpressionCompileError,
} from './expressionCompiler';
import type { CompileOptions, CompileResult, CompilerDiagnostic, StoryCompiler } from './types';
import { validateRuntimeProgram } from './validateRuntimeProgram';

function suffix(id: string): string {
  return id.slice(id.indexOf('_') + 1);
}

function blockId(nodeId: NodeId): BlockId {
  return `b_${suffix(nodeId)}` as BlockId;
}

function instructionId(nodeId: NodeId, tag = 'main'): InstructionId {
  return `i_${suffix(nodeId)}_${tag}` as InstructionId;
}

function textId(id: string): TextId {
  return `t_${suffix(id)}` as TextId;
}

function programId(id: string): ProgramId {
  return `p_${suffix(id)}` as ProgramId;
}

function edgeTarget(
  edges: readonly SourceEdge[],
  nodeId: NodeId,
  portId: string,
): BlockId | undefined {
  const edge = edges.find(
    (candidate) => candidate.from.nodeId === nodeId && candidate.from.portId === portId,
  );
  return edge ? blockId(edge.to.nodeId) : undefined;
}

function jump(node: SourceNode, target: BlockId): RuntimeInstruction {
  return { id: instructionId(node.id, 'next'), op: 'jump', target };
}

export class DefaultStoryCompiler implements StoryCompiler {
  compile(source: StorySourceDocument, options: CompileOptions = {}): CompileResult {
    const diagnostics: CompilerDiagnostic[] = [];
    if (source.format !== STORY_SOURCE_FORMAT || source.version !== STORY_SOURCE_VERSION) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'UNSUPPORTED_SOURCE_VERSION',
            severity: 'error',
            message: `Unsupported source ${source.format}@${source.version}`,
          },
        ],
      };
    }

    const entry = source.root.nodes.find((node) => node.type === StoryNodeType.Start);
    if (!entry) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'MISSING_ENTRY_BLOCK',
            severity: 'error',
            message: 'Story has no entry node',
          },
        ],
      };
    }

    const blocks: Record<string, RuntimeBlock> = {};
    const requireTarget = (node: SourceNode, portId: string): BlockId | undefined => {
      const target = edgeTarget(source.root.edges, node.id, portId);
      if (!target) {
        diagnostics.push({
          code: 'MISSING_CONNECTION',
          severity: 'error',
          message: `${node.type}.${portId} is not connected`,
          sourceNodeId: node.id,
        });
      }
      return target;
    };
    const compileSafe = <T>(node: SourceNode, work: () => T): T | undefined => {
      try {
        return work();
      } catch (error) {
        diagnostics.push({
          code: 'EXPRESSION_ERROR',
          severity: 'error',
          message: error instanceof ExpressionCompileError ? error.message : String(error),
          sourceNodeId: node.id,
        });
        return undefined;
      }
    };

    for (const node of source.root.nodes) {
      if (node.type === StoryNodeType.GetVariable) continue;
      const instructions: RuntimeInstruction[] = [];
      switch (node.type) {
        case StoryNodeType.Start: {
          const target = requireTarget(node, 'out');
          if (target) instructions.push(jump(node, target));
          break;
        }
        case StoryNodeType.Dialogue: {
          const data = node.data as unknown as DialogueNodeData;
          const text = compileSafe(node, () =>
            compileTextTemplate(data.text.source, textId(node.id), source.variables),
          );
          if (text) {
            instructions.push({
              id: instructionId(node.id),
              op: 'dialogue',
              speakerId: data.speakerId,
              text,
              voice: data.voiceId ? { default: data.voiceId } : undefined,
              emotion: data.emotion,
            });
          }
          const target = requireTarget(node, 'out');
          if (target) instructions.push(jump(node, target));
          break;
        }
        case StoryNodeType.SetVariable: {
          const data = node.data as unknown as SetVariableNodeData;
          if (
            !data.variableId ||
            !source.variables.some((variable) => variable.id === data.variableId)
          ) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: 'Set Variable does not reference an existing variable',
              sourceNodeId: node.id,
            });
          } else {
            const value = compileSafe(node, () => compileExpression(data.value, source.variables));
            if (value) {
              instructions.push({
                id: instructionId(node.id),
                op: 'set-variable',
                variableId: data.variableId,
                value,
              });
            }
          }
          const target = requireTarget(node, 'out');
          if (target) instructions.push(jump(node, target));
          break;
        }
        case StoryNodeType.Choice: {
          const data = node.data as unknown as ChoiceNodeData;
          const options = data.options.flatMap((option) => {
            const target = requireTarget(node, option.id);
            if (!target) return [];
            const text = compileSafe(node, () =>
              compileTextTemplate(option.text.source, textId(option.id), source.variables),
            );
            if (!text) return [];
            const visibleIf = option.visibleIf
              ? compileSafe(node, () => compileExpression(option.visibleIf!, source.variables))
              : undefined;
            const enabledIf = option.enabledIf
              ? compileSafe(node, () => compileExpression(option.enabledIf!, source.variables))
              : undefined;
            return [{ id: option.id, text, visibleIf, enabledIf, target }];
          });
          const prompt = data.prompt.source
            ? compileSafe(node, () =>
                compileTextTemplate(
                  data.prompt.source,
                  textId(`${node.id}_prompt`),
                  source.variables,
                ),
              )
            : undefined;
          instructions.push({ id: instructionId(node.id), op: 'choice', prompt, options });
          break;
        }
        case StoryNodeType.Branch: {
          const data = node.data as unknown as BranchNodeData;
          const whenTrue = requireTarget(node, 'true');
          const whenFalse = requireTarget(node, 'false');
          const condition = compileSafe(node, () =>
            compileExpression(data.condition, source.variables),
          );
          if (whenTrue && whenFalse && condition) {
            if (condition.valueType.kind !== 'boolean' && condition.valueType.kind !== 'any') {
              diagnostics.push({
                code: 'EXPRESSION_ERROR',
                severity: 'error',
                message: 'Branch condition must be boolean',
                sourceNodeId: node.id,
              });
            } else {
              instructions.push({
                id: instructionId(node.id),
                op: 'branch',
                condition,
                whenTrue,
                whenFalse,
              });
            }
          }
          break;
        }
        case StoryNodeType.End:
          instructions.push({ id: instructionId(node.id), op: 'end-story' });
          break;
        case StoryNodeType.GetVariable: {
          const data = node.data as unknown as GetVariableNodeData;
          if (
            data.variableId &&
            !source.variables.some((variable) => variable.id === data.variableId)
          ) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: 'Get Variable references a missing variable',
              sourceNodeId: node.id,
            });
          }
          break;
        }
        default:
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Unsupported node type ${node.type}`,
            sourceNodeId: node.id,
          });
      }
      if (instructions.length > 0) {
        const id = blockId(node.id);
        blocks[id] = { id, instructions };
      }
    }

    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { ok: false, diagnostics };
    }
    const program = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: programId(source.id),
      contentVersion: options.contentVersion ?? 'dev',
      entryBlockId: blockId(entry.id),
      blocks,
      chapters: {},
      variables: [...source.variables],
    } as const;
    const validationDiagnostics = validateRuntimeProgram(program);
    if (validationDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { ok: false, diagnostics: [...diagnostics, ...validationDiagnostics] };
    }
    return { ok: true, program, diagnostics: [...diagnostics, ...validationDiagnostics] };
  }
}

export function compileStory(source: StorySourceDocument, options?: CompileOptions): CompileResult {
  return new DefaultStoryCompiler().compile(source, options);
}
