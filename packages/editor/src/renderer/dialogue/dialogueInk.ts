import {
  createStableId,
  isStableId,
  type AssetSource,
  type CharacterSource,
  type DialogueLine,
  type DialogueNodeData,
  type TextId,
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

type DialogueLineDraft = Omit<DialogueLine, 'id' | 'textId'> & { textId?: TextId };

const CONTROL_LINE = /^\s*(?:\*|\+|->|<-|={2,})/;

/** Escapes text for the small, line-oriented Ink profile used by Dialogue editors. */
export function escapeDialogueInkText(source: string): string {
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

function findNamed<T extends { id?: string; name: string; displayName: string }>(
  values: readonly T[],
  name: string,
): T[] {
  const normalized = name.trim().toLocaleLowerCase();
  return values.filter(
    (value) =>
      value.id?.toLocaleLowerCase() === normalized ||
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
  const characterNames = new Map(
    characters.map((character) => {
      const duplicateDisplayName = characters.some(
        (candidate) =>
          candidate.id !== character.id &&
          candidate.displayName.toLocaleLowerCase() === character.displayName.toLocaleLowerCase(),
      );
      return [character.id, duplicateDisplayName ? character.name : character.displayName];
    }),
  );
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
  return data.lines
    .map((line) => {
      const speakerId = line.speakerId;
      const speaker = speakerId ? (characterNames.get(speakerId) ?? speakerId) : 'Narrator';
      const tags = [
        line.emotion ? `emotion:${line.emotion}` : undefined,
        line.voiceId ? `voice:${assetNames.get(line.voiceId) ?? line.voiceId}` : undefined,
        `text-id:${line.textId}`,
        ...(line.tags ?? []).map((tag) => escapeDialogueInkText(tag)),
      ].filter((tag): tag is string => Boolean(tag));
      return `${speaker}: ${escapeDialogueInkText(line.text.source)}${tags.map((tag) => ` # ${tag}`).join('')}`;
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
    textId: draft.textId ?? matches[index]?.textId ?? createStableId('text'),
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
      const speakerSeparator = parsed.text.indexOf(':');
      const speakerToken =
        speakerSeparator > 0 ? parsed.text.slice(0, speakerSeparator).trim() : undefined;
      const dialogueText =
        speakerSeparator > 0 ? parsed.text.slice(speakerSeparator + 1).replace(/^ /, '') : '';
      const draft: DialogueLineDraft = { text: { source: dialogueText } };
      if (!speakerToken) {
        diagnostics.push({
          line: lineNumber,
          column: 1,
          endColumn: Math.max(2, parsed.text.length + 1),
          message: 'Dialogue lines must begin with “Character: ” or “Narrator: ”.',
        });
      } else if (speakerToken.toLocaleLowerCase() === 'narrator') {
        // An omitted Line speaker explicitly means Narrator.
      } else {
        const matches = findNamed(characters, speakerToken);
        if (matches.length !== 1) {
          diagnostics.push({
            line: lineNumber,
            column: 1,
            endColumn: speakerSeparator + 1,
            message:
              matches.length === 0
                ? `Unknown speaker “${speakerToken}”.`
                : `Speaker “${speakerToken}” is ambiguous.`,
          });
        } else draft.speakerId = matches[0].id;
      }
      const ordinaryTags: string[] = [];
      let textIdSeen = false;
      for (const tag of parsed.tags) {
        const separator = tag.indexOf(':');
        const key = separator < 0 ? tag : tag.slice(0, separator).trim().toLocaleLowerCase();
        const value = separator < 0 ? '' : tag.slice(separator + 1).trim();
        if (key === 'speaker') {
          // Native node exports include the readable `Speaker: text` prefix and repeat the
          // stable ID in metadata so the Ink runtime can preserve the binding across renames.
          // Reject a missing or conflicting prefix instead of accepting the old tag-only form.
          if (!draft.speakerId || value !== draft.speakerId) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message:
                'Trailing # speaker tags are not supported unless they match the speaker before the text.',
            });
          }
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
        } else if (key === 'text-id') {
          if (textIdSeen) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message: 'A Dialogue line can only contain one text-id tag.',
            });
          } else if (!isStableId(value, 'text')) {
            diagnostics.push({
              line: lineNumber,
              column: Math.max(1, sourceLine.indexOf(tag) + 1),
              endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
              message: `Invalid text ID “${value}”.`,
            });
          } else {
            draft.textId = value;
            textIdSeen = true;
          }
        } else {
          ordinaryTags.push(tag);
        }
      }
      if (ordinaryTags.length > 0) draft.tags = ordinaryTags;
      return draft;
    });

  const textIds = new Map<TextId, number>();
  drafts.forEach((draft, index) => {
    if (!draft.textId) return;
    const previous = textIds.get(draft.textId);
    if (previous !== undefined) {
      diagnostics.push({
        line: index + 1,
        column: 1,
        endColumn: 2,
        message: `Duplicate text ID “${draft.textId}” (first used on line ${previous + 1}).`,
      });
      return;
    }
    textIds.set(draft.textId, index);
  });

  return diagnostics.length > 0
    ? { diagnostics }
    : { diagnostics, lines: reconcileLineIds(drafts, data.lines) };
}
