const LOCAL_AI_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface AIAssistantResponse {
  reply: string;
  command?: unknown;
  needsClarification?: boolean;
  questions?: string[];
  toolRequest?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  /** The provider returned conversational text instead of the requested JSON envelope. */
  unstructured?: boolean;
  /** A malformed quote inside a JSON string was conservatively escaped before parsing. */
  jsonRepaired?: boolean;
}

export interface OpenAIStreamDelta {
  model?: string;
  reasoning?: string;
  content?: string;
}

/** Extracts the useful delta fields from one OpenAI-compatible SSE payload. */
export function parseOpenAIStreamDelta(value: unknown): OpenAIStreamDelta | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const response = value as { model?: unknown; choices?: unknown };
  const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
  if (typeof choice !== 'object' || choice === null) return undefined;
  const delta = (choice as { delta?: unknown }).delta;
  if (typeof delta !== 'object' || delta === null) return undefined;
  const fields = delta as Record<string, unknown>;
  const reasoningValue = fields.reasoning_content ?? fields.reasoning;
  const reasoning = typeof reasoningValue === 'string' ? reasoningValue : '';
  const rawContent = fields.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '',
            )
            .join('')
        : '';
  const model = typeof response.model === 'string' ? response.model : '';
  if (!model && !reasoning && !content) return undefined;
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(content ? { content } : {}),
  };
}

export function resolveAICompletionsUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('AI Endpoint must be a valid URL');
  }
  const localHost = LOCAL_AI_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('AI Endpoint must use HTTPS; HTTP is allowed only for a local provider');
  }
  if (url.username || url.password) throw new Error('AI Endpoint must not contain credentials');
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/chat/completions') ? pathname : `${pathname}/chat/completions`;
  return url.toString();
}

export function extractAIResponseContent(value: unknown): {
  content: string;
  model: string;
  reasoning?: string;
} {
  if (typeof value !== 'object' || value === null) throw new Error('AI response is not an object');
  const response = value as { model?: unknown; choices?: unknown };
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new Error('AI response does not contain choices');
  }
  const first = response.choices[0] as {
    message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
  };
  const raw = first?.message?.content;
  const content =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((part) =>
              typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '',
            )
            .join('')
        : '';
  if (!content.trim()) throw new Error('AI response content is empty');
  const rawReasoning = first?.message?.reasoning_content ?? first?.message?.reasoning;
  const reasoning = typeof rawReasoning === 'string' ? rawReasoning.trim() : '';
  return {
    content,
    model: typeof response.model === 'string' ? response.model : '',
    ...(reasoning ? { reasoning } : {}),
  };
}

function repairUnescapedStringQuotes(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      result += character;
      escaped = true;
      continue;
    }
    if (character !== '"') {
      result += character;
      continue;
    }
    const following = content.slice(index + 1).match(/^\s*(.)/)?.[1];
    // A JSON string closes only before a structural delimiter. Other quotes
    // are almost certainly dialogue punctuation emitted without JSON escaping.
    if (following && ![':', ',', '}', ']'].includes(following)) {
      result += '\\"';
      continue;
    }
    result += character;
    inString = false;
  }
  return result;
}

function parseJSONResponse(content: string): { value: unknown; repaired: boolean } {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return { value: JSON.parse(withoutFence) as unknown, repaired: false };
  } catch {
    // Providers occasionally add a short preamble before a JSON object. Only
    // use the first balanced object when it can be parsed completely.
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { value: JSON.parse(withoutFence.slice(start, end + 1)) as unknown, repaired: false };
      } catch {
        const repaired = repairUnescapedStringQuotes(withoutFence.slice(start, end + 1));
        try {
          return { value: JSON.parse(repaired) as unknown, repaired: repaired !== withoutFence };
        } catch {
          // Fall through to the stable user-facing parse error below.
        }
      }
    }
    const repaired = repairUnescapedStringQuotes(withoutFence);
    if (repaired !== withoutFence) {
      try {
        return { value: JSON.parse(repaired) as unknown, repaired: true };
      } catch {
        // Fall through to the stable user-facing parse error below.
      }
    }
    throw new Error('AI response is not valid JSON');
  }
}

