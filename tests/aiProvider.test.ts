import { describe, expect, it } from 'vitest';
import {
  extractAIResponseContent,
  normalizeAIBlueprintCommand,
  parseOpenAIStreamDelta,
  parseAIAssistantResponse,
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

  it('extracts provider-supplied reasoning when present', () => {
    expect(
      extractAIResponseContent({
        model: 'deepseek-v4-pro',
        choices: [
          {
            message: {
              reasoning_content: 'I should reconnect the existing successor.',
              content: '{"operations":[]}',
            },
          },
        ],
      }),
    ).toEqual({
      content: '{"operations":[]}',
      model: 'deepseek-v4-pro',
      reasoning: 'I should reconnect the existing successor.',
    });
  });

  it('extracts reasoning and content deltas from OpenAI-compatible streaming chunks', () => {
    expect(
      parseOpenAIStreamDelta({
        model: 'deepseek-reasoner',
        choices: [{ delta: { reasoning_content: 'Checking links…' } }],
      }),
    ).toEqual({ model: 'deepseek-reasoner', reasoning: 'Checking links…' });
    expect(
      parseOpenAIStreamDelta({ choices: [{ delta: { content: [{ text: '{"reply":' }] } }] }),
    ).toEqual({ content: '{"reply":' });
  });

  it('rejects empty provider responses', () => {
    expect(() => extractAIResponseContent({ choices: [] })).toThrow(/choices/);
    expect(() => extractAIResponseContent({ choices: [{ message: { content: '' } }] })).toThrow(
      /empty/,
    );
  });

  it('parses conversational replies with optional commands', () => {
    expect(
      parseAIAssistantResponse('{"reply":"The current branch has two endings.","command":null}'),
    ).toEqual({ reply: 'The current branch has two endings.' });
    expect(
      parseAIAssistantResponse(
        '{"reply":"I added a line.","command":{"format":"story-blueprint-commands","operations":[]}}',
      ),
    ).toEqual({
      reply: 'I added a line.',
      command: { format: 'story-blueprint-commands', operations: [] },
    });
  });

  it('accepts legacy direct command responses as a fallback', () => {
    expect(
      parseAIAssistantResponse('{"format":"story-blueprint-commands","operations":[]}'),
    ).toEqual({
      reply: 'I prepared a Blueprint change for review.',
      command: { format: 'story-blueprint-commands', operations: [] },
    });
  });

  it('accepts fenced JSON and wraps a bare Blueprint operation for review', () => {
    expect(
      parseAIAssistantResponse(
        '```json\n{"kind":"add-node","graph":{"kind":"root"},"node":{"id":"n_one","type":"dialogue","data":{"lines":[]}}}\n```',
        'rev_current',
      ),
    ).toEqual({
      reply: 'I prepared a Blueprint change for review.',
      command: {
        format: 'story-blueprint-commands',
        version: 1,
        baseRevision: 'rev_current',
        operations: [
          {
            kind: 'add-node',
            graph: { kind: 'root' },
            node: { id: 'n_one', type: 'dialogue', data: { lines: [] } },
          },
        ],
      },
    });
  });

  it('keeps a non-JSON provider reply visible instead of losing the entire turn', () => {
    expect(parseAIAssistantResponse('I can see the attached file and will use it.')).toEqual({
      reply: 'I can see the attached file and will use it.',
      unstructured: true,
    });
  });

  it('preserves explicit clarification state without creating a command', () => {
    expect(
      parseAIAssistantResponse(
        '{"reply":"I need to know who speaks this line.","command":null,"needsClarification":true,"questions":["Who is speaking?"]}',
      ),
    ).toEqual({
      reply: 'I need to know who speaks this line.',
      needsClarification: true,
      questions: ['Who is speaking?'],
    });
  });

  it('preserves a read-only context tool request', () => {
    expect(
      parseAIAssistantResponse(
        '{"reply":"I need the node details.","command":null,"toolRequest":{"name":"story.get_nodes","arguments":{"ids":["n_one"]}}}',
      ),
    ).toEqual({
      reply: 'I need the node details.',
      toolRequest: { name: 'story.get_nodes', arguments: { ids: ['n_one'] } },
    });
  });

  it('repairs an unescaped quote inside a narrative text value', () => {
    const response = parseAIAssistantResponse(
      '{"reply":"I prepared a change.","command":{"format":"story-blueprint-commands","version":1,"baseRevision":"rev_current","operations":[{"kind":"add-dialogue-line","graph":{"kind":"root"},"nodeId":"n_one","line":{"id":"ln_one","text":"他说 "你好" 然后离开了。"}}]}}',
      'rev_current',
    );
    expect(response.jsonRepaired).toBe(true);
    expect(response.command).toMatchObject({
      operations: [{ line: { text: '他说 "你好" 然后离开了。' } }],
    });
  });

  it('normalizes Source-shaped text in compact line and option commands', () => {
    expect(
      normalizeAIBlueprintCommand({
        format: 'story-blueprint-commands',
        operations: [
          {
            kind: 'add-dialogue-line',
            line: { id: 'ln_one', textId: 't_one', text: { source: 'Rob the vault.' } },
          },
          { kind: 'update-dialogue-line', patch: { text: { source: 'Leave quietly.' } } },
          { kind: 'add-choice-option', option: { id: 'o_one', text: { source: 'Run' } } },
          { kind: 'update-choice-option', patch: { text: { source: 'Hide' } } },
          {
            kind: 'add-node',
            node: {
              type: 'dialogue',
              data: { lines: [{ text: { source: 'This shape must remain.' } }] },
            },
          },
        ],
      }),
    ).toMatchObject({
      operations: [
        { line: { text: 'Rob the vault.' } },
        { patch: { text: 'Leave quietly.' } },
        { option: { text: 'Run' } },
        { patch: { text: 'Hide' } },
        { node: { data: { lines: [{ text: { source: 'This shape must remain.' } }] } } },
      ],
    });
  });
});
