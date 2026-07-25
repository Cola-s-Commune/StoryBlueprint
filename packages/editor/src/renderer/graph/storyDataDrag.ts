import type { AssetId, CharacterId, VariableId } from '@story-blueprint/common';

export const storyDataMime = 'application/x-story-blueprint-data';

export type StoryDataDragPayload =
  | { kind: 'variable'; id: VariableId; action: 'get' | 'set' }
  | { kind: 'character'; id: CharacterId }
  | { kind: 'asset'; id: AssetId };

export function writeStoryDataDrag(event: React.DragEvent, payload: StoryDataDragPayload) {
  event.dataTransfer.setData(storyDataMime, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'copy';
}

export function readStoryDataDrag(dataTransfer: DataTransfer): StoryDataDragPayload | undefined {
  const raw = dataTransfer.getData(storyDataMime);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoryDataDragPayload>;
    if ((value.kind === 'character' || value.kind === 'asset') && typeof value.id === 'string') {
      return value as StoryDataDragPayload;
    }
    if (
      value.kind === 'variable' &&
      typeof value.id === 'string' &&
      (value.action === 'get' || value.action === 'set')
    ) {
      return value as StoryDataDragPayload;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
