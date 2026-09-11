import { describe, expect, it } from 'vitest';
import type { AssetSource, CharacterSource, DialogueNodeData } from '@story-blueprint/common';
import {
  formatDialogueInk,
  parseDialogueInk,
} from '../packages/editor/src/renderer/dialogue/dialogueInk';

const characters: CharacterSource[] = [
  { id: 'c_alice', name: 'alice', displayName: 'Alice', emotions: {} },
  { id: 'c_bobxx', name: 'bob', displayName: 'Bob', emotions: {} },
];
const assets: AssetSource[] = [
  { id: 'a_greeting', name: 'greeting', displayName: 'Greeting', kind: 'audio' },
];

function dialogue(): DialogueNodeData {
  return {
    lines: [
      {
        id: 'ln_firstline',
        textId: 't_firstline',
        text: { source: 'Hello # there\nAgain' },
        speakerId: 'c_alice',
        tags: ['intro'],
      },
      {
        id: 'ln_secondline',
        textId: 't_secondline',
        text: { source: 'Hi' },
        speakerId: 'c_bobxx',
        voiceId: 'a_greeting',
        emotion: 'happy',
      },
    ],
  };
}

describe('Dialogue Ink profile', () => {
  it('round-trips text escapes, metadata, and ordinary Ink tags', () => {
    const data = dialogue();
    const source = formatDialogueInk(data, characters, assets);
    expect(source).toBe(
      'Alice: Hello \\# there\\nAgain # text-id:t_firstline # intro\nBob: Hi # emotion:happy # voice:greeting # text-id:t_secondline',
    );
    expect(parseDialogueInk(source, data, characters, assets).lines).toEqual(data.lines);
  });

  it('preserves stable IDs when lines are reordered or edited', () => {
    const data = dialogue();
    const reordered = parseDialogueInk(
      'Bob: Hi # emotion:happy # voice:greeting\nAlice: Hello \\# there\\nAgain # intro',
      data,
      characters,
      assets,
    ).lines!;
    expect(reordered.map((line) => line.id)).toEqual(['ln_secondline', 'ln_firstline']);

    const edited = parseDialogueInk(
      'Alice: Edited\nAlice: Hi again',
      data,
      characters,
      assets,
    ).lines!;
    expect(edited.map((line) => line.id)).toEqual(['ln_firstline', 'ln_secondline']);
    expect(edited.map((line) => line.textId)).toEqual(['t_firstline', 't_secondline']);
  });

  it('treats physical blank lines as real dialogue lines', () => {
    const data = dialogue();
    const parsed = parseDialogueInk(
      'Alice: First\nAlice: \nAlice: Third',
      data,
      characters,
      assets,
    ).lines!;
    expect(parsed.map((line) => line.text.source)).toEqual(['First', '', 'Third']);
    expect(new Set(parsed.map((line) => line.id)).size).toBe(3);
  });

  it('rejects unresolved metadata and full Ink flow control without changing lines', () => {
    const data = dialogue();
    const unresolved = parseDialogueInk('Missing: Hello', data, characters, assets);
    expect(unresolved.lines).toBeUndefined();
    expect(unresolved.diagnostics[0].message).toContain('Unknown speaker');

    const trailing = parseDialogueInk('Alice: Hello # speaker:bob', data, characters, assets);
    expect(trailing.lines).toBeUndefined();
    expect(trailing.diagnostics[0].message).toContain('not supported');

    const control = parseDialogueInk('* Choice', data, characters, assets);
    expect(control.lines).toBeUndefined();
    expect(control.diagnostics[0].message).toContain('Flow control');
  });

  it('escapes dialogue text that happens to begin like Ink control syntax', () => {
    const data = dialogue();
    data.lines = [
      {
        id: 'ln_literalstar',
        textId: 't_literalstar',
        text: { source: '* Not a choice' },
        speakerId: 'c_alice',
      },
    ];
    const source = formatDialogueInk(data, characters, assets);
    expect(source).toBe('Alice: \\* Not a choice # text-id:t_literalstar');
    expect(parseDialogueInk(source, data, characters, assets).lines).toEqual(data.lines);
  });

  it('uses Narrator as the canonical prefix when no default speaker exists', () => {
    const data = dialogue();
    data.lines = [{ id: 'ln_narration', textId: 't_narration', text: { source: 'Night falls.' } }];
    const source = formatDialogueInk(data, characters, assets);
    expect(source).toBe('Narrator: Night falls. # text-id:t_narration');
    expect(parseDialogueInk(source, data, characters, assets).lines).toEqual(data.lines);
  });

  it('accepts a stable Ink text-id tag and rejects malformed IDs', () => {
    expect(
      parseDialogueInk(
        'Alice: Imported line. # text-id:t_imported',
        { lines: [] },
        characters,
        assets,
      ).lines?.[0]?.textId,
    ).toBe('t_imported');
    expect(
      parseDialogueInk(
        'Alice: Invalid line. # text-id:not-a-stable-id',
        { lines: [] },
        characters,
        assets,
      ).diagnostics[0]?.message,
    ).toContain('Invalid text ID');
    expect(
      parseDialogueInk(
        'Alice: First. # text-id:t_shared\nBob: Second. # text-id:t_shared',
        { lines: [] },
        characters,
        assets,
      ).diagnostics.some((diagnostic) => diagnostic.message.includes('Duplicate text ID')),
    ).toBe(true);
  });
});
