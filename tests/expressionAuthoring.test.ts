import { describe, expect, it } from 'vitest';
import type { CharacterSource, VariableDefinition } from '../packages/common/src';
import {
  createStringValueModeState,
  editStringValueText,
  expressionCandidates,
  expressionDiagnostic,
  expressionToTextTemplate,
  insertExpressionCandidate,
  insertExpressionOperator,
  stringValueModeText,
  switchStringValueMode,
  textTemplateToExpression,
} from '../packages/editor/src/renderer/components/Panels/expressionAuthoring';

const storyVariables: VariableDefinition[] = [
  {
    id: 'v_gold',
    name: 'gold',
    displayName: 'Gold',
    scope: 'story',
    valueType: { kind: 'number' },
    defaultValue: 0,
  },
  {
    id: 'v_ready',
    name: 'ready',
    displayName: 'Ready',
    scope: 'story',
    valueType: { kind: 'boolean' },
    defaultValue: false,
  },
  {
    id: 'v_player',
    name: 'playerName',
    displayName: 'Player Name',
    scope: 'story',
    valueType: { kind: 'string' },
    defaultValue: '',
  },
];

const characters: CharacterSource[] = [
  {
    id: 'c_mike',
    name: 'Mike',
    displayName: 'Mike',
    emotions: {},
    fields: [
      {
        id: 'v_trust',
        name: 'trust',
        displayName: 'Trust',
        scope: 'character',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ],
  },
];

describe('expression authoring helpers', () => {
  it('searches qualified character fields and prioritizes the expected type', () => {
    const all = expressionCandidates(storyVariables, [], characters, '', { kind: 'boolean' });
    expect(all.results[0]?.insertion).toBe('ready');

    const filtered = expressionCandidates(storyVariables, [], characters, 'trust');
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]?.insertion).toBe('Mike.trust');
  });

  it('replaces the identifier around the cursor without touching the expression', () => {
    expect(insertExpressionCandidate('gold >= rea', 11, 11, 'ready')).toEqual({
      source: 'gold >= ready',
      cursor: 13,
    });
    expect(insertExpressionOperator('ready', 0, 5, '!')).toEqual({
      source: '!(ready)',
      cursor: 8,
    });
  });

  it('reports syntax and expected result type without changing the source', () => {
    expect(
      expressionDiagnostic('gold >= 3', storyVariables, [], characters, { kind: 'boolean' }),
    ).toEqual({ kind: 'valid', message: 'Valid boolean expression' });
    expect(
      expressionDiagnostic('gold + 3', storyVariables, [], characters, { kind: 'boolean' }),
    ).toEqual({
      kind: 'error',
      message: 'Expected boolean, but this expression returns number.',
    });
    expect(
      expressionDiagnostic('missing', storyVariables, [], characters, { kind: 'boolean' }),
    ).toMatchObject({ kind: 'error', offset: 0 });
  });

  it('shows a string variable as an Ink-style Text template', () => {
    const template = expressionToTextTemplate('playerName', storyVariables, [], characters);
    const initial = createStringValueModeState('playerName', template);
    expect(initial.literalDraft).toBe('{playerName}');
    const asExpression = switchStringValueMode(initial, 'playerName', 'expression', template);
    expect(asExpression.converted).toBe(true);
    expect(asExpression.state.mode).toBe('expression');
    expect(asExpression.source).toBe('playerName');
    const asText = switchStringValueMode(
      asExpression.state,
      asExpression.source,
      'literal',
      template,
    );
    expect(asText.converted).toBe(true);
    expect(asText.source).toBe('playerName');
    expect(asText.state.mode).toBe('literal');
  });

  it('removes expression quotes when a string literal is shown as Text', () => {
    const literal = createStringValueModeState('"A"');
    const asExpression = switchStringValueMode(literal, '"A"', 'expression');
    const asText = switchStringValueMode(asExpression.state, asExpression.source, 'literal');
    expect(asText.converted).toBe(true);
    expect(stringValueModeText(asText.source, asText.state)).toBe('A');

    const singleQuoted = createStringValueModeState("'B'");
    expect(singleQuoted.mode).toBe('literal');
    expect(stringValueModeText("'B'", singleQuoted)).toBe('B');
  });

  it('round-trips composite string expressions as Ink-style templates', () => {
    const source = '"A" + playerName';
    const template = expressionToTextTemplate(source, storyVariables, [], characters);
    expect(template).toBe('A{playerName}');
    const expression = createStringValueModeState(source, template);
    expect(expression.mode).toBe('literal');

    const edited = editStringValueText(expression, 'Hello {playerName}, gold {gold}');
    expect(edited.source).toBe(textTemplateToExpression('Hello {playerName}, gold {gold}'));
    expect(
      expressionDiagnostic(edited.source, storyVariables, [], characters, { kind: 'string' }),
    ).toEqual({ kind: 'valid', message: 'Valid string expression' });
  });
});
