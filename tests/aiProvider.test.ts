import { describe, expect, it } from 'vitest';
import {
  extractAIResponseContent,
  resolveAICompletionsUrl,
} from '../packages/editor/src/shared/aiProvider';

describe('OpenAI-compatible provider helpers', () => {
  it('normalizes base and complete chat completion endpoints', () => {
    expect(resolveAICompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(resolveAICompletionsUrl('https://example.com/chat/completions')).toBe(
      'https://example.com/chat/completions',
    );
    expect(resolveAICompletionsUrl('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
  });

  it('rejects insecure remote endpoints and URL credentials', () => {
    expect(() => resolveAICompletionsUrl('http://example.com/v1')).toThrow(/HTTPS/);
    expect(() => resolveAICompletionsUrl('https://user:secret@example.com/v1')).toThrow(
      /credentials/,
    );
  });

  it('extracts string and text-part responses', () => {
    expect(
      extractAIResponseContent({
        model: 'model-a',
        choices: [{ message: { content: '{"operations":[]}' } }],
      }),
    ).toEqual({ content: '{"operations":[]}', model: 'model-a' });
    expect(
      extractAIResponseContent({
        choices: [{ message: { content: [{ text: '{"a":' }, { text: '1}' }] } }],
      }).content,
    ).toBe('{"a":1}');
  });

  it('rejects empty provider responses', () => {
    expect(() => extractAIResponseContent({ choices: [] })).toThrow(/choices/);
    expect(() => extractAIResponseContent({ choices: [{ message: { content: '' } }] })).toThrow(
      /empty/,
    );
  });
});