export function parseAIAssistantResponse(content: string, baseRevision?: string): AIAssistantResponse {
  let parsed: { value: unknown; repaired: boolean };
  try {
    parsed = parseJSONResponse(content);
  } catch {
    const reply = content.trim();
    if (!reply) throw new Error('AI response content is empty');
    return { reply, unstructured: true };
  }
  const { value } = parsed;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AI response must be an object');
  }
  const object = value as Record<string, unknown>;
  if (object.format === 'story-blueprint-commands') {
    return {
      reply: 'I prepared a Blueprint change for review.',
      command: value,
      ...(parsed.repaired ? { jsonRepaired: true } : {}),
    };
  }
  if (baseRevision && typeof baseRevision === 'string') {
    const operation = object.kind;
    if (typeof operation === 'string' && operation.length > 0) {
      return {
        reply: 'I prepared a Blueprint change for review.',
        command: {
          format: BLUEPRINT_COMMAND_FORMAT,
          version: BLUEPRINT_COMMAND_VERSION,
          baseRevision,
          operations: [value],
        },
        ...(parsed.repaired ? { jsonRepaired: true } : {}),
      };
    }
    if (Array.isArray(object.operations)) {
      return {
        reply: 'I prepared a Blueprint change for review.',
        command: {
          ...object,
          format: BLUEPRINT_COMMAND_FORMAT,
          version: BLUEPRINT_COMMAND_VERSION,
          baseRevision: typeof object.baseRevision === 'string' ? object.baseRevision : baseRevision,
        },
        ...(parsed.repaired ? { jsonRepaired: true } : {}),
      };
    }
  }
  if (typeof object.reply !== 'string' || !object.reply.trim()) {
    throw new Error('AI response does not contain a user-facing reply');
  }
  const command = object.command;
  if (command !== undefined && command !== null && typeof command !== 'object') {
    throw new Error('AI response command must be an object or null');
  }
  return {
    reply: object.reply.trim(),
    ...(command !== undefined && command !== null ? { command } : {}),
    ...(object.needsClarification === true ? { needsClarification: true } : {}),
    ...(Array.isArray(object.questions)
      ? {
          questions: object.questions.filter((question): question is string => typeof question === 'string' && question.trim().length > 0),
        }
      : {}),
    ...(object.toolRequest && typeof object.toolRequest === 'object' && !Array.isArray(object.toolRequest)
      ? {
          toolRequest: {
            name: typeof (object.toolRequest as Record<string, unknown>).name === 'string'
              ? (object.toolRequest as Record<string, unknown>).name as string
              : '',
            arguments:
              typeof (object.toolRequest as Record<string, unknown>).arguments === 'object' &&
              (object.toolRequest as Record<string, unknown>).arguments !== null &&
              !Array.isArray((object.toolRequest as Record<string, unknown>).arguments)
                ? ((object.toolRequest as Record<string, unknown>).arguments as Record<string, unknown>)
                : {},
          },
        }
      : {}),
    ...(parsed.repaired ? { jsonRepaired: true } : {}),
  };
}

function sourceString(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = (value as Record<string, unknown>).source;
  return typeof source === 'string' ? source : undefined;
}

/** Repairs the common AI mix-up between Source node data and compact command text fields. */
export function normalizeAIBlueprintCommand(command: unknown): unknown {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) return command;
  const normalized = structuredClone(command) as Record<string, unknown>;
  if (!Array.isArray(normalized.operations)) return normalized;
  for (const value of normalized.operations) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const operation = value as Record<string, unknown>;
    if (operation.kind === 'add-dialogue-line') {
      const line = operation.line;
      if (typeof line === 'object' && line !== null && !Array.isArray(line)) {
        const text = sourceString((line as Record<string, unknown>).text);
        if (text !== undefined) (line as Record<string, unknown>).text = text;
      }
    } else if (operation.kind === 'update-dialogue-line') {
      const patch = operation.patch;
      if (typeof patch === 'object' && patch !== null && !Array.isArray(patch)) {
        const text = sourceString((patch as Record<string, unknown>).text);
        if (text !== undefined) (patch as Record<string, unknown>).text = text;
      }
    } else if (operation.kind === 'add-choice-option') {
      const option = operation.option;
      if (typeof option === 'object' && option !== null && !Array.isArray(option)) {
        const text = sourceString((option as Record<string, unknown>).text);
        if (text !== undefined) (option as Record<string, unknown>).text = text;
      }
    } else if (operation.kind === 'update-choice-option') {
      const patch = operation.patch;
      if (typeof patch === 'object' && patch !== null && !Array.isArray(patch)) {
        const text = sourceString((patch as Record<string, unknown>).text);
        if (text !== undefined) (patch as Record<string, unknown>).text = text;
      }
    }
  }
  return normalized;
}
import { BLUEPRINT_COMMAND_FORMAT, BLUEPRINT_COMMAND_VERSION } from '@story-blueprint/common';
