import {
  createStableId,
  type AssetSource,
  type CharacterSource,
  type DialogueLine,
  type DialogueNodeData,
} from '@story-blueprint/common';

export interface DialogueInkDiagnostic {
  line: number;
  column: number;
  endColumn: number;
  message: string;
}

export interface DialogueInkParseResult {
  lines?: DialogueLine[];
  diagnostics: DialogueInkDiagnostic[];
}

type DialogueLineDraft = Omit<DialogueLine, 'id' | 'textId'>;

const CONTROL_LINE = /^\s*(?:\*|\+|->|<-|={2,})/;

function escapeText(source: string): string {
  return source
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/^(\s*)(?=\*|\+|->|<-|={2,})/, '$1\\')
    .replace(/(^|\s)#/g, '$1\\#');
}

function splitLine(source: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  let text = '';
  let tag = '';
  let readingTag = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && index + 1 < source.length) {
      const escaped = source[index + 1];
      const decoded = escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped;
      if (readingTag) tag += decoded;
      else text += decoded;
      index += 1;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(source[index - 1]))) {
      if (readingTag && tag.trim()) tags.push(tag.trim());
      readingTag = true;
      tag = '';
      continue;
    }
    if (readingTag) tag += character;
    else text += character;
  }
  if (readingTag && tag.trim()) tags.push(tag.trim());
  return { text: text.trimEnd(), tags };
}

function findNamed<T extends { name: string; displayName: string }>(
  values: readonly T[],
  name: string,
): T[] {
  const normalized = name.trim().toLocaleLowerCase();
  return values.filter(
    (value) =>
      value.name.toLocaleLowerCase() === normalized ||
      value.displayName.toLocaleLowerCase() === normalized,
  );
}

function lineSignature(line: Omit<DialogueLine, 'id' | 'textId'>): string {
  return JSON.stringify({
    text: line.text.source,
    speakerId: line.speakerId ?? null,
    voiceId: line.voiceId ?? null,
    emotion: line.emotion ?? null,
    tags: line.tags ?? [],
  });
}

export function formatDialogueInk(
  data: DialogueNodeData,
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
): string {
  const characterNames = new Map(characters.map((character) => [character.id, character.name]));
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
  return data.lines
    .map((line) => {
      const tags = [
        line.speakerId
          ? `speaker:${characterNames.get(line.speakerId) ?? line.speakerId}`
          : undefined,
        line.emotion ? `emotion:${line.emotion}` : undefined,
        line.voiceId ? `voice:${assetNames.get(line.voiceId) ?? line.voiceId}` : undefined,
        ...(line.tags ?? []).map((tag) => escapeText(tag)),
      ].filter((tag): tag is string => Boolean(tag));
      return `${escapeText(line.text.source)}${tags.map((tag) => ` # ${tag}`).join('')}`;
    })
    .join('\n');
}

function reconcileLineIds(
  drafts: DialogueLineDraft[],
  current: readonly DialogueLine[],
): DialogueLine[] {
  const queues = new Map<string, DialogueLine[]>();
  for (const line of current) {
    const signature = lineSignature(line);
    queues.set(signature, [...(queues.get(signature) ?? []), line]);
  }

  const matches = drafts.map((draft) => queues.get(lineSignature(draft))?.shift());
  const used = new Set(matches.filter(Boolean).map((line) => line!.id));
  const unmatchedDrafts = matches.flatMap((line, index) => (line ? [] : [index]));
  const unmatchedCurrent = current.filter((line) => !used.has(line.id));
  if (unmatchedDrafts.length === unmatchedCurrent.length) {
    unmatchedDrafts.forEach((draftIndex, index) => {
      matches[draftIndex] = unmatchedCurrent[index];
    });
  }

  return drafts.map((draft, index) => ({
    ...draft,
    id: matches[index]?.id ?? createStableId('line'),
    textId: matches[index]?.textId ?? createStableId('text'),
  }));
}

export function parseDialogueInk(
  source: string,
  data: DialogueNodeData,
  characters: readonly CharacterSource[],
  assets: readonly AssetSource[],
): DialogueInkParseResult {
  const diagnostics: DialogueInkDiagnostic[] = [];
  const drafts = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((sourceLine, index) => {
      const lineNumber = index + 1;
      if (CONTROL_LINE.test(sourceLine)) {
        diagnostics.push({
          line: lineNumber,
          column: 1,
          endColumn: Math.max(2, sourceLine.length + 1),
          message:
            'Flow control is not allowed in a Dialogue node. Use an Ink Block or graph nodes.',
        });
      }
      const parsed = splitLine(sourceLine);
      const draft: DialogueLineDraft = { text: { source: parsed.text } };
      const ordinaryTags: string[] = [];
      for (const tag of parsed.tags) {
        const separator = tag.indexOf(':');
        const key = separator < 0 ? tag : tag.slice(0, separator).trim().toLocaleLowerCase();
        const value = separator < 0 ? '' : tag.slice(separator + 1).trim();
        if (key === 'speaker') {
          const matches = findNamed(characters, value);
          if (matches.length !== 1) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message:
                matches.length === 0
                  ? `Unknown speaker “${value}”.`
                  : `Speaker “${value}” is ambiguous.`,
            });
          } else draft.speakerId = matches[0].id;
        } else if (key === 'voice') {
          const matches = findNamed(
            assets.filter((asset) => asset.kind === 'audio'),
            value,
          );
          if (matches.length !== 1) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message:
                matches.length === 0
                  ? `Unknown voice asset “${value}”.`
                  : `Voice asset “${value}” is ambiguous.`,
            });
          } else draft.voiceId = matches[0].id;
        } else if (key === 'emotion') {
          if (!value) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message: 'Emotion name cannot be empty.',
            });
          } else draft.emotion = value;
        } else {
          ordinaryTags.push(tag);
        }
      }
      if (ordinaryTags.length > 0) draft.tags = ordinaryTags;
      return draft;
    });

  return diagnostics.length > 0
    ? { diagnostics }
    : { diagnostics, lines: reconcileLineIds(drafts, data.lines) };
}
