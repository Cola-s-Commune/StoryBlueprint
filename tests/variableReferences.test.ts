import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  nodeRegistry,
  type CharacterSource,
  type VariableDefinition,
} from '@story-blueprint/common';
import type {
  EditorGraphNode,
  EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';
import {
  findVariableReferences,
  findProjectVariableReferences,
  renameExpressionVariable,
  renameTemplateVariable,
  renameVariableReferencesInNode,
  rewriteProjectVariableReferences,
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
        node('n_substoryref', StoryNodeType.CallSubstory, {
          arguments: {
            v_parameter: { source: 'score', bindings: { score: score.id } },
          },
          resultVariableIds: { v_output: score.id },
        }),
      ],
      edges: [],
    };
    const chapter: EditorGraphState = {
      nodes: [
        node('n_signalref', StoryNodeType.WaitSignal, {
          matches: { amount: { source: 'current', bindings: { current: score.id } } },
        }),
        node('n_returnref', StoryNodeType.Return, {
          values: { v_output: { source: 'score', bindings: { score: score.id } } },
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
      'n_substoryref:Result Variable',
      'n_substoryref:Substory Argument v_parameter',
      'n_signalref:Match amount',
      'n_returnref:Return Output v_output',
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

  it('binds and renames Call Substory arguments and Return expressions', () => {
    const call = bindVariableReferencesInNode(
      node('n_callbind', StoryNodeType.CallSubstory, {
        arguments: { v_parameter: { source: 'score + 1', bindings: {} } },
        resultVariableIds: {},
      }),
      [score],
    );
    const returned = renameVariableReferencesInNode(
      node('n_returnrename', StoryNodeType.Return, {
        values: { v_output: { source: 'score', bindings: { score: score.id } } },
      }),
      score.id,
      'score',
      'points',
    );
    expect(
      (call.data as { arguments: { v_parameter: { bindings: Record<string, string> } } }).arguments
        .v_parameter.bindings,
    ).toEqual({ score: score.id });
    expect(
      (returned.data as { values: { v_output: { source: string } } }).values.v_output.source,
    ).toBe('points');
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

  it('indexes and rewrites project variable references in unopened Story text', () => {
    nodeRegistry.registerBuiltins();
    const projectScore: VariableDefinition = {
      ...score,
      id: 'v_projectscore',
      scope: 'project',
    };
    const content = serializeStorySource({
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_unopened',
      name: 'unopened',
      displayName: 'Unopened Story',
      root: {
        nodes: [
          {
            id: 'n_unopenedline',
            type: StoryNodeType.Dialogue,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: {
              lines: [
                {
                  id: 'ln_unopenedscore',
                  textId: 't_unopenedscore',
                  text: { source: 'Score: {score}', bindings: { score: projectScore.id } },
                },
              ],
            },
          },
        ],
        edges: [],
      },
      chapters: [],
      variables: [],
      characters: [],
      assets: [],
      events: [],
    });
    const stories = [{ path: 'Stories/unopened.story', content }];
    const references = findProjectVariableReferences(projectScore, stories);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      storyId: 's_unopened',
      storyPath: 'Stories/unopened.story',
      nodeId: 'n_unopenedline',
    });

    const rewritten = rewriteProjectVariableReferences(
      stories,
      new Set(['s_unopened']),
      projectScore.id,
      'score',
      'points',
    );
    const parsed = parseStorySource(rewritten[0]!.content);
    const dialogue = parsed.root.nodes[0]!.data as {
      lines: Array<{ text: { source: string; bindings?: Record<string, string> } }>;
    };
    expect(dialogue.lines[0]!.text).toEqual({
      source: 'Score: {points}',
      bindings: { points: projectScore.id },
    });
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
