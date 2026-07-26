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
    stories: [
      { id: 's_intro', path: 'main/intro.story', name: 'intro', displayName: 'Intro' },
      { id: 's_quest', path: 'quests/trader.story', name: 'trader', displayName: 'Trader Quest' },
    ],
    characters: [
      { id: 'c_trader', name: 'trader', displayName: 'Trader', storyIds: ['s_intro', 's_quest'] },
    ],
    assets: [
      {
        id: 'a_voice',
        name: 'trader-voice',
        displayName: 'Trader Voice',
        kind: 'audio',
        locales: { default: 'audio/trader.wav' },
        storyIds: ['s_quest'],
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
});
