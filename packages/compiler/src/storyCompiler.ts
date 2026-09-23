import {
  STORY_RUNTIME_FORMAT,
  STORY_RUNTIME_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  choiceOptionTextId,
  choicePromptTextId,
  collectInkReservedTagGroups,
  isStableId,
  parseInkDialogueMetadata,
  runtimeValueMatchesType,
  resolveNodePorts,
  nodeRegistry,
  stripEngineObjectTypeMarkers,
  valueTypesCompatible,
  type BlockId,
  type BranchNodeData,
  type CallSubstoryNodeData,
  type StartStoryNodeData,
  type SwitchStoryNodeData,
  type ResumeStoryNodeData,
  type EndStoryInstanceNodeData,
  type CallEventNodeData,
  type ChapterId,
  type ChoiceNodeData,
  type ConditionSource,
  type ConditionTreeNode,
  type DialogueNodeData,
  type NarrationNodeData,
  type ExpressionSource,
  type InkBlockNodeData,
  type FlowJumpNodeData,
  type GetVariableNodeData,
  type InstructionId,
  type NodeId,
  type ProgramId,
  type RuntimeBlock,
  type RuntimeChapterDefinition,
  type RuntimeInstruction,
  type RuntimeValue,
  type TypedExpression,
  type ValueType,
  type VariableDefinition,
  type ReturnNodeData,
  type SetVariableNodeData,
  type SourceGraph,
  type SourceNode,
  type StorySourceDocument,
  type TextId,
  type VariableId,
  type WaitSignalNodeData,
} from '@story-blueprint/common';
import { Compiler as InkCompiler } from 'inkjs/full';
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

function programId(id: string): ProgramId {
  return `p_${suffix(id)}` as ProgramId;
}

interface InkExternalDeclaration {
  inkName: string;
  parameterNames: readonly string[];
}

/** Extracts declaration names only; Ink.js remains the authoritative parser/compiler. */
function scanInkExternalDeclarations(source: string): InkExternalDeclaration[] {
  const declarations: InkExternalDeclaration[] = [];
  const pattern = /^\s*EXTERNAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/gim;
  for (const match of source.matchAll(pattern)) {
    const parameterNames = match[2]!
      .split(',')
      .map((parameter) => parameter.trim())
      .filter(Boolean);
    if (parameterNames.every((parameter) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter))) {
      declarations.push({ inkName: match[1]!, parameterNames });
    }
  }
  return declarations;
}

function compileOpaqueJson(
  source: string,
  valueType: Extract<ValueType, { kind: 'json' | 'array' | 'map' | 'struct' }>,
): TypedExpression {
  let value: RuntimeValue;
  try {
    value = JSON.parse(source) as RuntimeValue;
  } catch (error) {
    throw new ExpressionCompileError(
      `Invalid JSON for ${valueType.kind === 'json' ? `engine type ${valueType.name}` : valueType.kind}: ${error instanceof Error ? error.message : String(error)}`,
      0,
    );
  }
  if (valueType.kind === 'array' && !Array.isArray(value)) {
    throw new ExpressionCompileError('Array value must be a JSON array', 0);
  }
  if (
    (valueType.kind === 'map' || valueType.kind === 'struct') &&
    (value === null || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new ExpressionCompileError(
      `${valueType.kind === 'struct' ? 'Struct' : 'Map'} value must be a JSON object`,
      0,
    );
  }
  if (!runtimeValueMatchesType(value, valueType)) {
    throw new ExpressionCompileError(
      `JSON value does not match ${valueType.kind} item contract`,
      0,
    );
  }
  return { kind: 'literal', value: stripEngineObjectTypeMarkers(value), valueType };
}

function valueTypesMatch(actual: ValueType, expected: ValueType): boolean {
  return valueTypesCompatible(actual, expected);
}

function compileAuthoredValue(
  expression: ExpressionSource,
  expectedType: ValueType,
  variables: readonly VariableDefinition[],
  characters: StorySourceDocument['characters'],
): TypedExpression {
  if (expectedType.kind === 'character-ref' || expectedType.kind === 'asset-ref') {
    const bareSource = expression.source.trim();
    if (isStableId(bareSource, expectedType.kind === 'character-ref' ? 'character' : 'asset')) {
      return {
        kind: 'literal',
        value: bareSource,
        valueType: expectedType,
      };
    }
    const compiled = compileExpression(expression, variables, characters);
    if (valueTypesMatch(compiled.valueType, expectedType)) return compiled;
    if (
      compiled.kind === 'literal' &&
      typeof compiled.value === 'string' &&
      isStableId(compiled.value, expectedType.kind === 'character-ref' ? 'character' : 'asset')
    ) {
      return { ...compiled, valueType: expectedType };
    }
    throw new ExpressionCompileError(
      `Value must be a valid ${expectedType.kind === 'character-ref' ? 'Character' : 'Asset'} ID`,
      0,
    );
  }
  if (
    expectedType.kind !== 'json' &&
    expectedType.kind !== 'array' &&
    expectedType.kind !== 'map' &&
    expectedType.kind !== 'struct'
  )
    return compileExpression(expression, variables, characters);
  try {
    return compileOpaqueJson(expression.source, expectedType);
  } catch (jsonError) {
    try {
      const compiled = compileExpression(expression, variables, characters);
      if (!valueTypesMatch(compiled.valueType, expectedType)) {
        throw new ExpressionCompileError(
          expectedType.kind === 'json'
            ? `Engine JSON value must be ${expectedType.name}`
            : `Value must be ${expectedType.kind}`,
          0,
        );
      }
      return compiled;
    } catch (expressionError) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expression.source.trim())) throw expressionError;
      throw jsonError;
    }
  }
}

