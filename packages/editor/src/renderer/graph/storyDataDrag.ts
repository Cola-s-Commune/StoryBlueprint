import type { AssetId, CharacterId, EventId, SignalId, VariableId } from '@story-blueprint/common';

export const storyDataMime = 'application/x-story-blueprint-data';

export type StoryDataDragPayload =
  | { kind: 'variable'; id: VariableId; action: 'get' | 'set' }
  | { kind: 'character'; id: CharacterId }
  | { kind: 'asset'; id: AssetId }
  | { kind: 'event'; id: EventId }
  | { kind: 'signal'; id: SignalId };

export function writeStoryDataDrag(event: React.DragEvent, payload: StoryDataDragPayload) {
  event.dataTransfer.setData(storyDataMime, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'copy';
}

export function readStoryDataDrag(dataTransfer: DataTransfer): StoryDataDragPayload | undefined {
  const raw = dataTransfer.getData(storyDataMime);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoryDataDragPayload>;
    if (
      (value.kind === 'character' ||
        value.kind === 'asset' ||
        value.kind === 'event' ||
        value.kind === 'signal') &&
      typeof value.id === 'string'
    ) {
      return value as StoryDataDragPayload;
    }
    if (
      value.kind === 'variable' &&
      typeof value.id === 'string' &&
      (value.action === 'get' || value.action === 'set' || value.action === undefined)
    ) {
      return {
        ...value,
        action: value.action ?? 'set',
      } as StoryDataDragPayload;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
