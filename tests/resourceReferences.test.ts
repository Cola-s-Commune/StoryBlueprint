import { describe, expect, it } from 'vitest';
import { StoryNodeType, type CharacterSource } from '../packages/common/src';
import type {
  EditorGraphNode,
  EditorGraphState,
} from '../packages/editor/src/renderer/graph/editorGraph';
import {
  buildStoryResourceReferenceIndex,
  emotionReferenceKey,
  findAssetReferences,
  findCharacterReferences,
  findEmotionReferences,
  type ResourceReferenceStory,
} from '../packages/editor/src/renderer/graph/resourceReferences';

function dialogue(
  id: EditorGraphNode['id'],
  lines: EditorGraphNode['data']['lines'],
): EditorGraphNode {
  return {
    id,
    type: StoryNodeType.Dialogue,
    definitionVersion: 1,
    position: { x: 0, y: 0 },
    data: { lines },
  };
}

function graph(nodes: EditorGraphNode[]): EditorGraphState {
  return { nodes, edges: [] };
}

const character: CharacterSource = {
  id: 'c_alice',
  name: 'alice',
  displayName: 'Alice',
  defaultPortraitId: 'a_portrait',
  emotions: {
    happy: { displayName: 'Happy', portraitId: 'a_happy' },
  },
  fields: [
    {
      id: 'v_affinity',
      name: 'affinity',
      displayName: 'Affinity',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    },
  ],
  relationships: {
    c_bob: { label: 'Trusted ally', description: 'Alice depends on Bob.' },
  },
};

const bob: CharacterSource = {
  id: 'c_bob',
  name: 'bob',
  displayName: 'Bob',
  emotions: {},
};

const stories: ResourceReferenceStory[] = [
  {
    id: 's_main',
    label: 'Main Story File',
    rootGraph: graph([
      dialogue('n_intro', [
        {
          id: 'ln_intro',
          textId: 't_intro',
          text: { source: 'Hello' },
          speakerId: character.id,
          voiceId: 'a_voice',
          emotion: 'happy',
        },
      ]),
    ]),
    chapters: [
      {
        id: 'ch_second',
        label: 'Second Chapter',
        graph: graph([
          dialogue('n_second', [
            {
              id: 'ln_second',
              textId: 't_second',
              text: { source: 'Again' },
              speakerId: character.id,
            },
          ]),
        ]),
      },
    ],
  },
];