function compileConditionTree(
  tree: ConditionTreeNode,
  conditions: readonly ConditionSource[],
  variables: readonly VariableDefinition[],
  characters: StorySourceDocument['characters'],
  stack: readonly string[] = [],
): TypedExpression {
  if (tree.kind === 'expression') {
    const expression = compileExpression(tree.expression, variables, characters);
    if (expression.valueType.kind !== 'boolean' && expression.valueType.kind !== 'any') {
      throw new ExpressionCompileError('Condition expression must be boolean', 0);
    }
    return expression;
  }
  if (tree.kind === 'reference') {
    const condition = conditions.find((candidate) => candidate.id === tree.conditionId);
    if (!condition) throw new ExpressionCompileError(`Missing condition ${tree.conditionId}`, 0);
    if (stack.includes(condition.id)) {
      throw new ExpressionCompileError(
        `Condition reference cycle detected: ${[...stack, condition.id].join(' -> ')}`,
        0,
      );
    }
    return compileConditionTree(condition.root, conditions, variables, characters, [
      ...stack,
      condition.id,
    ]);
  }
  if (tree.kind === 'not') {
    const child = compileConditionTree(tree.child, conditions, variables, characters, stack);
    if (child.valueType.kind !== 'boolean' && child.valueType.kind !== 'any') {
      throw new ExpressionCompileError('Condition child must be boolean', 0);
    }
    return { kind: 'unary', operator: 'not', operand: child, valueType: { kind: 'boolean' } };
  }
  const children = tree.children.map((child) =>
    compileConditionTree(child, conditions, variables, characters, stack),
  );
  if (children.length === 0) {
    return {
      kind: 'literal',
      value: tree.kind === 'all',
      valueType: { kind: 'boolean' },
    };
  }
  if (children.some((child) => !['boolean', 'any'].includes(child.valueType.kind))) {
    throw new ExpressionCompileError('Condition children must be boolean', 0);
  }
  return children.slice(1).reduce(
    (left, right) => ({
      kind: 'binary',
      operator: tree.kind === 'all' ? 'and' : 'or',
      left,
      right,
      valueType: { kind: 'boolean' },
    }),
    children[0]!,
  );
}

function jump(node: SourceNode, target: BlockId): RuntimeInstruction {
  return { id: instructionId(node.id, 'next'), op: 'jump', target };
}

