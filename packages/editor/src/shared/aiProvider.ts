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
  finishReason?: string;
  error?: string;
}

/** Extracts the useful delta fields from one OpenAI-compatible SSE payload. */
export function parseOpenAIStreamDelta(value: unknown): OpenAIStreamDelta | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const response = value as { model?: unknown; choices?: unknown; error?: unknown };
  if ('error' in response && response.error) {
    if (typeof response.error === 'string') {
      return { error: response.error };
    }
    if (typeof response.error === 'object' && response.error !== null) {
      const err = response.error as { message?: unknown; code?: unknown };
      const errMsg = typeof err.message === 'string' ? err.message : JSON.stringify(response.error);
      return { error: errMsg };
    }
  }
  const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
  if (typeof choice !== 'object' || choice === null) return undefined;
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  const delta = (choice as { delta?: unknown }).delta;
  if (typeof delta !== 'object' || delta === null) {
    if (finishReason) return { finishReason };
    return undefined;
  }
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
  if (!model && !reasoning && !content && !finishReason) return undefined;
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(content ? { content } : {}),
    ...(finishReason ? { finishReason } : {}),
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

interface ParsedJSONResult {
  value: unknown;
  repaired: boolean;
  surroundingText?: string;
}

function parseJSONResponse(content: string): ParsedJSONResult {
  const trimmed = content.trim();

  // 1. Direct parse if whole string is valid JSON
  try {
    return { value: JSON.parse(trimmed) as unknown, repaired: false };
  } catch {
    // Continue
  }

  // 2. Fenced code block check: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    const candidate = fenceMatch[1].trim();
    const preamble = trimmed.slice(0, fenceMatch.index).trim();
    const postamble = trimmed.slice(fenceMatch.index! + fenceMatch[0].length).trim();
    const surroundingText = [preamble, postamble].filter(Boolean).join('\n\n') || undefined;

    try {
      return { value: JSON.parse(candidate) as unknown, repaired: false, surroundingText };
    } catch {
      const repaired = repairUnescapedStringQuotes(candidate);
      try {
        return { value: JSON.parse(repaired) as unknown, repaired: true, surroundingText };
      } catch {
        // Fall through to boundary extraction
      }
    }
  }

  // 3. Balanced { ... } extraction
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    const rawBefore = trimmed.slice(0, start).replace(/```(?:json)?\s*$/i, '').trim();
    const rawAfter = trimmed.slice(end + 1).replace(/^\s*```/i, '').trim();
    const surroundingText = [rawBefore, rawAfter].filter(Boolean).join('\n\n') || undefined;

    try {
      return { value: JSON.parse(candidate) as unknown, repaired: false, surroundingText };
    } catch {
      const repaired = repairUnescapedStringQuotes(candidate);
      try {
        return { value: JSON.parse(repaired) as unknown, repaired: repaired !== candidate, surroundingText };
      } catch {
        // Fall through
      }
    }
  }

  // 4. Try unescaped string quote repair on entire trimmed string
  const repaired = repairUnescapedStringQuotes(trimmed);
  if (repaired !== trimmed) {
    try {
      return { value: JSON.parse(repaired) as unknown, repaired: true };
    } catch {
      // Fall through
    }
  }

  throw new Error('AI response is not valid JSON');
}

export function parseAIAssistantResponse(content: string, baseRevision?: string): AIAssistantResponse {
  let parsed: ParsedJSONResult;
  try {
    parsed = parseJSONResponse(content);
  } catch {
    const reply = content.trim();
    if (!reply) throw new Error('AI response content is empty');
    return { reply, unstructured: true };
  }
  const { value, surroundingText } = parsed;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const reply = surroundingText || content.trim();
    return { reply, unstructured: true };
  }
  const object = value as Record<string, unknown>;

  // Extract command (if present)
  let command: unknown = undefined;
  if (object.format === 'story-blueprint-commands') {
    command = value;
  } else if (object.command !== undefined && object.command !== null) {
    if (typeof object.command === 'object' && !Array.isArray(object.command)) {
      const cmdObj = object.command as Record<string, unknown>;
      if (Array.isArray(cmdObj.operations) && cmdObj.format !== 'story-blueprint-commands') {
        command = {
          format: BLUEPRINT_COMMAND_FORMAT,
          version: BLUEPRINT_COMMAND_VERSION,
          baseRevision: typeof cmdObj.baseRevision === 'string' ? cmdObj.baseRevision : (baseRevision ?? ''),
          ...cmdObj,
        };
      } else {
        command = object.command;
      }
    } else {
      throw new Error('AI response command must be an object or null');
    }
  } else if (Array.isArray(object.operations)) {
    if (object.format === 'story-blueprint-commands') {
      command = object;
    } else {
      command = {
        ...object,
        format: BLUEPRINT_COMMAND_FORMAT,
        version: BLUEPRINT_COMMAND_VERSION,
        baseRevision: typeof object.baseRevision === 'string' ? object.baseRevision : (baseRevision ?? ''),
        operations: object.operations,
      };
    }
  } else if (typeof object.kind === 'string' && object.kind.length > 0) {
    command = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: baseRevision ?? '',
      operations: [value],
    };
  }

  // Extract or synthesize user-facing reply
  const candidateReplyKeys = [
    'reply',
    'message',
    'response',
    'content',
    'text',
    'explanation',
    'description',
    'summary',
    'answer',
  ] as const;

  let reply: string | undefined;
  for (const key of candidateReplyKeys) {
    const val = object[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      reply = val.trim();
      break;
    }
  }

  // If no explicit reply field in JSON, prefer surrounding conversational text emitted by the model
  if (!reply && surroundingText && surroundingText.length > 0) {
    reply = surroundingText;
  }

  // For exact legacy compatibility when format or single kind is returned without reply
  if (!reply && (object.format === 'story-blueprint-commands' || typeof object.kind === 'string')) {
    reply = 'I prepared a Blueprint change for review.';
  }

  // If still no reply and we have a valid command, generate a helpful default reply rather than crashing
  if (!reply && command) {
    const rawOps =
      typeof command === 'object' && command !== null
        ? (command as Record<string, unknown>).operations
        : undefined;
    const opCount = Array.isArray(rawOps) ? rawOps.length : 0;
    reply = opCount > 0
      ? `已为您生成蓝图操作方案（包含 ${opCount} 项变更），请在下方预览并确认应用。`
      : '已为您生成蓝图操作方案供预览与应用。';
  }

  // If still no reply, look for any other string property in the object
  if (!reply) {
    const ignoredKeys = new Set(['format', 'version', 'kind', 'baseRevision', 'type', 'id', 'status']);
    for (const [k, v] of Object.entries(object)) {
      if (!ignoredKeys.has(k) && typeof v === 'string' && v.trim().length > 0) {
        reply = v.trim();
        break;
      }
    }
  }

  // Ultimate fallback to ensure conversation turn is NEVER lost with a crash
  if (!reply) {
    reply = '已完成请求处理。';
  }

  return {
    reply,
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
