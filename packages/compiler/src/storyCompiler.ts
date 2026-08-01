import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type BlockId,
  type BranchNodeData,
  type CallSubstoryNodeData,
  type CallEventNodeData,
  type ChapterId,
  type ChoiceNodeData,
  type DialogueNodeData,
  type FlowJumpNodeData,
  type GetVariableNodeData,
  type InstructionId,
  type NodeId,
  type ProgramId,
  type RuntimeBlock,
  type RuntimeChapterDefinition,
  type RuntimeInstruction,
  type SetVariableNodeData,
  type SourceGraph,
  type SourceNode,
  type StorySourceDocument,
  type TextId,
  type WaitSignalNodeData,
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

function instructionId(sourceId: string, tag = 'main'): InstructionId {
  return `i_${suffix(sourceId)}_${tag}` as InstructionId;
}

function textId(id: string): TextId {
  return `t_${suffix(id)}` as TextId;
}

function programId(id: string): ProgramId {
  return `p_${suffix(id)}` as ProgramId;
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

    const rootEntry = source.root.nodes.find((node) => node.type === StoryNodeType.Start);
    if (!rootEntry) {
      return {
        ok: false,
        diagnostics: [
          { code: 'MISSING_ENTRY_BLOCK', severity: 'error', message: 'Story has no entry node' },
        ],
      };
    }

    const chapterEntries = new Map<ChapterId, SourceNode>();
    for (const chapter of source.chapters) {
      const entry = chapter.graph.nodes.find((node) => node.type === StoryNodeType.Start);
      if (entry) chapterEntries.set(chapter.id, entry);
      else {
        diagnostics.push({
          code: 'MISSING_ENTRY_BLOCK',
          severity: 'error',
          message: `Substory ${chapter.displayName} has no entry node`,
        });
      }
    }
    for (const character of source.characters) {
      const portraitIds = [
        character.defaultPortraitId,
        ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
      ].filter(Boolean);
      for (const portraitId of portraitIds) {
        if (!source.assets.some((asset) => asset.id === portraitId && asset.kind === 'portrait')) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Character ${character.displayName} references missing portrait ${portraitId}`,
          });
        }
      }
    }

    const blocks: Record<string, RuntimeBlock> = {};
    const compileGraph = (graph: SourceGraph, chapterId?: ChapterId) => {
      const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
      const resolveTarget = (
        nodeId: NodeId,
        portId: string,
        visited = new Set<NodeId>(),
      ): BlockId | undefined => {
        const edge = graph.edges.find(
          (candidate) => candidate.from.nodeId === nodeId && candidate.from.portId === portId,
        );
        if (!edge) return undefined;
        const target = nodesById.get(edge.to.nodeId);
        if (!target || target.type !== StoryNodeType.Reroute) return blockId(edge.to.nodeId);
        if (visited.has(target.id)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: 'Reroute cycle does not reach an executable node',
            sourceNodeId: target.id,
          });
          return undefined;
        }
        visited.add(target.id);
        return resolveTarget(target.id, 'out', visited);
      };
      const requireTarget = (node: SourceNode, portId: string): BlockId | undefined => {
        const target = resolveTarget(node.id, portId);
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

      for (const node of graph.nodes) {
        if (
          node.type === StoryNodeType.GetVariable ||
          node.type === StoryNodeType.Reroute ||
          node.type === StoryNodeType.FlowAnchor
        )
          continue;
        const instructions: RuntimeInstruction[] = [];
        switch (node.type) {
          case StoryNodeType.Start: {
            const target = requireTarget(node, 'out');
            if (target) instructions.push(jump(node, target));
            break;
          }
          case StoryNodeType.Dialogue: {
            const data = node.data as unknown as DialogueNodeData;
            if (data.lines.length === 0) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Dialogue must contain at least one line',
                sourceNodeId: node.id,
              });
            }
            for (const line of data.lines) {
              const speakerId = line.speakerId;
              const voiceId = line.voiceId;
              const emotion = line.emotion;
              const speaker = speakerId
                ? source.characters.find((character) => character.id === speakerId)
                : undefined;
              const portraitId = emotion
                ? (speaker?.emotions[emotion]?.portraitId ?? speaker?.defaultPortraitId)
                : speaker?.defaultPortraitId;
              if (speakerId && !speaker) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Dialogue line ${line.id} references missing character ${speakerId}`,
                  sourceNodeId: node.id,
                });
              }
              if (emotion && speaker && !speaker.emotions[emotion]) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'warning',
                  message: `Character ${speaker.displayName} has no ${emotion} emotion`,
                  sourceNodeId: node.id,
                });
              }
              if (voiceId && !source.assets.some((asset) => asset.id === voiceId)) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Dialogue line ${line.id} references missing voice asset ${voiceId}`,
                  sourceNodeId: node.id,
                });
              }
              const text = compileSafe(node, () =>
                compileTextTemplate(line.text.source, line.textId, source.variables),
              );
              if (text) {
                instructions.push({
                  id: instructionId(line.id),
                  op: 'dialogue',
                  speakerId,
                  text,
                  voice: voiceId ? { default: voiceId } : undefined,
                  portraitId,
                  emotion,
                  tags: line.tags,
                });
              }
            }
            const target = requireTarget(node, 'out');
            if (target) instructions.push(jump(node, target));
            break;
          }
          case StoryNodeType.SetVariable: {
            const data = node.data as unknown as SetVariableNodeData;
            if (!data.variableId || !source.variables.some((item) => item.id === data.variableId)) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Set Variable does not reference an existing variable',
                sourceNodeId: node.id,
              });
            } else {
              const value = compileSafe(node, () =>
                compileExpression(data.value, source.variables),
              );
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
          case StoryNodeType.CallEvent: {
            const data = node.data as unknown as CallEventNodeData;
            const event = data.eventId
              ? source.events.find((candidate) => candidate.id === data.eventId)
              : undefined;
            if (!event) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Call Event does not reference an existing project event',
                sourceNodeId: node.id,
              });
            }
            const compiledArguments: Record<string, ReturnType<typeof compileExpression>> = {};
            if (event) {
              for (const parameter of event.parameters) {
                const argument = data.arguments[parameter.name];
                if (!argument) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Call Event is missing argument ${parameter.name}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                const compiled = compileSafe(node, () =>
                  compileExpression(argument, source.variables),
                );
                if (
                  compiled &&
                  compiled.valueType.kind !== 'any' &&
                  compiled.valueType.kind !== parameter.valueType.kind
                ) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Event argument ${parameter.name} expects ${parameter.valueType.kind}, got ${compiled.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else if (compiled) compiledArguments[parameter.name] = compiled;
              }
              const target = requireTarget(node, 'out');
              if (target && Object.keys(compiledArguments).length === event.parameters.length) {
                instructions.push({
                  id: instructionId(node.id),
                  op: 'call-event',
                  eventId: event.id,
                  arguments: compiledArguments,
                });
                instructions.push(jump(node, target));
              }
            } else {
              requireTarget(node, 'out');
            }
            break;
          }
          case StoryNodeType.WaitSignal: {
            const data = node.data as unknown as WaitSignalNodeData;
            const signal = data.signalId
              ? (source.signals ?? []).find((candidate) => candidate.id === data.signalId)
              : undefined;
            if (!signal) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Wait for Signal does not reference an existing project signal',
                sourceNodeId: node.id,
              });
            }
            const compiledMatches: Record<string, ReturnType<typeof compileExpression>> = {};
            if (signal) {
              for (const [name, expression] of Object.entries(data.matches)) {
                const parameter = signal.parameters.find((candidate) => candidate.name === name);
                if (!parameter) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Wait for Signal references missing parameter ${name}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                const compiled = compileSafe(node, () =>
                  compileExpression(expression, source.variables),
                );
                if (
                  compiled &&
                  compiled.valueType.kind !== 'any' &&
                  compiled.valueType.kind !== parameter.valueType.kind
                ) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Signal match ${name} expects ${parameter.valueType.kind}, got ${compiled.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else if (compiled) compiledMatches[name] = compiled;
              }
            }
            const target = requireTarget(node, 'out');
            if (
              signal &&
              target &&
              Object.keys(compiledMatches).length === Object.keys(data.matches).length
            ) {
              instructions.push({
                id: instructionId(node.id),
                op: 'wait-signal',
                signalId: signal.id,
                matches: compiledMatches,
              });
              instructions.push(jump(node, target));
            }
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
          case StoryNodeType.CallSubstory: {
            const data = node.data as unknown as CallSubstoryNodeData;
            const chapter = data.chapterId
              ? source.chapters.find((item) => item.id === data.chapterId)
              : undefined;
            const entry = data.chapterId ? chapterEntries.get(data.chapterId) : undefined;
            const returnBlock = requireTarget(node, 'out');
            if (!chapter || !entry) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Call Substory does not reference an existing substory',
                sourceNodeId: node.id,
              });
            } else if (returnBlock) {
              instructions.push({
                id: instructionId(node.id),
                op: 'call-chapter',
                chapterId: chapter.id,
                target: blockId(entry.id),
                arguments: {},
                returnTo: { blockId: returnBlock, instructionIndex: 0 },
              });
            }
            break;
          }
          case StoryNodeType.FlowJump: {
            const data = node.data as unknown as FlowJumpNodeData;
            const anchor = data.targetNodeId ? nodesById.get(data.targetNodeId) : undefined;
            if (!anchor || anchor.type !== StoryNodeType.FlowAnchor) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Flow Jump does not reference a Flow Anchor in the same graph',
                sourceNodeId: node.id,
              });
            } else {
              const target = requireTarget(anchor, 'out');
              if (target) instructions.push(jump(node, target));
            }
            break;
          }
          case StoryNodeType.Return:
            if (!chapterId) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Return can only be used inside a substory',
                sourceNodeId: node.id,
              });
            } else instructions.push({ id: instructionId(node.id), op: 'return' });
            break;
          case StoryNodeType.End:
            instructions.push({ id: instructionId(node.id), op: 'end-story' });
            break;
          case StoryNodeType.GetVariable: {
            const data = node.data as unknown as GetVariableNodeData;
            if (data.variableId && !source.variables.some((item) => item.id === data.variableId)) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Get Variable references a missing variable',
                sourceNodeId: node.id,
              });
            }
            break;
          }
          case StoryNodeType.Reroute:
          case StoryNodeType.FlowAnchor:
            break;
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
    };

    compileGraph(source.root);
    for (const chapter of source.chapters) compileGraph(chapter.graph, chapter.id);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { ok: false, diagnostics };
    }

    const chapters: Record<string, RuntimeChapterDefinition> = Object.fromEntries(
      source.chapters.map((chapter) => [
        chapter.id,
        {
          id: chapter.id,
          entryBlockId: blockId(chapterEntries.get(chapter.id)!.id),
          parameters: chapter.parameters.map((parameter) => ({
            variableId: parameter.variable.id,
            valueType: parameter.variable.valueType,
          })),
          localVariables: [...chapter.localVariables],
          returnType: chapter.returnType,
        },
      ]),
    );
    const program = {
      format: STORY_RUNTIME_FORMAT,
      version: STORY_RUNTIME_VERSION,
      id: programId(source.id),
      contentVersion: options.contentVersion ?? 'dev',
      entryBlockId: blockId(rootEntry.id),
      blocks,
      chapters,
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
