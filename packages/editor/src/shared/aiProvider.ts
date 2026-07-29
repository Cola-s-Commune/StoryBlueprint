const LOCAL_AI_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

export function extractAIResponseContent(value: unknown): { content: string; model: string } {
  if (typeof value !== 'object' || value === null) throw new Error('AI response is not an object');
  const response = value as { model?: unknown; choices?: unknown };
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new Error('AI response does not contain choices');
  }
  const first = response.choices[0] as { message?: { content?: unknown } };
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
  return { content, model: typeof response.model === 'string' ? response.model : '' };
}
