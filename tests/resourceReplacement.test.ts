import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  replaceStoryResourceReferences,
  type EngineTypeDefinition,
  type StorySourceDocument,
} from '../packages/common/src';

const payload: EngineTypeDefinition = {
  id: 'et_replacementpayload',
  name: 'ReplacementPayload',
  displayName: 'Replacement Payload',
  fields: [
    {
      id: 'ef_owner',
      name: 'owner',
      displayName: 'Owner',
      type: { kind: 'character-ref' },
      nullable: true,
      defaultValue: 'c_old',
    },
  ],
};

function source(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_replace',
    name: 'replace',
    displayName: 'Replace',
    root: {
      nodes: [
        {
          id: 'n_dialogue',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_replace',
                textId: 't_replace',
                text: { source: 'Hello' },
                speakerId: 'c_old',
              },
            ],
          },
        },
        {
          id: 'n_set',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            variableId: 'v_payload',
            value: { source: '{"owner":"c_old"}', bindings: {} },
          },
        },
      ],
      edges: [],
    },
    chapters: [],
    variables: [
      {
        id: 'v_payload',
        name: 'payload',
        displayName: 'Payload',
        scope: 'story',
        valueType: { kind: 'json', name: payload.name },
        defaultValue: { owner: 'c_old' },
      },
    ],
    characters: [],
    assets: [],
    events: [],
  };
}

describe('project resource reference replacement', () => {
  it('replaces direct Dialogue and nested Engine JSON references together', () => {
    const result = replaceStoryResourceReferences(
      source(),
      { engineTypes: [payload], projectVariables: [], events: [], signals: [] },
      'character',
      'c_old',
      'c_new',
    );
    expect(result.count).toBe(3);
    expect(result.source.variables[0]?.defaultValue).toEqual({ owner: 'c_new' });
    expect(result.source.root.nodes[0]?.data.lines[0]?.speakerId).toBe('c_new');
    expect(result.source.root.nodes[1]?.data.value.source).toBe('{"owner":"c_new"}');
  });
});
