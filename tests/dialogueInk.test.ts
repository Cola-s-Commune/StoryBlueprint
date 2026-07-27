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
    speakerId: 'c_alice',
    lines: [
      {
        id: 'ln_firstline',
        textId: 't_firstline',
        text: { source: 'Hello # there\nAgain' },
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
      'Hello \\# there\\nAgain # intro\nHi # speaker:bob # emotion:happy # voice:greeting',
    );
    expect(parseDialogueInk(source, data, characters, assets).lines).toEqual(data.lines);
  });

  it('preserves stable IDs when lines are reordered or edited', () => {
    const data = dialogue();
    const reordered = parseDialogueInk(
      'Hi # speaker:bob # emotion:happy # voice:greeting\nHello \\# there\\nAgain # intro',
      data,
      characters,
      assets,
    ).lines!;
    expect(reordered.map((line) => line.id)).toEqual(['ln_secondline', 'ln_firstline']);

    const edited = parseDialogueInk('Edited\nHi again', data, characters, assets).lines!;
    expect(edited.map((line) => line.id)).toEqual(['ln_firstline', 'ln_secondline']);
    expect(edited.map((line) => line.textId)).toEqual(['t_firstline', 't_secondline']);
  });

  it('treats physical blank lines as real dialogue lines', () => {
    const data = dialogue();
    const parsed = parseDialogueInk('First\n\nThird', data, characters, assets).lines!;
    expect(parsed.map((line) => line.text.source)).toEqual(['First', '', 'Third']);
    expect(new Set(parsed.map((line) => line.id)).size).toBe(3);
  });

  it('rejects unresolved metadata and full Ink flow control without changing lines', () => {
    const data = dialogue();
    const unresolved = parseDialogueInk('Hello # speaker:missing', data, characters, assets);
    expect(unresolved.lines).toBeUndefined();
    expect(unresolved.diagnostics[0].message).toContain('Unknown speaker');

    const control = parseDialogueInk('* Choice', data, characters, assets);
    expect(control.lines).toBeUndefined();
    expect(control.diagnostics[0].message).toContain('Flow control');
  });

  it('escapes dialogue text that happens to begin like Ink control syntax', () => {
    const data = dialogue();
    data.lines = [
      { id: 'ln_literalstar', textId: 't_literalstar', text: { source: '* Not a choice' } },
    ];
    const source = formatDialogueInk(data, characters, assets);
    expect(source).toBe('\\* Not a choice');
    expect(parseDialogueInk(source, data, characters, assets).lines).toEqual(data.lines);
  });
});
