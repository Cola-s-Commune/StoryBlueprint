import type { ChoiceNodeData } from '@story-blueprint/common';
import { describe, expect, it } from 'vitest';
import {
  formatChoiceInk,
  parseChoiceInk,
} from '../packages/editor/src/renderer/dialogue/choiceInk';

const data: ChoiceNodeData = {
  prompt: { source: 'What will you do?' },
  options: [
    { id: 'o_plan_a', text: { source: 'Plan A' } },
    {
      id: 'o_plan_b',
      text: { source: 'Plan B' },
      visibleIf: { source: 'hasMap', bindings: {} },
      enabledIf: { source: 'energy > 0', bindings: {} },
    },
  ],
};

describe('Choice Ink editing', () => {
  it('round-trips prompt, options, conditions, and stable option IDs', () => {
    const source = formatChoiceInk(data);
    expect(source).toBe(
      'What will you do?\n* Plan A\n* Plan B # visible-if:hasMap # enabled-if:energy > 0',
    );
    expect(parseChoiceInk(source, data).data).toEqual(data);
  });

  it('keeps IDs by position while editing option text', () => {
    const parsed = parseChoiceInk('Choose a plan\n* First\n* Changed\n', data);
    expect(parsed.data?.options.map((option) => option.id)).toEqual(['o_plan_a', 'o_plan_b']);
    expect(parsed.data?.options[1].text.source).toBe('Changed');
  });

  it('keeps the surviving output ID when editing and deleting in one pass', () => {
    const parsed = parseChoiceInk('Choose a plan\n* Changed', data);
    expect(parsed.data?.options[0].id).toBe('o_plan_a');
  });

  it('keeps IDs with their options while reordering', () => {
    const parsed = parseChoiceInk(
      'What will you do?\n* Plan B # visible-if:hasMap # enabled-if:energy > 0\n* Plan A',
      data,
    );
    expect(parsed.data?.options.map((option) => option.id)).toEqual(['o_plan_b', 'o_plan_a']);
  });

  it('reports malformed option lines and unknown tags', () => {
    expect(parseChoiceInk('Prompt\nOption', data).data).toBeUndefined();
    expect(
      parseChoiceInk('Prompt\n* Option # custom:value', data).diagnostics[0]?.message,
    ).toContain('Unknown Choice option tag');
  });

  it('escapes multiline text and literal tags', () => {
    const escaped: ChoiceNodeData = {
      prompt: { source: 'Choose\nnow' },
      options: [{ id: 'o_hash', text: { source: 'Use # symbol\nnext' } }],
    };
    const source = formatChoiceInk(escaped);
    expect(parseChoiceInk(source, escaped).data).toEqual(escaped);
  });
});
