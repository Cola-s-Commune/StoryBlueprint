import { describe, expect, it } from 'vitest';
import {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  parseStoryProject,
  serializeStoryProject,
  type StoryProjectDocument,
} from '../packages/common/src';

function projectDocument(): StoryProjectDocument {
  return {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: 'prj_test',
    name: 'raft-survival',
    displayName: 'Raft Survival',
    entryStoryId: 's_intro',
    outputDirectory: 'Build/Stories',
    localizationPath: 'Localization/raft-survival.storyloc',
    stories: [
      { id: 's_intro', path: 'main/intro.story', name: 'intro', displayName: 'Intro' },
      { id: 's_quest', path: 'quests/trader.story', name: 'trader', displayName: 'Trader Quest' },
    ],
    characters: [
      {
        id: 'c_trader',
        name: 'trader',
        displayName: 'Trader',
        path: 'Characters/trader.character',
        storyIds: ['s_intro', 's_quest'],
      },
    ],
    assets: [
      {
        id: 'a_voice',
        name: 'trader-voice',
        displayName: 'Trader Voice',
        kind: 'audio',
        path: 'Assets/trader-voice.asset',
        locales: { default: 'audio/trader.wav' },
        storyIds: ['s_quest'],
      },
    ],
    engineTypes: [
      {
        name: 'RewardPayload',
        displayName: 'Reward Payload',
        description: 'Inventory reward passed to the game Adapter.',
        fields: [
          {
            name: 'itemId',
            displayName: 'Item ID',
            type: { kind: 'string' },
            defaultValue: '',
          },
          {
            name: 'tags',
            displayName: 'Tags',
            type: { kind: 'array', elementType: { kind: 'string' } },
            defaultValue: [],
          },
        ],
      },
    ],
    variables: [
      {
        id: 'v_reputation',
        name: 'reputation',
        displayName: 'Reputation',
        scope: 'project',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ],
    events: [
      {
        id: 'ev_reward',
        name: 'grantReward',
        displayName: 'Grant Reward',
        description: 'Adds a reward to the player inventory.',
        parameters: [
          { name: 'amount', valueType: { kind: 'number' } },
          { name: 'payload', valueType: { kind: 'json', name: 'RewardPayload' } },
        ],
        resumable: true,
        sideEffect: 'write',
      },
    ],
    signals: [
      {
        id: 'sig_animationfinished',
        name: 'animationFinished',
        displayName: 'Animation Finished',
        description: 'Sent after the current character animation ends.',
        parameters: [
          { name: 'character', valueType: { kind: 'string' } },
          { name: 'animation', valueType: { kind: 'string' } },
        ],
      },
    ],
  };
}

describe('story project KDL', () => {
  it('has a stable serialize-parse-serialize round trip', () => {
    const serialized = serializeStoryProject(projectDocument());
    expect(serializeStoryProject(parseStoryProject(serialized))).toBe(serialized);
    expect(serialized).toContain('story s_intro path="main/intro.story"');
    expect(serialized).toContain('used-by s_quest');
    expect(serialized).toContain('entry-story=s_intro');
    expect(serialized).toContain('output-directory="Build/Stories"');
    expect(serialized).toContain('localization="Localization/raft-survival.storyloc"');
    expect(serialized).toContain('path="Characters/trader.character"');
    expect(serialized).toContain('variable v_reputation name=reputation');
    expect(serialized).toContain('engine-type RewardPayload');
    expect(serialized).toContain('field tags');
    expect(serialized).toContain('type=array:string');
    expect(serialized).toContain('type=number default=0');
    expect(serialized).toContain('event ev_reward');
    expect(serialized).toContain('parameter amount type=number');
    expect(serialized).toContain('parameter payload type=json:RewardPayload');
    expect(serialized).toContain('description="Adds a reward to the player inventory."');
    expect(serialized).toContain('signal sig_animationfinished');
    expect(serialized).toContain('parameter animation type=string');
  });

  it('rejects paths outside the project and dangling resource usage', () => {
    const project = projectDocument();
    expect(() =>
      serializeStoryProject({
        ...project,
        stories: [{ ...project.stories[0], path: '../outside.story' }],
        characters: [],
        assets: [],
      }),
    ).toThrow(/Invalid project story path/);
    expect(() =>
      serializeStoryProject({
        ...project,
        characters: [{ ...project.characters[0], storyIds: ['s_missing'] }],
      }),
    ).toThrow(/missing story/);
  });

  it('rejects missing and cyclic Engine Type references', () => {
    const project = projectDocument();
    expect(() =>
      serializeStoryProject({
        ...project,
        engineTypes: [
          {
            name: 'Broken',
            displayName: 'Broken',
            fields: [
              {
                name: 'target',
                displayName: 'Target',
                type: { kind: 'object', typeName: 'Missing' },
                defaultValue: {},
              },
            ],
          },
        ],
      }),
    ).toThrow(/missing Engine Type Missing/);
    expect(() =>
      serializeStoryProject({
        ...project,
        engineTypes: [
          {
            name: 'Recursive',
            displayName: 'Recursive',
            fields: [
              {
                name: 'children',
                displayName: 'Children',
                type: {
                  kind: 'array',
                  elementType: { kind: 'object', typeName: 'Recursive' },
                },
                defaultValue: [],
              },
            ],
          },
        ],
      }),
    ).toThrow(/Cyclic Engine Type/);
  });
});