describe('character and asset reference index', () => {
  it('finds Character and Emotion use sites with Story and Graph locations', () => {
    const characterReferences = findCharacterReferences(character.id, stories);
    expect(characterReferences.map((reference) => reference.field)).toEqual([
      'Line 1 Speaker',
      'Line 1 Speaker',
    ]);
    expect(characterReferences[1]?.location).toBe('Main Story File · Second Chapter');

    const emotionReferences = findEmotionReferences(character.id, 'happy', stories);
    expect(emotionReferences).toHaveLength(1);
    expect(emotionReferences[0]?.target).toEqual({
      kind: 'node',
      storyId: 's_main',
      graphId: 'root',
      nodeId: 'n_intro',
    });
  });

  it('finds Dialogue Voice and Character portrait references to an Asset', () => {
    const voiceReferences = findAssetReferences('a_voice', stories, [{ character }]);
    expect(voiceReferences.map((reference) => reference.field)).toEqual(['Line 1 Voice']);

    const portraitReferences = findAssetReferences('a_portrait', stories, [{ character }]);
    expect(portraitReferences.map((reference) => reference.field)).toEqual(['Default Portrait']);
    expect(portraitReferences[0]?.target).toEqual({
      kind: 'character',
      characterId: character.id,
    });

    expect(findAssetReferences('a_happy', stories, [{ character }])[0]?.field).toBe(
      'Emotion Happy Portrait',
    );
  });

  it('indexes directed Character relationships as target references', () => {
    const index = buildStoryResourceReferenceIndex([], [{ character }, { character: bob }]);
    expect(index.characters.get(bob.id)).toEqual([
      expect.objectContaining({
        label: 'Alice',
        field: 'Relationship · Trusted ally',
        target: { kind: 'character', characterId: character.id },
      }),
    ]);
    expect(index.characters.get(character.id)).toBeUndefined();
  });

  it('does not report unrelated resources', () => {
    expect(findCharacterReferences('c_other', stories)).toEqual([]);
    expect(findEmotionReferences(character.id, 'sad', stories)).toEqual([]);
    expect(findAssetReferences('a_other', stories, [{ character }])).toEqual([]);
  });

  it('indexes qualified character fields across Stories', () => {
    const fieldStory: ResourceReferenceStory = {
      id: 's_fields',
      label: 'Field Story',
      rootGraph: graph([
        {
          id: 'n_fieldbranch',
          type: StoryNodeType.Branch,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: {
            condition: {
              source: 'alice.affinity > 0',
              bindings: { 'alice.affinity': 'v_affinity' },
            },
          },
        },
      ]),
      chapters: [],
    };
    const index = buildStoryResourceReferenceIndex([fieldStory], [{ character }]);
    expect(index.characterFields.get('v_affinity')).toHaveLength(1);
    expect(index.characterFields.get('v_affinity')?.[0]?.location).toBe('Field Story · Main Story');
  });

  it('builds one shared index for a large set of Dialogue references', () => {
    const manyNodes = Array.from({ length: 1_000 }, (_, index) =>
      dialogue(`n_bulk${index}` as EditorGraphNode['id'], [
        {
          id: `ln_bulk${index}`,
          textId: `t_bulk${index}`,
          text: { source: 'Bulk' },
          speakerId: character.id,
          voiceId: 'a_voice',
          emotion: 'happy',
        },
      ]),
    );
    const index = buildStoryResourceReferenceIndex(
      [
        {
          id: 's_bulk',
          label: 'Bulk Story',
          rootGraph: graph(manyNodes),
          chapters: [],
        },
      ],
      [{ character }],
    );

    expect(index.characters.get(character.id)).toHaveLength(1_000);
    expect(index.emotions.get(emotionReferenceKey(character.id, 'happy'))).toHaveLength(1_000);
    expect(index.assets.get('a_voice')).toHaveLength(1_000);
    expect(index.assets.get('a_portrait')).toHaveLength(1);
  });

  it('recursively indexes Engine JSON references in variables, nodes, Character Fields, and Maps', () => {
    const payload = {
      id: 'et_referencepayload' as const,
      name: 'ReferencePayload',
      displayName: 'Reference Payload',
      fields: [
        {
          id: 'ef_owner' as const,
          name: 'owner',
          displayName: 'Owner',
          type: { kind: 'character-ref' as const },
          nullable: true,
          defaultValue: 'c_alice',
        },
        {
          id: 'ef_portraits' as const,
          name: 'portraits',
          displayName: 'Portraits',
          type: { kind: 'array' as const, elementType: { kind: 'asset-ref' as const } },
          defaultValue: ['a_portrait'],
        },
        {
          id: 'ef_bykey' as const,
          name: 'byKey',
          displayName: 'By Key',
          type: {
            kind: 'map' as const,
            keyType: { kind: 'string' as const },
            valueType: { kind: 'asset-ref' as const },
          },
          defaultValue: { happy: 'a_happy' },
        },
      ],
    };
    const jsonVariable = {
      id: 'v_payload' as const,
      name: 'payload',
      displayName: 'Payload',
      scope: 'story' as const,
      valueType: { kind: 'json' as const, name: payload.name },
      defaultValue: {
        owner: 'c_alice',
        portraits: ['a_portrait'],
        byKey: { happy: 'a_happy' },
      },
    };
    const story: ResourceReferenceStory = {
      id: 's_jsonrefs',
      label: 'JSON Story',
      variables: [jsonVariable],
      rootGraph: graph([
        {
          id: 'n_setpayload',
          type: StoryNodeType.SetVariable,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: {
            variableId: jsonVariable.id,
            value: {
              source: JSON.stringify(jsonVariable.defaultValue),
              bindings: {},
            },
          },
        },
      ]),
      chapters: [],
    };
    const characterWithJson: CharacterSource = {
      ...character,
      fields: [
        ...(character.fields ?? []),
        { ...jsonVariable, id: 'v_characterpayload', scope: 'character' },
      ],
    };
    const index = buildStoryResourceReferenceIndex([story], [{ character: characterWithJson }], {
      engineTypes: [payload],
      projectVariables: [],
      events: [],
      signals: [],
    });
    expect(index.characters.get('c_alice')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'Default.owner',
          target: { kind: 'variable', variableId: 'v_payload', storyId: 's_jsonrefs' },
        }),
        expect.objectContaining({
          field: 'Set Variable.owner',
          target: expect.objectContaining({ kind: 'node', nodeId: 'n_setpayload' }),
        }),
      ]),
    );
    expect(index.assets.get('a_happy')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'Default.byKey.happy' }),
        expect.objectContaining({ field: 'Set Variable.byKey.happy' }),
        expect.objectContaining({
          field: 'Payload.Default.byKey.happy',
          target: expect.objectContaining({ kind: 'character' }),
        }),
      ]),
    );
  });

  it('indexes top-level CharacterRef and AssetRef variable defaults', () => {
    const story: ResourceReferenceStory = {
      id: 's_typedrefs',
      label: 'Typed Ref Story',
      variables: [
        {
          id: 'v_actor',
          name: 'actor',
          displayName: 'Actor',
          scope: 'story',
          valueType: { kind: 'character-ref' },
          defaultValue: 'c_alice',
        },
        {
          id: 'v_voice',
          name: 'voice',
          displayName: 'Voice',
          scope: 'story',
          valueType: { kind: 'asset-ref' },
          defaultValue: 'a_voice',
        },
      ],
      rootGraph: graph([]),
      chapters: [],
    };
    const index = buildStoryResourceReferenceIndex([story], [{ character }]);
    expect(index.characters.get('c_alice')?.[0]?.field).toBe('Default');
    expect(index.assets.get('a_voice')?.[0]?.field).toBe('Default');
  });
});
