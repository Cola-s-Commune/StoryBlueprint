import { isStableId } from './types/ids';
import type { AssetId, CharacterId, TextId } from './types/ids';

export interface InkDialogueMetadata {
  speakerId?: CharacterId;
  voiceId?: AssetId;
  emotion?: string;
  textId?: TextId;
  tags: readonly string[];
  errors: readonly string[];
}

const reservedTags = new Set(['speaker', 'voice', 'emotion', 'text-id']);

export function parseInkDialogueMetadata(tags: readonly string[]): InkDialogueMetadata {
  const metadata: {
    speakerId?: CharacterId;
    voiceId?: AssetId;
    emotion?: string;
    textId?: TextId;
  } = {};
  const ordinary: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    const separator = tag.indexOf(':');
    const key = separator >= 0 ? tag.slice(0, separator).trim().toLowerCase() : '';
    if (!reservedTags.has(key)) {
      if (tag) ordinary.push(tag);
      continue;
    }
    const value = tag.slice(separator + 1).trim();
    if (seen.has(key)) {
      errors.push(`Duplicate Ink # ${key} tag`);
      continue;
    }
    seen.add(key);
    if (!value) {
      errors.push(`Ink # ${key} tag requires a value`);
      continue;
    }
    if (key === 'speaker') {
      if (!isStableId(value, 'character')) errors.push(`Invalid Ink speaker ID ${value}`);
      else metadata.speakerId = value;
    } else if (key === 'voice') {
      if (!isStableId(value, 'asset')) errors.push(`Invalid Ink voice asset ID ${value}`);
      else metadata.voiceId = value;
    } else if (key === 'text-id') {
      if (!isStableId(value, 'text')) errors.push(`Invalid Ink text ID ${value}`);
      else metadata.textId = value;
    } else {
      metadata.emotion = value;
    }
  }
  return { ...metadata, tags: ordinary, errors };
}

export function collectInkReservedTagGroups(source: string): readonly (readonly string[])[] {
  const groups: string[][] = [];
  for (const line of source.split(/\r?\n/)) {
    const tags: string[] = [];
    for (const match of line.matchAll(
      /(?:^|\s)#\s*((?:speaker|voice|emotion|text-id)\s*:[^#\r\n]*)/gi,
    )) {
      tags.push(match[1]!.trim());
    }
    if (tags.length > 0) groups.push(tags);
  }
  return groups;
}
