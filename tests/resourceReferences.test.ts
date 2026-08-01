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

  it('does not report unrelated resources', () => {
    expect(findCharacterReferences('c_other', stories)).toEqual([]);
    expect(findEmotionReferences(character.id, 'sad', stories)).toEqual([]);
    expect(findAssetReferences('a_other', stories, [{ character }])).toEqual([]);
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
});
