import { describe, expect, it } from 'vitest';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  clearStoryResourceReferences,
  clearEngineResourceValueReferences,
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

  it('clears optional Story references while preserving required Engine fields', () => {
    const result = clearStoryResourceReferences(
      source(),
      { engineTypes: [payload], projectVariables: [], events: [], signals: [] },
      'character',
      'c_old',
    );
    expect(result.count).toBe(3);
    expect(result.blocked).toBe(0);
    expect(result.source.variables[0]?.defaultValue).toEqual({ owner: null });
    expect(result.source.root.nodes[0]?.data.lines[0]?.speakerId).toBeUndefined();
    expect(result.source.root.nodes[1]?.data.value.source).toBe('{"owner":null}');
  });

  it('removes direct array and map references but blocks a required object field', () => {
    const requiredPayload: EngineTypeDefinition = {
      ...payload,
      name: 'RequiredPayload',
      fields: [{ ...payload.fields[0]!, nullable: false }],
    };
    const array = clearEngineResourceValueReferences(
      ['c_old', 'c_keep'],
      { kind: 'array', elementType: { kind: 'character-ref' } },
      [requiredPayload],
      'character',
      'c_old',
    );
    const map = clearEngineResourceValueReferences(
      { first: 'c_old', second: 'c_keep' },
      { kind: 'map', keyType: { kind: 'string' }, valueType: { kind: 'character-ref' } },
      [requiredPayload],
      'character',
      'c_old',
    );
    const object = clearEngineResourceValueReferences(
      { owner: 'c_old' },
      { kind: 'object', typeName: requiredPayload.name },
      [requiredPayload],
      'character',
      'c_old',
    );
    expect(array).toEqual({ value: ['c_keep'], count: 1, blocked: 0 });
    expect(map).toEqual({ value: { second: 'c_keep' }, count: 1, blocked: 0 });
    expect(object).toEqual({ value: { owner: 'c_old' }, count: 0, blocked: 1 });
  });
});
