import { StoryNodeType } from '@story-blueprint/common';

export function relativeVariableOverwriteOperations(command: unknown, request: string): string[] {
  const requestsRelativeChange =
    /(?:增加|加上|加\s*\d|提高|提升|减少|减去|降低|递增|递减|increment|decrement|increase|decrease|add\s+\d|subtract)/iu.test(
      request,
    );
  if (!requestsRelativeChange || typeof command !== 'object' || command === null) return [];
  const operations = (command as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((operation, index) => {
    if (typeof operation !== 'object' || operation === null) return [];
    const raw = operation as Record<string, unknown>;
    const operationId = typeof raw.operationId === 'string' ? raw.operationId : `#${index + 1}`;
    if (raw.kind === 'set-expression') {
      const target = raw.target as Record<string, unknown> | undefined;
      if (
        target?.kind === 'set-variable-value' &&
        typeof raw.source === 'string' &&
        /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.source.trim())
      ) {
        return [operationId];
      }
    }
    if (raw.kind !== 'add-node') return [];
    const node = raw.node as Record<string, unknown> | undefined;
    if (node?.type !== StoryNodeType.SetVariable) return [];
    const data = node.data as Record<string, unknown> | undefined;
    const value = data?.value as Record<string, unknown> | undefined;
    return typeof value?.source === 'string' &&
      /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.source.trim())
      ? [operationId]
      : [];
  });
}
