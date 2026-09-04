import {
  clearEngineResourceValueReferences,
  replaceEngineResourceValueReferences,
  type EngineTypeDefinition,
} from './types/project';
import { isStableId } from './types/ids';
import type { EventSource, SignalSource, StorySourceDocument } from './types/source';
import type { RuntimeValue, ValueType, VariableDefinition } from './types/values';
import { StoryNodeType, type StoryNodeDataMap } from './types/nodes';

export interface StoryResourceReplacementContext {
  engineTypes: readonly EngineTypeDefinition[];
  projectVariables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
}

export function replaceStoryResourceReferences(
  source: StorySourceDocument,
  context: StoryResourceReplacementContext,
  kind: 'character' | 'asset',
  fromId: string,
  toId: string,
): { source: StorySourceDocument; count: number; blocked: number } {
  return transformStoryResourceReferences(source, context, kind, fromId, toId);
}

export function clearStoryResourceReferences(
  source: StorySourceDocument,
  context: StoryResourceReplacementContext,
  kind: 'character' | 'asset',
  fromId: string,
): { source: StorySourceDocument; count: number; blocked: number } {
  return transformStoryResourceReferences(source, context, kind, fromId, undefined);
}

function transformStoryResourceReferences(
  source: StorySourceDocument,
  context: StoryResourceReplacementContext,
  kind: 'character' | 'asset',
  fromId: string,
  toId: string | undefined,
): { source: StorySourceDocument; count: number; blocked: number } {
  let count = 0;
  let blocked = 0;
  const replaceTypedReference = (value: RuntimeValue, valueType: ValueType): RuntimeValue => {
    if (valueType.kind === 'character-ref' || valueType.kind === 'asset-ref') {
      if (value !== fromId) return value;
      count += 1;
      if (toId) return toId;
      if (valueType.nullable) return null;
      blocked += 1;
      return value;
    }
    if (valueType.kind === 'array' && Array.isArray(value) && valueType.elementType) {
      let changed = false;
      const next = value.map((item) => {
        const replaced = replaceTypedReference(item, valueType.elementType!);
        changed ||= replaced !== item;
        return replaced;
      });
      return changed ? next : value;
    }
    if (
      valueType.kind === 'map' &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      let changed = false;
      const nextEntries: [string, RuntimeValue][] = [];
      for (const [key, item] of Object.entries(value)) {
        let nextKey = key;
        if (
          (valueType.keyType === 'character-ref' && kind === 'character') ||
          (valueType.keyType === 'asset-ref' && kind === 'asset')
        ) {
          if (key === fromId) {
            count += 1;
            if (toId) nextKey = toId;
            else blocked += 1;
            changed ||= nextKey !== key;
          }
        }
        const replaced = valueType.valueType
          ? replaceTypedReference(item, valueType.valueType)
          : item;
        changed ||= replaced !== item;
        nextEntries.push([nextKey, replaced]);
      }
      const next = Object.fromEntries(nextEntries);
      return changed ? next : value;
    }
    return value;
  };
  const replaceValue = (value: RuntimeValue, valueType: ValueType | undefined): RuntimeValue => {
    if (!valueType) return value;
    if (
      valueType.kind === 'character-ref' ||
      valueType.kind === 'asset-ref' ||
      valueType.kind === 'array' ||
      valueType.kind === 'map'
    ) {
      const replaced = replaceTypedReference(value, valueType);
      if (replaced !== value) return replaced;
      return value;
    }
    if (valueType.kind !== 'json') return value;
    const replaced = toId
      ? replaceEngineResourceValueReferences(
          value,
          { kind: 'object', typeName: valueType.name },
          context.engineTypes,
          kind,
          fromId,
          toId,
        )
      : clearEngineResourceValueReferences(
          value,
          { kind: 'object', typeName: valueType.name },
          context.engineTypes,
          kind,
          fromId,
        );
    count += replaced.count;
    blocked += (replaced as { blocked?: number }).blocked ?? 0;
    return replaced.value;
  };
  const replaceVariable = (variable: VariableDefinition): VariableDefinition => {
    const defaultValue = replaceValue(variable.defaultValue, variable.valueType);
    return defaultValue === variable.defaultValue ? variable : { ...variable, defaultValue };
  };
  const replaceExpression = <T extends { source: string }>(
    expression: T,
    valueType: ValueType | undefined,
  ): T => {
    if (
      valueType?.kind === 'character-ref' ||
      valueType?.kind === 'asset-ref' ||
      valueType?.kind === 'array' ||
      valueType?.kind === 'map'
    ) {
      const trimmed = expression.source.trim();
      const expectedKind = valueType.kind === 'asset-ref' ? 'asset' : 'character';
      if (
        (valueType.kind === 'character-ref' || valueType.kind === 'asset-ref') &&
        isStableId(trimmed, expectedKind)
      ) {
        if (trimmed !== fromId) return expression;
        count += 1;
        if (toId) return { ...expression, source: toId };
        if (valueType.nullable) return { ...expression, source: 'null' };
        blocked += 1;
        return expression;
      }
      let value: RuntimeValue;
      try {
        value = JSON.parse(expression.source) as RuntimeValue;
      } catch {
        return expression;
      }
      const next = replaceValue(value, valueType);
      return next === value ? expression : { ...expression, source: JSON.stringify(next) };
    }
    if (valueType?.kind !== 'json') return expression;
    let value: RuntimeValue;
    try {
      value = JSON.parse(expression.source) as RuntimeValue;
    } catch {
      return expression;
    }
    const next = replaceValue(value, valueType);
    return next === value ? expression : { ...expression, source: JSON.stringify(next) };
  };
  const chapters = source.chapters.map((chapter) => ({
    ...chapter,
    parameters: chapter.parameters.map((parameter) => ({
      ...parameter,
      variable: replaceVariable(parameter.variable),
    })),
    outputs: chapter.outputs.map((output) => ({
      ...output,
      variable: replaceVariable(output.variable),
    })),
    localVariables: chapter.localVariables.map(replaceVariable),
  }));
  const replaceGraph = (
    graph: StorySourceDocument['root'],
    ownerChapter: (typeof chapters)[number] | undefined,
  ): StorySourceDocument['root'] => {
    const variables = [
      ...source.variables,
      ...context.projectVariables,
      ...(ownerChapter?.parameters.map((parameter) => parameter.variable) ?? []),
      ...(ownerChapter?.outputs.map((output) => output.variable) ?? []),
      ...(ownerChapter?.localVariables ?? []),
    ];
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.type === StoryNodeType.Dialogue) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.Dialogue];
          const lines = data.lines.map((line) => {
            if (kind === 'character' && line.speakerId === fromId) {
              count += 1;
              if (toId) return { ...line, speakerId: toId as typeof line.speakerId };
              const { speakerId: _speakerId, ...cleared } = line;
              return cleared;
            }
            if (kind === 'asset' && line.voiceId === fromId) {
              count += 1;
              if (toId) return { ...line, voiceId: toId as typeof line.voiceId };
              const { voiceId: _voiceId, ...cleared } = line;
              return cleared;
            }
            return line;
          });
          return lines === data.lines ? node : { ...node, data: { ...data, lines } };
        }
        if (node.type === StoryNodeType.Narration) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.Narration];
          if (kind !== 'asset' || data.voiceId !== fromId) return node;
          count += 1;
          if (toId) return { ...node, data: { ...data, voiceId: toId as typeof data.voiceId } };
          const { voiceId: _voiceId, ...cleared } = data;
          return { ...node, data: cleared };
        }
        if (node.type === StoryNodeType.SetVariable) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.SetVariable];
          const value = replaceExpression(
            data.value,
            variables.find((variable) => variable.id === data.variableId)?.valueType,
          );
          return value === data.value ? node : { ...node, data: { ...data, value } };
        }
        if (node.type === StoryNodeType.CallEvent) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallEvent];
          const event = context.events.find((candidate) => candidate.id === data.eventId);
          const args = Object.fromEntries(
            Object.entries(data.arguments).map(([name, expression]) => [
              name,
              replaceExpression(
                expression,
                event?.parameters.find((parameter) => parameter.name === name)?.valueType,
              ),
            ]),
          );
          return { ...node, data: { ...data, arguments: args } };
        }
        if (node.type === StoryNodeType.WaitSignal) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.WaitSignal];
          const signal = context.signals.find((candidate) => candidate.id === data.signalId);
          const matches = Object.fromEntries(
            Object.entries(data.matches).map(([name, expression]) => [
              name,
              replaceExpression(
                expression,
                signal?.parameters.find((parameter) => parameter.name === name)?.valueType,
              ),
            ]),
          );
          return { ...node, data: { ...data, matches } };
        }
        if (node.type === StoryNodeType.CallSubstory) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
          const chapter = chapters.find((candidate) => candidate.id === data.chapterId);
          const args = Object.fromEntries(
            Object.entries(data.arguments ?? {}).map(([id, expression]) => [
              id,
              replaceExpression(
                expression,
                chapter?.parameters.find((parameter) => parameter.variable.id === id)?.variable
                  .valueType,
              ),
            ]),
          );
          return { ...node, data: { ...data, arguments: args } };
        }
        if (
          node.type === StoryNodeType.StartStory ||
          node.type === StoryNodeType.SwitchStory ||
          node.type === StoryNodeType.ResumeStory ||
          node.type === StoryNodeType.EndStoryInstance
        ) {
          const data = node.data as unknown as {
            instanceId?: import('./types/expressions').ExpressionSource;
            arguments?: Readonly<Record<string, import('./types/expressions').ExpressionSource>>;
          };
          const instanceId = data.instanceId
            ? replaceExpression(data.instanceId, { kind: 'any' })
            : undefined;
          const args = Object.fromEntries(
            Object.entries(data.arguments ?? {}).map(([id, expression]) => [
              id,
              replaceExpression(expression, { kind: 'any' }),
            ]),
          );
          return { ...node, data: { ...data, instanceId, arguments: args } };
        }
        if (node.type === StoryNodeType.Return && ownerChapter) {
          const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.Return];
          const values = Object.fromEntries(
            Object.entries(data.values ?? {}).map(([id, expression]) => [
              id,
              replaceExpression(
                expression,
                ownerChapter.outputs.find((output) => output.variable.id === id)?.variable
                  .valueType,
              ),
            ]),
          );
          return { ...node, data: { ...data, values } };
        }
        return node;
      }),
    };
  };
  const variables = source.variables.map(replaceVariable);
  const characters = source.characters.map((character) => {
    let next = character;
    if (
      kind === 'character' &&
      character.relationships?.[fromId as keyof typeof character.relationships]
    ) {
      const relationships = { ...character.relationships };
      const relationship = relationships[fromId as keyof typeof relationships]!;
      delete relationships[fromId as keyof typeof relationships];
      if (toId) relationships[toId as keyof typeof relationships] = relationship;
      count += 1;
      next = { ...next, relationships };
    }
    if (kind === 'asset') {
      const defaultPortraitId =
        character.defaultPortraitId === fromId ? toId : character.defaultPortraitId;
      if (defaultPortraitId !== character.defaultPortraitId) count += 1;
      const emotions = Object.fromEntries(
        Object.entries(character.emotions).map(([name, emotion]) => {
          if (emotion.portraitId !== fromId) return [name, emotion];
          count += 1;
          if (toId) return [name, { ...emotion, portraitId: toId }];
          const { portraitId: _portraitId, ...cleared } = emotion;
          return [name, cleared];
        }),
      );
      next = {
        ...next,
        defaultPortraitId: defaultPortraitId as typeof character.defaultPortraitId,
        emotions,
      };
    }
    const fields = next.fields?.map(replaceVariable);
    return fields ? { ...next, fields } : next;
  });
  const root = replaceGraph(source.root, undefined);
  const nextChapters = chapters.map((chapter) => ({
    ...chapter,
    graph: replaceGraph(chapter.graph, chapter),
  }));
  return {
    source: { ...source, variables, characters, root, chapters: nextChapters },
    count,
    blocked,
  };
}
