import {
  createStableId,
  type ChoiceNodeData,
  type ChoiceOption,
  type ExpressionSource,
} from '@story-blueprint/common';
import type { DialogueInkDiagnostic } from './dialogueInk';

export interface ChoiceInkParseResult {
  data?: ChoiceNodeData;
  diagnostics: DialogueInkDiagnostic[];
}

type ChoiceOptionDraft = Omit<ChoiceOption, 'id'>;

function escapeSegment(source: string): string {
  return source
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/(^|\s)#/g, '$1\\#');
}

function splitTags(source: string): { text: string; tags: string[] } {
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

function expression(source: string): ExpressionSource | undefined {
  return source ? { source, bindings: {} } : undefined;
}

function optionSignature(option: ChoiceOptionDraft): string {
  return JSON.stringify({
    text: option.text.source,
    visibleIf: option.visibleIf?.source ?? null,
    enabledIf: option.enabledIf?.source ?? null,
  });
}

function reconcileOptionIds(
  drafts: ChoiceOptionDraft[],
  current: readonly ChoiceOption[],
): ChoiceOption[] {
  const queues = new Map<string, ChoiceOption[]>();
  for (const option of current) {
    const signature = optionSignature(option);
    queues.set(signature, [...(queues.get(signature) ?? []), option]);
  }
  const matches = drafts.map((draft) => queues.get(optionSignature(draft))?.shift());
  const used = new Set(matches.filter(Boolean).map((option) => option!.id));
  matches.forEach((match, index) => {
    if (match) return;
    const samePosition = current[index];
    const fallback =
      samePosition && !used.has(samePosition.id)
        ? samePosition
        : current.find((option) => !used.has(option.id));
    if (!fallback) return;
    matches[index] = fallback;
    used.add(fallback.id);
  });
  return drafts.map((draft, index) => ({
    ...draft,
    id: matches[index]?.id ?? createStableId('option'),
  }));
}

export function formatChoiceInk(data: ChoiceNodeData): string {
  return [
    escapeSegment(data.prompt.source),
    ...data.options.map((option) => {
      const tags = [
        option.visibleIf ? `visible-if:${escapeSegment(option.visibleIf.source)}` : undefined,
        option.enabledIf ? `enabled-if:${escapeSegment(option.enabledIf.source)}` : undefined,
      ].filter((tag): tag is string => Boolean(tag));
      return `* ${escapeSegment(option.text.source)}${tags.map((tag) => ` # ${tag}`).join('')}`;
    }),
  ].join('\n');
}

export function parseChoiceInk(source: string, current: ChoiceNodeData): ChoiceInkParseResult {
  const diagnostics: DialogueInkDiagnostic[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const prompt = splitTags(lines[0] ?? '');
  if (/^\s*(?:\*|\+|->|<-|={2,})/.test(lines[0] ?? '')) {
    diagnostics.push({
      line: 1,
      column: 1,
      endColumn: Math.max(2, (lines[0]?.length ?? 0) + 1),
      message: 'The first line is the Choice prompt and cannot be an Ink control line.',
    });
  }
  if (prompt.tags.length > 0) {
    diagnostics.push({
      line: 1,
      column: Math.max(1, (lines[0]?.indexOf('#') ?? 0) + 1),
      endColumn: Math.max(2, (lines[0]?.length ?? 0) + 1),
      message: 'Choice prompt tags are not supported.',
    });
  }

  const drafts: ChoiceOptionDraft[] = [];
  lines.slice(1).forEach((sourceLine, lineIndex) => {
    const line = lineIndex + 2;
    const match = /^\s*\*\s?(.*)$/.exec(sourceLine);
    if (!match) {
      diagnostics.push({
        line,
        column: 1,
        endColumn: Math.max(2, sourceLine.length + 1),
        message: 'Choice options must begin with “* ”.',
      });
      return;
    }
    const parsed = splitTags(match[1]);
    const draft: ChoiceOptionDraft = { text: { source: parsed.text } };
    for (const tag of parsed.tags) {
      const separator = tag.indexOf(':');
      const key = separator < 0 ? tag : tag.slice(0, separator).trim().toLocaleLowerCase();
      const value = separator < 0 ? '' : tag.slice(separator + 1).trim();
      if (key === 'visible-if') draft.visibleIf = expression(value);
      else if (key === 'enabled-if') draft.enabledIf = expression(value);
      else {
        diagnostics.push({
          line,
          column: Math.max(1, sourceLine.indexOf(tag) + 1),
          endColumn: Math.max(2, sourceLine.indexOf(tag) + tag.length + 1),
          message: `Unknown Choice option tag “${key}”.`,
        });
      }
    }
    drafts.push(draft);
  });
  if (drafts.length === 0) {
    diagnostics.push({
      line: Math.max(1, lines.length),
      column: 1,
      endColumn: 2,
      message: 'A Choice node must contain at least one option.',
    });
  }

  return diagnostics.length > 0
    ? { diagnostics }
    : {
        diagnostics,
        data: {
          prompt: { source: prompt.text },
          options: reconcileOptionIds(drafts, current.options),
        },
      };
}
