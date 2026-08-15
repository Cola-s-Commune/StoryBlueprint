import { describe, expect, it } from 'vitest';
import type { CharacterSource, VariableDefinition } from '../packages/common/src';
import {
  expressionCandidates,
  expressionDiagnostic,
  insertExpressionCandidate,
  insertExpressionOperator,
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
});
