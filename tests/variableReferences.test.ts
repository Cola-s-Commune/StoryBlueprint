import { describe, expect, it } from 'vitest';
import {
  StoryNodeType,
  type CharacterSource,
  type VariableDefinition,
} from '../packages/common/src';
import type {
  EditorGraphNode,
  EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';
import {
  findVariableReferences,
  renameExpressionVariable,
  renameTemplateVariable,
  renameVariableReferencesInNode,
  bindCharacterFieldExpression,
  bindVariableReferencesInNode,
  renameCharacterFieldReferencesInNode,
} from '../packages/editor/src/renderer/graph/variableReferences';

const score: VariableDefinition = {
  id: 'v_score',
  name: 'score',
  displayName: 'Score',
  scope: 'story',
  valueType: { kind: 'number' },
  defaultValue: 0,
};

const affinity: VariableDefinition = {
  id: 'v_affinity',
  name: 'affinity',
  displayName: 'Affinity',
  scope: 'character',
  valueType: { kind: 'number' },
  defaultValue: 0,
};

const alice: CharacterSource = {
  id: 'c_alice',
  name: 'Alice',
  displayName: 'Alice',
  emotions: {},
  fields: [affinity],
};

function node(
  id: EditorGraphNode['id'],
  type: StoryNodeType,
  data: EditorGraphNode['data'],
): EditorGraphNode {
  return {
    id,
    type,
    data,
    definitionVersion: 1,
    position: { x: 0, y: 0 },
  };
}

describe('variable reference index', () => {
  it('finds direct, expression, template, event, and signal references across graphs', () => {
    const root: EditorGraphState = {
      nodes: [
        node('n_getscore', StoryNodeType.GetVariable, { variableId: score.id }),
        node('n_setscore', StoryNodeType.SetVariable, {
          variableId: score.id,
          value: { source: 'score + 1', bindings: { score: score.id } },
        }),
        node('n_dialogue', StoryNodeType.Dialogue, {
          lines: [{ id: 'ln_score', textId: 't_score', text: { source: 'Score: {score}' } }],
        }),
        node('n_eventref', StoryNodeType.CallEvent, {
          arguments: {
            amount: { source: 'score', bindings: {} },
            label: { source: '"score"', bindings: {} },
          },
        }),
      ],
      edges: [],
    };
    const chapter: EditorGraphState = {
      nodes: [
        node('n_signalref', StoryNodeType.WaitSignal, {
          matches: { amount: { source: 'current', bindings: { current: score.id } } },
        }),
      ],
      edges: [],
    };

    const references = findVariableReferences(score, [
      { storyId: 's_scorestory', id: 'root', label: 'Main Story', graph: root },
      { storyId: 's_scorestory', id: 'ch_score', label: 'Score Chapter', graph: chapter },
    ]);

    expect(references.map((reference) => `${reference.nodeId}:${reference.field}`)).toEqual([
      'n_getscore:Variable',
      'n_setscore:Variable',
      'n_setscore:Value',
      'n_dialogue:Line 1',
      'n_eventref:Argument amount',
      'n_signalref:Match amount',
    ]);
    expect(references.at(-1)?.graphLabel).toBe('Score Chapter');
    expect(references.every((reference) => reference.storyId === 's_scorestory')).toBe(true);
  });

  it('renames identifiers and bindings without changing string literals or escaped template text', () => {
    expect(
      renameExpressionVariable(
        {
          source: 'score + "score" + scoreBonus',
          bindings: { score: score.id },
        },
        score.id,
        'score',
        'points',
      ),
    ).toEqual({
      source: 'points + "score" + scoreBonus',
      bindings: { points: score.id },
    });
    expect(
      renameTemplateVariable(
        { source: '{score} / {{score}} / {score + 1}', bindings: { score: score.id } },
        score.id,
        'score',
        'points',
      ),
    ).toEqual({
      source: '{points} / {{score}} / {points + 1}',
      bindings: { points: score.id },
    });
    expect(
      renameTemplateVariable(
        { source: '{score}', bindings: { score: 'v_other' } },
        score.id,
        'score',
        'points',
      ),
    ).toEqual({ source: '{score}', bindings: { score: 'v_other' } });
  });

  it('rewrites Event and Signal expressions through the same node transform', () => {
    const event = renameVariableReferencesInNode(
      node('n_eventrename', StoryNodeType.CallEvent, {
        arguments: {
          amount: { source: 'score + 1', bindings: { score: score.id } },
        },
      }),
      score.id,
      'score',
      'points',
    );
    const signal = renameVariableReferencesInNode(
      node('n_signalrename', StoryNodeType.WaitSignal, {
        matches: {
          amount: { source: 'score', bindings: {} },
        },
      }),
      score.id,
      'score',
      'points',
    );

    expect(
      (event.data as { arguments: { amount: { source: string } } }).arguments.amount.source,
    ).toBe('points + 1');
    expect((signal.data as { matches: { amount: { source: string } } }).matches.amount.source).toBe(
      'points',
    );
  });

  it('binds Story and Project variables in expressions and text templates', () => {
    const projectScore: VariableDefinition = { ...score, id: 'v_projectscore', scope: 'project' };
    const bound = bindVariableReferencesInNode(
      node('n_projecttemplate', StoryNodeType.Dialogue, {
        lines: [
          {
            id: 'ln_projectscore',
            textId: 't_projectscore',
            text: { source: 'Score: {score}' },
          },
        ],
      }),
      [projectScore],
    );
    const text = (bound.data as { lines: Array<{ text: { bindings?: Record<string, string> } }> })
      .lines[0]!.text;
    expect(text.bindings).toEqual({ score: projectScore.id });

    const expressionNode = bindVariableReferencesInNode(
      node('n_projectexpression', StoryNodeType.Branch, {
        condition: { source: 'score > Alice.score', bindings: {} },
      }),
      [projectScore, { ...projectScore, id: 'v_alice', name: 'Alice' }],
    );
    expect(
      (expressionNode.data as { condition: { bindings: Record<string, string> } }).condition
        .bindings,
    ).toEqual({ score: projectScore.id });
  });

  it('binds and safely renames qualified character fields in expressions and templates', () => {
    expect(
      bindCharacterFieldExpression({ source: 'Alice.affinity + Bob.affinity', bindings: {} }, [
        alice,
      ]).bindings,
    ).toEqual({ 'Alice.affinity': affinity.id });

    const renamed = renameCharacterFieldReferencesInNode(
      node('n_characterfield', StoryNodeType.Dialogue, {
        lines: [
          {
            id: 'ln_affinity',
            textId: 't_affinity',
            text: {
              source: 'Value {Alice.affinity}; literal {{Alice.affinity}}',
              bindings: { 'Alice.affinity': affinity.id },
            },
          },
        ],
      }),
      affinity.id,
      'Alice.affinity',
      'Alicia.relationship',
    );
    const text = (
      renamed.data as {
        lines: Array<{ text: { source: string; bindings?: Record<string, string> } }>;
      }
    ).lines[0]!.text;
    expect(text.source).toBe('Value {Alicia.relationship}; literal {{Alice.affinity}}');
    expect(text.bindings).toEqual({ 'Alicia.relationship': affinity.id });
  });
});