export class DefaultStoryCompiler implements StoryCompiler {
  compile(source: StorySourceDocument, options: CompileOptions = {}): CompileResult {
    const diagnostics: CompilerDiagnostic[] = [];
    const usedTextIds = new Set<string>();
    for (const graph of [source.root, ...source.chapters.map((chapter) => chapter.graph)]) {
      for (const node of graph.nodes) {
        if (node.type === StoryNodeType.Dialogue) {
          for (const line of (node.data as unknown as DialogueNodeData).lines)
            usedTextIds.add(line.textId);
        } else if (node.type === StoryNodeType.Narration) {
          usedTextIds.add((node.data as unknown as NarrationNodeData).textId);
        } else if (node.type === StoryNodeType.Choice) {
          const choice = node.data as unknown as ChoiceNodeData;
          if (choice.prompt) usedTextIds.add(choicePromptTextId(node.id));
          for (const option of choice.options) usedTextIds.add(choiceOptionTextId(option.id));
        }
      }
    }
    const translationsFor = (id: TextId): Record<string, string> =>
      Object.fromEntries(
        Object.entries(options.translations ?? {}).flatMap(([locale, entries]) =>
          entries[id] === undefined ? [] : [[locale, entries[id]!]],
        ),
      );
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

    const characterFields = source.characters.flatMap((character) => character.fields ?? []);
    const allVariables = [...source.variables, ...characterFields];
    const variableIds = new Set<string>();
    const variableNames = new Set<string>();
    for (const variable of allVariables) {
      if (variableIds.has(variable.id)) {
        diagnostics.push({
          code: 'INVALID_NODE',
          severity: 'error',
          message: `Duplicate variable or character field ID ${variable.id}`,
        });
      }
      variableIds.add(variable.id);
      if (variable.scope !== 'character') {
        if (variableNames.has(variable.name)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Duplicate Story or Project variable name ${variable.name}`,
          });
        }
        variableNames.add(variable.name);
      }
    }
    const characterNames = new Set<string>();
    for (const character of source.characters) {
      if (characterNames.has(character.name)) {
        diagnostics.push({
          code: 'INVALID_NODE',
          severity: 'error',
          message: `Duplicate character name ${character.name}`,
        });
      }
      characterNames.add(character.name);
      const fieldNames = new Set<string>();
      for (const field of character.fields ?? []) {
        if (fieldNames.has(field.name)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Character ${character.name} has duplicate field ${field.name}`,
          });
        }
        fieldNames.add(field.name);
        if (
          field.scope !== 'character' ||
          !['boolean', 'number', 'string', 'character-ref', 'asset-ref', 'json'].includes(
            field.valueType.kind,
          )
        ) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Character field ${character.name}.${field.name} must be a scalar character field`,
          });
        }
      }
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
      const chapterVariables = [
        ...chapter.parameters.map((parameter) => parameter.variable),
        ...chapter.localVariables,
      ];
      const chapterNames = new Set(variableNames);
      for (const variable of chapterVariables) {
        if (variableIds.has(variable.id)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Duplicate variable ID ${variable.id} in substory ${chapter.displayName}`,
          });
        }
        variableIds.add(variable.id);
        if (chapterNames.has(variable.name)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Duplicate visible variable name ${variable.name} in substory ${chapter.displayName}`,
          });
        }
        chapterNames.add(variable.name);
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
      const chapter = chapterId
        ? source.chapters.find((candidate) => candidate.id === chapterId)
        : undefined;
      const visibleVariables = [
        ...allVariables,
        ...(chapter?.parameters.map((parameter) => parameter.variable) ?? []),
        ...(chapter?.localVariables ?? []),
      ];
      const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
      const outgoingByPort = new Map<string, SourceGraph['edges'][number]>();
      for (const edge of graph.edges) {
        const key = `${edge.from.nodeId}\0${edge.from.portId}`;
        if (!outgoingByPort.has(key)) outgoingByPort.set(key, edge);
      }
      // Only nodes reachable from the graph entry are executable. Orphaned nodes are
      // valid authoring work-in-progress and must not produce execution diagnostics.
      const reachableNodeIds = new Set<NodeId>();
      const pendingReachability: NodeId[] = [];
      const entry = graph.nodes.find((candidate) => candidate.type === StoryNodeType.Start);
      if (entry) pendingReachability.push(entry.id);
      const isExecutionOutput = (node: SourceNode, portId: string): boolean => {
        return resolveNodePorts({ id: node.id, type: node.type as StoryNodeType, data: node.data }).ports.some(
          (port) => port.id === portId && port.direction === 'output' && port.kind === 'execution',
        );
      };
      while (pendingReachability.length > 0) {
        const nodeId = pendingReachability.shift()!;
        if (reachableNodeIds.has(nodeId)) continue;
        const node = nodesById.get(nodeId);
        if (!node) continue;
        reachableNodeIds.add(nodeId);
        if (node.type === StoryNodeType.FlowJump) {
          const target = (node.data as unknown as FlowJumpNodeData).targetNodeId;
          if (target) pendingReachability.push(target);
        }
        for (const edge of graph.edges) {
          if (edge.from.nodeId !== nodeId || !isExecutionOutput(node, edge.from.portId)) continue;
          pendingReachability.push(edge.to.nodeId);
        }
      }
      const resolveTarget = (
        nodeId: NodeId,
        portId: string,
        visited = new Set<NodeId>(),
      ): BlockId | undefined => {
        const edge = outgoingByPort.get(`${nodeId}\0${portId}`);
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
      const resolveTargetNodeId = (
        nodeId: NodeId,
        portId: string,
        visited = new Set<NodeId>(),
      ): NodeId | undefined => {
        const edge = outgoingByPort.get(`${nodeId}\0${portId}`);
        if (!edge) return undefined;
        const target = nodesById.get(edge.to.nodeId);
        if (!target || target.type !== StoryNodeType.Reroute) return edge.to.nodeId;
        if (visited.has(target.id)) return undefined;
        visited.add(target.id);
        return resolveTargetNodeId(target.id, 'out', visited);
      };
      const nodeLabel = (node: SourceNode): string => {
        return nodeRegistry.get(node.type as StoryNodeType)?.label ?? node.type;
      };

      let dominanceContext:
        | {
            canReach: (fromId: NodeId, toId: NodeId) => boolean;
            dominates: (fromId: NodeId, toId: NodeId) => boolean;
          }
        | undefined;

      const getDominanceContext = () => {
        if (dominanceContext) return dominanceContext;

        const cfgSuccessors = new Map<NodeId, Set<NodeId>>();
        const cfgPredecessors = new Map<NodeId, Set<NodeId>>();
        for (const id of reachableNodeIds) {
          cfgSuccessors.set(id, new Set());
          cfgPredecessors.set(id, new Set());
        }

        const resolveFlowJumpTarget = (node: SourceNode): NodeId | undefined => {
          if (node.type !== StoryNodeType.FlowJump) return undefined;
          const jumpTargetId = (node.data as unknown as FlowJumpNodeData).targetNodeId;
          if (!jumpTargetId) return undefined;
          const target = nodesById.get(jumpTargetId);
          if (!target || target.type !== StoryNodeType.Reroute) return jumpTargetId;
          return resolveTargetNodeId(target.id, 'out');
        };

        for (const id of reachableNodeIds) {
          const node = nodesById.get(id);
          if (!node) continue;
          const succs = cfgSuccessors.get(id)!;
          if (node.type === StoryNodeType.FlowJump) {
            const jumpTarget = resolveFlowJumpTarget(node);
            if (jumpTarget && reachableNodeIds.has(jumpTarget)) {
              succs.add(jumpTarget);
              cfgPredecessors.get(jumpTarget)?.add(id);
            }
          }
          const ports = resolveNodePorts({
            id: node.id,
            type: node.type as StoryNodeType,
            data: node.data,
          }).ports;
          for (const port of ports) {
            if (port.direction === 'output' && port.kind === 'execution') {
              const targetId = resolveTargetNodeId(id, port.id);
              if (targetId && reachableNodeIds.has(targetId)) {
                succs.add(targetId);
                cfgPredecessors.get(targetId)?.add(id);
              }
            }
          }
        }

        const reachabilityCache = new Map<NodeId, Set<NodeId>>();
        const canReach = (fromId: NodeId, toId: NodeId): boolean => {
          if (fromId === toId) return true;
          let reachable = reachabilityCache.get(fromId);
          if (!reachable) {
            reachable = new Set<NodeId>();
            const queue: NodeId[] = [fromId];
            while (queue.length > 0) {
              const current = queue.shift()!;
              const succs = cfgSuccessors.get(current);
              if (succs) {
                for (const succ of succs) {
                  if (!reachable.has(succ)) {
                    reachable.add(succ);
                    queue.push(succ);
                  }
                }
              }
            }
            reachabilityCache.set(fromId, reachable);
          }
          return reachable.has(toId);
        };

        const dominators = new Map<NodeId, Set<NodeId>>();
        if (entry && reachableNodeIds.has(entry.id)) {
          dominators.set(entry.id, new Set([entry.id]));
          for (const id of reachableNodeIds) {
            if (id !== entry.id) {
              dominators.set(id, new Set(reachableNodeIds));
            }
          }
          let changed = true;
          let iterations = 0;
          const maxIterations = Math.max(20, reachableNodeIds.size * 2);
          while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;
            for (const id of reachableNodeIds) {
              if (id === entry.id) continue;
              const preds = cfgPredecessors.get(id);
              if (!preds || preds.size === 0) {
                const currentDom = dominators.get(id)!;
                if (currentDom.size !== 1 || !currentDom.has(id)) {
                  dominators.set(id, new Set([id]));
                  changed = true;
                }
                continue;
              }
              let intersection: Set<NodeId> | undefined;
              for (const pred of preds) {
                const predDom = dominators.get(pred);
                if (!predDom) continue;
                if (!intersection) {
                  intersection = new Set(predDom);
                } else {
                  for (const item of intersection) {
                    if (!predDom.has(item)) intersection.delete(item);
                  }
                }
              }
              const nextDom = new Set(intersection ?? []);
              nextDom.add(id);
              const currentDom = dominators.get(id)!;
              if (nextDom.size !== currentDom.size || [...nextDom].some((x) => !currentDom.has(x))) {
                dominators.set(id, nextDom);
                changed = true;
              }
            }
          }
        }

        const dominates = (fromId: NodeId, toId: NodeId): boolean => {
          return dominators.get(toId)?.has(fromId) ?? false;
        };

        dominanceContext = { canReach, dominates };
        return dominanceContext;
      };

      const validateExecutionOrder = (
        sourceNode: SourceNode,
        consumerNode: SourceNode,
      ): boolean => {
        const sourceLabel = nodeLabel(sourceNode);
        const consumerLabel = nodeLabel(consumerNode);
        const valueKind =
          sourceNode.type === StoryNodeType.WaitSignal ? 'a payload value' : 'an Out value';
        const outputKind = sourceNode.type === StoryNodeType.WaitSignal ? 'payload' : 'output';

        if (sourceNode.id === consumerNode.id) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `${sourceLabel} cannot consume its own output as an input argument`,
            sourceNodeId: consumerNode.id,
          });
          return false;
        }

        const { canReach, dominates } = getDominanceContext();

        if (!canReach(sourceNode.id, consumerNode.id)) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `${sourceLabel} supplying ${valueKind} must execute before ${consumerLabel}`,
            sourceNodeId: consumerNode.id,
          });
          return false;
        }

        if (!dominates(sourceNode.id, consumerNode.id)) {
          diagnostics.push({
            code: 'DATA_SOURCE_NOT_GUARANTEED',
            severity: 'warning',
            message: `${sourceLabel} ${outputKind} is not guaranteed to be executed on all paths leading to ${consumerLabel}`,
            sourceNodeId: consumerNode.id,
          });
        }

        return true;
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
      const connectedDataExpression = (
        node: SourceNode,
        portId: string,
      ): { connected: boolean; value?: TypedExpression } => {
        const edge = graph.edges.find(
          (candidate) => candidate.to.nodeId === node.id && candidate.to.portId === portId,
        );
        if (!edge) return { connected: false };
        const resolveDataSource = (
          nodeId: NodeId,
          sourcePortId: string,
          visited = new Set<NodeId>(),
        ): { node: SourceNode; portId: string } | undefined => {
          const sourceNode = nodesById.get(nodeId);
          if (!sourceNode) return undefined;
          if (sourceNode.type !== StoryNodeType.Reroute) {
            return { node: sourceNode, portId: sourcePortId };
          }
          if (sourcePortId !== 'out' || visited.has(nodeId)) return undefined;
          visited.add(nodeId);
          const incoming = graph.edges.find(
            (candidate) => candidate.to.nodeId === nodeId && candidate.to.portId === 'in',
          );
          return incoming
            ? resolveDataSource(incoming.from.nodeId, incoming.from.portId, visited)
            : undefined;
        };
        const resolvedSource = resolveDataSource(edge.from.nodeId, edge.from.portId);
        const sourceNode = resolvedSource?.node;
        const sourcePortId = resolvedSource?.portId ?? edge.from.portId;
        if (sourceNode?.type === StoryNodeType.CallEvent && sourcePortId.startsWith('output:')) {
          const outputId = sourcePortId.slice('output:'.length);
          const call = sourceNode.data as unknown as CallEventNodeData;
          if (!reachableNodeIds.has(sourceNode.id)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: 'Call External Function supplying an Out value must be execution-reachable',
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          if (!validateExecutionOrder(sourceNode, node)) {
            return { connected: true };
          }
          const event = call.eventId
            ? source.events.find((candidate) => candidate.id === call.eventId)
            : undefined;
          const output = event?.outputs?.find((candidate) => candidate.id === outputId);
          if (!event || !output) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Call External Function output ${outputId} is not declared by its Event`,
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          return {
            connected: true,
            value: {
              kind: 'event-output',
              instructionId: instructionId(sourceNode.id),
              outputId: output.id,
              valueType: output.valueType,
            },
          };
        }
        if (sourceNode?.type === StoryNodeType.CallSubstory && sourcePortId.startsWith('output:')) {
          const outputId = sourcePortId.slice('output:'.length) as VariableId;
          const call = sourceNode.data as unknown as CallSubstoryNodeData;
          if (!reachableNodeIds.has(sourceNode.id)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: 'Call Substory supplying an Out value must be execution-reachable',
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          if (!validateExecutionOrder(sourceNode, node)) {
            return { connected: true };
          }
          const calledChapter = call.chapterId
            ? source.chapters.find((candidate) => candidate.id === call.chapterId)
            : undefined;
          const output = calledChapter?.outputs.find(
            (candidate) => candidate.variable.id === outputId,
          );
          if (!calledChapter || !output) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Call Substory output ${outputId} is not declared by its Substory`,
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          return {
            connected: true,
            value: {
              kind: 'substory-output',
              instructionId: instructionId(sourceNode.id),
              outputId: output.variable.id,
              valueType: output.variable.valueType,
            },
          };
        }
        if (sourceNode?.type === StoryNodeType.WaitSignal && sourcePortId.startsWith('payload:')) {
          const paramName = sourcePortId.slice('payload:'.length);
          const wait = sourceNode.data as unknown as WaitSignalNodeData;
          if (!reachableNodeIds.has(sourceNode.id)) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: 'Wait for Signal supplying a payload value must be execution-reachable',
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          if (!validateExecutionOrder(sourceNode, node)) {
            return { connected: true };
          }
          const signal = wait.signalId
            ? source.signals?.find((candidate) => candidate.id === wait.signalId)
            : undefined;
          const param = signal?.parameters.find((candidate) => candidate.name === paramName);
          if (!signal || !param) {
            diagnostics.push({
              code: 'INVALID_NODE',
              severity: 'error',
              message: `Wait for Signal payload ${paramName} is not declared by its Signal`,
              sourceNodeId: sourceNode.id,
            });
            return { connected: true };
          }
          return {
            connected: true,
            value: {
              kind: 'signal-output',
              instructionId: instructionId(sourceNode.id),
              outputId: param.name,
              valueType: param.valueType,
            },
          };
        }
        if (
          !sourceNode ||
          sourceNode.type !== StoryNodeType.GetVariable ||
          (sourcePortId !== 'value' && !sourcePortId.startsWith('field:'))
        ) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `${node.type}.${portId} requires a valid Get Variable output`,
            sourceNodeId: node.id,
          });
          return { connected: true };
        }
        const read = sourceNode.data as unknown as GetVariableNodeData;
        const variable = visibleVariables.find((candidate) => candidate.id === read.variableId);
        if (!variable) {
          diagnostics.push({
            code: 'INVALID_NODE',
            severity: 'error',
            message: `Get Variable connected to ${node.type}.${portId} references a missing variable`,
            sourceNodeId: sourceNode.id,
          });
          return { connected: true };
        }
        const target: TypedExpression = {
          kind: 'variable',
          variableId: variable.id,
          valueType: variable.valueType,
        };
        const value = compileSafe(sourceNode, () => {
          if (sourcePortId.startsWith('field:')) {
            const fieldId = sourcePortId.slice('field:'.length);
            const field = read.exposedFields?.find((candidate) => candidate.fieldId === fieldId);
            if (!field) {
              throw new ExpressionCompileError(
                `Get Variable output ${sourcePortId} no longer exists`,
                0,
              );
            }
            return {
              kind: 'member' as const,
              target,
              member: field.member,
              valueType: field.valueType,
            };
          }
          if (read.accessor?.kind === 'member') {
            return {
              kind: 'member' as const,
              target,
              member: read.accessor.member,
              valueType: read.accessor.valueType,
            };
          }
          if (read.accessor?.kind === 'index') {
            return {
              kind: 'index' as const,
              target,
              index: compileExpression(read.accessor.index, visibleVariables, source.characters),
              valueType: read.accessor.valueType,
            };
          }
          return target;
        });
        return { connected: true, value };
      };

      for (const node of graph.nodes) {
        if (!reachableNodeIds.has(node.id)) continue;
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
                compileTextTemplate(
                  line.text,
                  line.textId,
                  visibleVariables,
                  source.characters,
                  translationsFor(line.textId),
                ),
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
            const target = resolveTarget(node.id, 'out');
            if (target) instructions.push(jump(node, target));
            else instructions.push({ id: instructionId(node.id, 'end'), op: 'end-story' });
            break;
          }
          case StoryNodeType.Narration: {
            const data = node.data as unknown as NarrationNodeData;
            if (data.voiceId && !source.assets.some((asset) => asset.id === data.voiceId)) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Narration references missing voice asset ${data.voiceId}`,
                sourceNodeId: node.id,
              });
            }
            const text = compileSafe(node, () =>
              compileTextTemplate(
                data.text,
                data.textId,
                visibleVariables,
                source.characters,
                translationsFor(data.textId),
              ),
            );
            if (text) {
              instructions.push({
                id: instructionId(node.id),
                op: 'narration',
                text,
                voice: data.voiceId ? { default: data.voiceId } : undefined,
              });
            }
            const target = resolveTarget(node.id, 'out');
            if (target) instructions.push(jump(node, target));
            else instructions.push({ id: instructionId(node.id, 'end'), op: 'end-story' });
            break;
          }
          case StoryNodeType.InkBlock: {
            const data = node.data as unknown as InkBlockNodeData;
            const inkSource =
              data.sourceMode === 'embedded' ? data.source : options.inkSources?.[data.path];
            if (inkSource === undefined) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Linked Ink source is unavailable: ${data.sourceMode === 'linked' ? data.path : 'unknown'}`,
                sourceNodeId: node.id,
              });
              break;
            }
            let invalidMetadata = false;
            for (const tagGroup of collectInkReservedTagGroups(inkSource)) {
              const metadata = parseInkDialogueMetadata(tagGroup);
              for (const message of metadata.errors) {
                invalidMetadata = true;
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Ink Block: ${message}`,
                  sourceNodeId: node.id,
                });
              }
              if (metadata.speakerId) {
                const speaker = source.characters.find(
                  (character) => character.id === metadata.speakerId,
                );
                if (!speaker) {
                  invalidMetadata = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink Block references missing character ${metadata.speakerId}`,
                    sourceNodeId: node.id,
                  });
                } else if (metadata.emotion && !speaker.emotions[metadata.emotion]) {
                  invalidMetadata = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Character ${speaker.displayName} has no ${metadata.emotion} emotion`,
                    sourceNodeId: node.id,
                  });
                }
              } else if (metadata.emotion) {
                invalidMetadata = true;
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: 'Ink Block emotion tag requires a speaker tag on the same output line',
                  sourceNodeId: node.id,
                });
              }
              if (
                metadata.voiceId &&
                !source.assets.some((asset) => asset.id === metadata.voiceId)
              ) {
                invalidMetadata = true;
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Ink Block references missing voice asset ${metadata.voiceId}`,
                  sourceNodeId: node.id,
                });
              }
              if (metadata.textId) {
                if (usedTextIds.has(metadata.textId)) {
                  invalidMetadata = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Duplicate Ink text ID ${metadata.textId}`,
                    sourceNodeId: node.id,
                  });
                } else {
                  usedTextIds.add(metadata.textId);
                }
              }
            }
            if (invalidMetadata) break;
            try {
              const compiler = new InkCompiler(inkSource);
              const compiledInk = compiler.Compile();
              if (compiler.errors.length > 0) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Ink Block: ${compiler.errors.join('\n')}`,
                  sourceNodeId: node.id,
                });
                break;
              }
              const entryKnot = data.entryKnot?.trim();
              if (entryKnot && !compiledInk.KnotContainerWithName(entryKnot)) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Ink Block entry knot does not exist: ${entryKnot}`,
                  sourceNodeId: node.id,
                });
                break;
              }
              const variableBindings = data.variableBindings ?? [];
              const seenInkNames = new Set<string>();
              let invalidBinding = false;
              for (const binding of variableBindings) {
                const variable = allVariables.find(
                  (candidate) => candidate.id === binding.variableId,
                );
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.inkName)) {
                  invalidBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink variable name is invalid: ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                } else if (seenInkNames.has(binding.inkName)) {
                  invalidBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink variable is mapped more than once: ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                } else if (
                  !compiledInk.variablesState.GlobalVariableExistsWithName(binding.inkName)
                ) {
                  invalidBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink Block has no global variable named ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                }
                seenInkNames.add(binding.inkName);
                if (!variable) {
                  invalidBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink Block references missing variable ${binding.variableId}`,
                    sourceNodeId: node.id,
                  });
                } else if (
                  !['boolean', 'number', 'string', 'enum'].includes(variable.valueType.kind)
                ) {
                  invalidBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink variable ${binding.inkName} cannot map to ${variable.valueType.kind} variable ${variable.displayName}`,
                    sourceNodeId: node.id,
                  });
                }
              }
              if (invalidBinding) break;
              const externalDeclarations = scanInkExternalDeclarations(inkSource);
              const externalFunctionBindings = data.externalFunctionBindings ?? [];
              const seenExternalNames = new Set<string>();
              let invalidExternalBinding = false;
              for (const binding of externalFunctionBindings) {
                const declaration = externalDeclarations.find(
                  (candidate) => candidate.inkName === binding.inkName,
                );
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.inkName)) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function name is invalid: ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                } else if (seenExternalNames.has(binding.inkName)) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function is mapped more than once: ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                } else if (!declaration) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink Block has no EXTERNAL declaration named ${binding.inkName}`,
                    sourceNodeId: node.id,
                  });
                }
                const event = source.events.find(
                  (candidate) => candidate.id === binding.functionId,
                );
                if (!event) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function ${binding.inkName} references missing External Function ${binding.functionId}`,
                    sourceNodeId: node.id,
                  });
                } else if (
                  declaration &&
                  event.parameters.length !== declaration.parameterNames.length
                ) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function ${binding.inkName} expects ${declaration.parameterNames.length} parameter(s), but ${event.displayName} defines ${event.parameters.length}`,
                    sourceNodeId: node.id,
                  });
                } else if ((event.outputs ?? []).length > 1) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function ${binding.inkName} maps to ${event.displayName}, which declares multiple outputs; Ink EXTERNAL calls support one return value`,
                    sourceNodeId: node.id,
                  });
                }
                seenExternalNames.add(binding.inkName);
              }
              for (const declaration of externalDeclarations) {
                if (!seenExternalNames.has(declaration.inkName)) {
                  invalidExternalBinding = true;
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Ink external function ${declaration.inkName} is not mapped to an External Function`,
                    sourceNodeId: node.id,
                  });
                }
              }
              if (invalidExternalBinding) break;
              for (const warning of compiler.warnings) {
                diagnostics.push({
                  code: 'INK_WARNING',
                  severity: 'warning',
                  message: `Ink Block warning: ${warning.replace(/^WARNING:\s*/i, '')}`,
                  sourceNodeId: node.id,
                });
              }
              instructions.push({
                id: instructionId(node.id),
                op: 'ink-block',
                inkJson: compiledInk.ToJson() as string,
                entryKnot,
                variableBindings,
                externalFunctionBindings: externalFunctionBindings.map((binding) => ({
                  inkName: binding.inkName,
                  functionId: binding.functionId,
                  parameterNames: externalDeclarations.find(
                    (candidate) => candidate.inkName === binding.inkName,
                  )!.parameterNames,
                })),
              });
              const target = resolveTarget(node.id, 'out');
              if (target) instructions.push(jump(node, target));
              else instructions.push({ id: instructionId(node.id, 'end'), op: 'end-story' });
            } catch (error) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `Ink Block: ${error instanceof Error ? error.message : String(error)}`,
                sourceNodeId: node.id,
              });
            }
            break;
          }
          case StoryNodeType.SetVariable: {
            const data = node.data as unknown as SetVariableNodeData;
            if (!data.variableId || !visibleVariables.some((item) => item.id === data.variableId)) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Set Variable does not reference an existing variable',
                sourceNodeId: node.id,
              });
            } else {
              const variable = visibleVariables.find((item) => item.id === data.variableId)!;
              const connectedValue = connectedDataExpression(node, 'value');
              const connectedKey =
                data.containerOperation === 'set-entry'
                  ? connectedDataExpression(node, 'key')
                  : { connected: false as const };
              const containerOperation = data.containerOperation;
              const operationValid =
                !containerOperation ||
                (containerOperation === 'append' && variable.valueType.kind === 'array') ||
                (containerOperation === 'set-entry' && variable.valueType.kind === 'map') ||
                (containerOperation === 'set-field' &&
                  variable.valueType.kind === 'json' &&
                  Boolean(data.fieldId && data.fieldName && data.fieldValueType));
              if (!operationValid) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Container operation does not support ${variable.valueType.kind}`,
                  sourceNodeId: node.id,
                });
              }
              const value =
                connectedValue.value ??
                (!connectedValue.connected
                  ? compileSafe(node, () =>
                      containerOperation === 'set-field' && data.fieldValueType
                        ? compileAuthoredValue(
                            data.value,
                            data.fieldValueType,
                            visibleVariables,
                            source.characters,
                          )
                        : containerOperation === 'append' && variable.valueType.kind === 'array'
                          ? compileAuthoredValue(
                              data.value,
                              variable.valueType.elementType ?? { kind: 'any' },
                              visibleVariables,
                              source.characters,
                            )
                          : containerOperation === 'set-entry' && variable.valueType.kind === 'map'
                            ? compileAuthoredValue(
                                data.value,
                                variable.valueType.valueType ?? { kind: 'any' },
                                visibleVariables,
                                source.characters,
                              )
                            : containerOperation
                              ? compileExpression(data.value, visibleVariables, source.characters)
                              : compileAuthoredValue(
                                  data.value,
                                  variable.valueType,
                                  visibleVariables,
                                  source.characters,
                                ),
                    )
                  : undefined);
              const key =
                connectedKey.value ??
                (containerOperation === 'set-entry' && data.key && !connectedKey.connected
                  ? compileSafe(node, () =>
                      compileAuthoredValue(
                        data.key!,
                        variable.valueType.kind === 'map' && variable.valueType.keyType === 'number'
                          ? { kind: 'number' }
                          : variable.valueType.kind === 'map' &&
                              variable.valueType.keyType === 'character-ref'
                            ? { kind: 'character-ref' }
                            : variable.valueType.kind === 'map' &&
                                variable.valueType.keyType === 'asset-ref'
                              ? { kind: 'asset-ref' }
                              : { kind: 'string' },
                        visibleVariables,
                        source.characters,
                      ),
                    )
                  : undefined);
              if (containerOperation === 'set-entry' && !data.key && !connectedKey.connected) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: 'Map Set Entry requires a key',
                  sourceNodeId: node.id,
                });
              }
              if (value && operationValid) {
                const expectedValueType =
                  containerOperation === 'set-field'
                    ? data.fieldValueType
                    : containerOperation === 'append' && variable.valueType.kind === 'array'
                      ? variable.valueType.elementType
                      : containerOperation === 'set-entry' && variable.valueType.kind === 'map'
                        ? variable.valueType.valueType
                        : variable.valueType;
                if (expectedValueType && !valueTypesMatch(value.valueType, expectedValueType)) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message:
                      containerOperation === 'set-field'
                        ? `Object field ${data.fieldName ?? 'field'} must be ${expectedValueType.kind}`
                        : containerOperation === 'append'
                          ? `Array item must be ${expectedValueType.kind}`
                          : containerOperation === 'set-entry'
                            ? `Map value must be ${expectedValueType.kind}`
                            : `Set Variable ${variable.name} must be ${variable.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else {
                  instructions.push({
                    id: instructionId(node.id),
                    op: 'set-variable',
                    variableId: data.variableId,
                    value,
                    ...(containerOperation ? { containerOperation } : {}),
                    ...(key ? { key } : {}),
                    ...(containerOperation === 'set-field' && data.fieldName
                      ? { fieldName: data.fieldName }
                      : {}),
                  });
                }
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
                const connectedArgument = connectedDataExpression(
                  node,
                  `argument:${parameter.name}`,
                );
                if (!argument && !connectedArgument.connected) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Call Event is missing argument ${parameter.name}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                const compiled =
                  connectedArgument.value ??
                  (!connectedArgument.connected && argument
                    ? compileSafe(node, () =>
                        compileAuthoredValue(
                          argument!,
                          parameter.valueType,
                          visibleVariables,
                          source.characters,
                        ),
                      )
                    : undefined);
                if (compiled && !valueTypesMatch(compiled.valueType, parameter.valueType)) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Event argument ${parameter.name} expects ${parameter.valueType.kind}, got ${compiled.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else if (compiled) compiledArguments[parameter.name] = compiled;
              }
              const resultVariableIds: Record<string, VariableId> = {};
              for (const output of event.outputs ?? []) {
                const variableId = data.resultVariableIds?.[output.id];
                if (!variableId) continue;
                const variable = visibleVariables.find((candidate) => candidate.id === variableId);
                if (!variable) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Event output ${output.name} references a missing result variable`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                if (!valueTypesMatch(output.valueType, variable.valueType)) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Event output ${output.name} cannot be stored in ${variable.name}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                resultVariableIds[output.id] = variableId;
              }
              const target = requireTarget(node, 'out');
              if (target && Object.keys(compiledArguments).length === event.parameters.length) {
                instructions.push({
                  id: instructionId(node.id),
                  op: 'call-event',
                  eventId: event.id,
                  arguments: compiledArguments,
                  outputs: (event.outputs ?? []).map((output) => ({
                    id: output.id,
                    name: output.name,
                    valueType: output.valueType,
                  })),
                  resultVariableIds,
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
                  compileAuthoredValue(
                    expression,
                    parameter.valueType,
                    visibleVariables,
                    source.characters,
                  ),
                );
                if (compiled && !valueTypesMatch(compiled.valueType, parameter.valueType)) {
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
                compileTextTemplate(
                  option.text,
                  choiceOptionTextId(option.id),
                  visibleVariables,
                  source.characters,
                  translationsFor(choiceOptionTextId(option.id)),
                ),
              );
              if (!text) return [];
              const visibleIf = option.visibleConditionId
                ? compileSafe(node, () =>
                    compileConditionTree(
                      { kind: 'reference', conditionId: option.visibleConditionId! },
                      source.conditions ?? [],
                      visibleVariables,
                      source.characters,
                    ),
                  )
                : option.visibleIf
                  ? compileSafe(node, () =>
                      compileExpression(option.visibleIf!, visibleVariables, source.characters),
                    )
                  : undefined;
              const enabledIf = option.enabledConditionId
                ? compileSafe(node, () =>
                    compileConditionTree(
                      { kind: 'reference', conditionId: option.enabledConditionId! },
                      source.conditions ?? [],
                      visibleVariables,
                      source.characters,
                    ),
                  )
                : option.enabledIf
                  ? compileSafe(node, () =>
                      compileExpression(option.enabledIf!, visibleVariables, source.characters),
                    )
                  : undefined;
              return [{ id: option.id, text, visibleIf, enabledIf, target }];
            });
            const prompt = data.prompt.source
              ? compileSafe(node, () =>
                  compileTextTemplate(
                    data.prompt,
                    choicePromptTextId(node.id),
                    visibleVariables,
                    source.characters,
                    translationsFor(choicePromptTextId(node.id)),
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
            const connectedCondition = connectedDataExpression(node, 'condition');
            const condition =
              connectedCondition.value ??
              (!connectedCondition.connected
                ? compileSafe(node, () =>
                    data.conditionId
                      ? compileConditionTree(
                          { kind: 'reference', conditionId: data.conditionId },
                          source.conditions ?? [],
                          visibleVariables,
                          source.characters,
                        )
                      : compileExpression(data.condition, visibleVariables, source.characters),
                  )
                : undefined);
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
            const calledChapter = data.chapterId
              ? source.chapters.find((item) => item.id === data.chapterId)
              : undefined;
            const entry = data.chapterId ? chapterEntries.get(data.chapterId) : undefined;
            const returnBlock = requireTarget(node, 'out');
            if (!calledChapter || !entry) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Call Substory does not reference an existing substory',
                sourceNodeId: node.id,
              });
            } else if (returnBlock) {
              const compiledArguments: Record<string, ReturnType<typeof compileExpression>> = {};
              for (const parameter of calledChapter.parameters) {
                const argument = (data.arguments ?? {})[parameter.variable.id];
                const connectedArgument = connectedDataExpression(
                  node,
                  `argument:${parameter.variable.id}`,
                );
                if (!argument && !connectedArgument.connected) continue;
                const compiled = connectedArgument.value ??
                  (!connectedArgument.connected && argument
                    ? compileSafe(node, () =>
                        compileAuthoredValue(
                          argument,
                          parameter.variable.valueType,
                          visibleVariables,
                          source.characters,
                        ),
                      )
                    : undefined);
                if (!compiled) continue;
                if (!valueTypesMatch(compiled.valueType, parameter.variable.valueType)) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Substory argument ${parameter.variable.name} must be ${parameter.variable.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                compiledArguments[parameter.variable.id] = compiled;
              }
              const unknownArgument = Object.keys(data.arguments ?? {}).find(
                (parameterId) =>
                  !calledChapter.parameters.some(
                    (parameter) => parameter.variable.id === parameterId,
                  ),
              );
              if (unknownArgument) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Call Substory contains missing parameter ${unknownArgument}`,
                  sourceNodeId: node.id,
                });
              }
              const resultVariableIds: Record<VariableId, VariableId> = {};
              for (const [outputId, variableId] of Object.entries(data.resultVariableIds ?? {})) {
                const output = calledChapter.outputs.find(
                  (candidate) => candidate.variable.id === outputId,
                );
                const resultVariable = visibleVariables.find(
                  (variable) => variable.id === variableId,
                );
                if (!output) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Call Substory references missing output ${outputId}`,
                    sourceNodeId: node.id,
                  });
                } else if (!resultVariable) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Substory output ${output.variable.name} references a missing variable`,
                    sourceNodeId: node.id,
                  });
                } else if (!valueTypesMatch(output.variable.valueType, resultVariable.valueType)) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Substory output ${output.variable.name} must be assigned to ${output.variable.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else resultVariableIds[output.variable.id] = resultVariable.id;
              }
              instructions.push({
                id: instructionId(node.id),
                op: 'call-chapter',
                chapterId: calledChapter.id,
                target: blockId(entry.id),
                arguments: compiledArguments,
                returnTo: { blockId: returnBlock, instructionIndex: 0 },
                resultVariableIds,
              });
            }
            break;
          }
          case StoryNodeType.StartStory:
          case StoryNodeType.SwitchStory:
          case StoryNodeType.ResumeStory:
          case StoryNodeType.EndStoryInstance: {
            const data = node.data as unknown as {
              storyId?: StartStoryNodeData['storyId'];
              instanceId?: StartStoryNodeData['instanceId'];
              arguments?: Record<VariableId, ExpressionSource>;
              resultVariableIds?: Record<string, VariableId>;
              instanceVariableId?: VariableId;
              waitForCompletion?: boolean;
            };
            const isStart = node.type === StoryNodeType.StartStory;
            const isSwitch = node.type === StoryNodeType.SwitchStory;
            const isResume = node.type === StoryNodeType.ResumeStory;
            const isEnd = node.type === StoryNodeType.EndStoryInstance;
            const storyId = !isResume && !isEnd && 'storyId' in data ? data.storyId : undefined;
            if (!isResume && !isEnd) {
              if (!storyId) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `${isStart ? 'Start' : 'Switch'} Story does not reference a Story`,
                  sourceNodeId: node.id,
                });
              } else if (
                options.availableStoryIds &&
                !options.availableStoryIds.includes(storyId)
              ) {
                diagnostics.push({
                  code: 'MISSING_STORY',
                  severity: 'error',
                  message: `Story Control references missing Story ${storyId}`,
                  sourceNodeId: node.id,
                });
              }
            }
            const instanceId = data.instanceId
              ? compileSafe(node, () =>
                  compileAuthoredValue(
                    data.instanceId!,
                    { kind: 'string' },
                    visibleVariables,
                    source.characters,
                  ),
                )
              : isResume || isEnd
                ? undefined
                : undefined;
            if ((isResume || isEnd) && !instanceId) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: `${isResume ? 'Resume' : 'End'} Story Instance requires an instance ID`,
                sourceNodeId: node.id,
              });
            }
            const argumentsSource: Record<string, ExpressionSource> =
              'arguments' in data && data.arguments ? data.arguments : {};
            const argumentsValue: Record<string, TypedExpression> = {};
            const targetVariables = storyId ? options.storyVariablesById?.[storyId] : undefined;
            const argumentIds = new Set<string>([
              ...Object.keys(argumentsSource),
              ...(targetVariables ?? []).map((v) => v.id),
            ]);
            for (const argumentId of argumentIds) {
              const expression = argumentsSource[argumentId];
              const connectedArgument = connectedDataExpression(node, `argument:${argumentId}`);
              if (!expression && !connectedArgument.connected) continue;
              const targetVariable = targetVariables?.find(
                (variable) => variable.id === argumentId,
              );
              if (targetVariables && !targetVariable) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Story Control references missing target variable ${argumentId}`,
                  sourceNodeId: node.id,
                });
                continue;
              }
              const compiled =
                connectedArgument.value ??
                (!connectedArgument.connected && expression
                  ? compileSafe(node, () =>
                      targetVariable
                        ? compileAuthoredValue(
                            expression,
                            targetVariable.valueType,
                            visibleVariables,
                            source.characters,
                          )
                        : compileExpression(expression, visibleVariables, source.characters),
                    )
                  : undefined);
              if (compiled) {
                if (
                  targetVariable &&
                  !valueTypesMatch(compiled.valueType, targetVariable.valueType)
                ) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Story Control argument ${targetVariable.name} must be ${targetVariable.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else argumentsValue[argumentId] = compiled;
              }
            }
            const resultVariableIds = data.resultVariableIds ?? {};
            const instanceVariableId = data.instanceVariableId;
            if (instanceVariableId) {
              const instanceVariable = visibleVariables.find(
                (variable) => variable.id === instanceVariableId,
              );
              if (!instanceVariable || instanceVariable.valueType.kind !== 'string') {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: 'Story Control instance variable must be an existing String variable',
                  sourceNodeId: node.id,
                });
              }
            }
            for (const variableId of Object.values(resultVariableIds)) {
              if (!visibleVariables.some((variable) => variable.id === variableId)) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Story Control result references missing variable ${variableId}`,
                  sourceNodeId: node.id,
                });
              }
            }
            if (
              (isStart || isSwitch || isResume) &&
              (isResume ? Boolean(instanceId) : Boolean(storyId))
            ) {
              const target = requireTarget(node, 'out');
              if (target) {
                instructions.push({
                  id: instructionId(node.id),
                  op: isStart ? 'start-story' : isSwitch ? 'switch-story' : 'resume-story',
                  ...(storyId ? { storyId } : {}),
                  ...(instanceId ? { instanceId } : {}),
                  arguments: argumentsValue,
                  resultVariableIds: { ...resultVariableIds },
                  ...(instanceVariableId ? { instanceVariableId } : {}),
                  waitForCompletion:
                    'waitForCompletion' in data ? (data.waitForCompletion ?? false) : false,
                } as RuntimeInstruction);
                instructions.push(jump(node, target));
              }
            } else if (isEnd && instanceId) {
              instructions.push({
                id: instructionId(node.id),
                op: 'end-story-instance',
                instanceId,
                resultVariableIds: { ...resultVariableIds },
                ...(instanceVariableId ? { instanceVariableId } : {}),
              });
              const target = resolveTarget(node.id, 'out');
              instructions.push(
                target
                  ? jump(node, target)
                  : { id: instructionId(node.id, 'end'), op: 'end-story' },
              );
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
          case StoryNodeType.Return: {
            if (!chapterId) {
              diagnostics.push({
                code: 'INVALID_NODE',
                severity: 'error',
                message: 'Return can only be used inside a substory',
                sourceNodeId: node.id,
              });
            } else {
              const data = node.data as unknown as ReturnNodeData;
              const values: Record<VariableId, ReturnType<typeof compileExpression>> = {};
              for (const output of chapter!.outputs) {
                const sourceValue = (data.values ?? {})[output.variable.id];
                const connectedValue = connectedDataExpression(node, `value:${output.variable.id}`);
                if (!sourceValue && !connectedValue.connected) {
                  diagnostics.push({
                    code: 'INVALID_NODE',
                    severity: 'error',
                    message: `Return requires output ${output.variable.name}`,
                    sourceNodeId: node.id,
                  });
                  continue;
                }
                const value = connectedValue.value ??
                  (!connectedValue.connected && sourceValue
                    ? compileSafe(node, () =>
                        compileAuthoredValue(
                          sourceValue,
                          output.variable.valueType,
                          visibleVariables,
                          source.characters,
                        ),
                      )
                    : undefined);
                if (!value) continue;
                if (!valueTypesMatch(value.valueType, output.variable.valueType)) {
                  diagnostics.push({
                    code: 'EXPRESSION_ERROR',
                    severity: 'error',
                    message: `Return output ${output.variable.name} must be ${output.variable.valueType.kind}`,
                    sourceNodeId: node.id,
                  });
                } else values[output.variable.id] = value;
              }
              const knownOutputs = new Set(chapter!.outputs.map((output) => output.variable.id));
              const unknownOutput = Object.keys(data.values ?? {}).find(
                (outputId) => !knownOutputs.has(outputId as VariableId),
              );
              if (unknownOutput) {
                diagnostics.push({
                  code: 'INVALID_NODE',
                  severity: 'error',
                  message: `Return references missing output ${unknownOutput}`,
                  sourceNodeId: node.id,
                });
              }
              instructions.push({ id: instructionId(node.id), op: 'return', values });
            }
            break;
          }
          case StoryNodeType.End:
            instructions.push({ id: instructionId(node.id), op: 'end-story' });
            break;
          case StoryNodeType.GetVariable: {
            const data = node.data as unknown as GetVariableNodeData;
            if (data.variableId && !visibleVariables.some((item) => item.id === data.variableId)) {
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
            defaultValue: stripEngineObjectTypeMarkers(parameter.variable.defaultValue),
          })),
          outputs: chapter.outputs.map((output) => ({
            variableId: output.variable.id,
            valueType: output.variable.valueType,
          })),
          localVariables: chapter.localVariables.map((variable) => ({
            ...variable,
            defaultValue: stripEngineObjectTypeMarkers(variable.defaultValue),
          })),
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
      variables: allVariables.map((variable) => ({
        ...variable,
        defaultValue: stripEngineObjectTypeMarkers(variable.defaultValue),
      })),
      sourceLocale: options.sourceLocale,
      locales:
        Object.keys(options.translations ?? {}).length > 0
          ? Object.keys(options.translations ?? {}).sort()
          : undefined,
      localeFallbacks: options.localeFallbacks,
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
