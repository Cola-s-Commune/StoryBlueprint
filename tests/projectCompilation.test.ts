import { describe, expect, it } from 'vitest';
import {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileProject } from '../packages/compiler/src';
import {
  createRuntimeFromCompiledProject,
  parseCompiledStoryProject,
} from '../packages/runtime/src';

function story(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_projectstory',
    name: 'project-story',
    displayName: 'Project Story',
    characters: [],
    assets: [],
    variables: [],
    events: [],
    chapters: [],
    root: {
      nodes: [
        {
          id: 'n_projectstart',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 10, y: 20 },
          data: { title: 'Start' },
        },
        {
          id: 'n_projectdialogue',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 30, y: 20 },
          data: {
            lines: [{ id: 'ln_projecthello', textId: 't_projecthello', text: { source: 'Hello' } }],
          },
        },
        {
          id: 'n_projectend',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 50, y: 20 },
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_projectstart', portId: 'out' },
          to: { nodeId: 'n_projectdialogue', portId: 'in' },
        },
        {
          from: { nodeId: 'n_projectdialogue', portId: 'out' },
          to: { nodeId: 'n_projectend', portId: 'in' },
        },
      ],
    },
  };
}

function project(): StoryProjectDocument {
  return {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: 'p_projectcompile',
    name: 'compile-test',
    displayName: 'Compile Test',
    stories: [
      {
        id: 's_projectstory',
        path: 'Stories/project.story',
        name: 'project-story',
        displayName: 'Project Story',
      },
    ],
    characters: [],
    assets: [],
    variables: [
      {
        id: 'v_projectflag',
        name: 'projectFlag',
        displayName: 'Project Flag',
        scope: 'project',
        valueType: { kind: 'boolean' },
        defaultValue: false,
      },
      {
        id: 'v_projectpayloads',
        name: 'projectPayloads',
        displayName: 'Project Payloads',
        scope: 'project',
        valueType: { kind: 'array' },
        defaultValue: [{ $storyBlueprintType: 'et_editor_only', name: 'kept' }],
      },
    ],
    events: [
      {
        id: 'ev_playanim',
        name: 'playAnim',
        displayName: 'Play Animation',
        description: 'Plays an animation and waits for completion.',
        parameters: [{ name: 'animName', valueType: { kind: 'string' } }],
        resumable: true,
        sideEffect: 'write',
      },
    ],
    signals: [],
  };
}

describe('project compilation', () => {
  it('exports a node-free project artifact that the runtime can load', () => {
    const result = compileProject(project(), [{ path: 'Stories/project.story', source: story() }]);
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result.project);
    expect(json).not.toContain('position');
    expect(json).not.toContain('n_projectstart');
    expect(result.project.stories.s_projectstory.program.variables).toContainEqual(
      expect.objectContaining({ id: 'v_projectflag', scope: 'project' }),
    );
    expect(result.project.stories.s_projectstory.program.variables).toContainEqual(
      expect.objectContaining({
        id: 'v_projectpayloads',
        defaultValue: [{ name: 'kept' }],
      }),
    );
    expect(json).not.toContain('$storyBlueprintType');
    const loaded = parseCompiledStoryProject(json);
    expect(loaded.events).toMatchObject([
      {
        id: 'ev_playanim',
        name: 'playAnim',
        description: 'Plays an animation and waits for completion.',
      },
    ]);
    const runtime = createRuntimeFromCompiledProject(loaded);
    expect(runtime.runUntilPause().kind).toBe('waiting');
  });

  it('reports graph locations for unreachable nodes and broken edges', () => {
    const invalid = story();
    invalid.root = {
      ...invalid.root,
      nodes: invalid.root.nodes.map((node) =>
        node.id === 'n_projectdialogue'
          ? {
              ...node,
              data: {
                lines: [
                  {
                    id: 'ln_projecthello',
                    textId: 't_projecthello',
                    text: { source: 'Hello' },
                    speakerId: 'c_missing',
                  },
                ],
              },
            }
          : node,
      ),
      edges: [
        {
          from: { nodeId: 'n_projectstart', portId: 'missing' },
          to: { nodeId: 'n_projectdialogue', portId: 'in' },
        },
      ],
    };
    const result = compileProject(project(), [{ path: 'Stories/project.story', source: invalid }]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DANGLING_EDGE', storyId: 's_projectstory' }),
        expect.objectContaining({ code: 'UNREACHABLE_NODE', sourceNodeId: 'n_projectdialogue' }),
      ]),
    );
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_NODE', sourceNodeId: 'n_projectdialogue' }),
      ]),
    );
  });

  it('rejects recursive substory call cycles with a graph diagnostic', () => {
    const recursiveSource = story();
    const chapter = (id: 'ch_alpha' | 'ch_beta', targetId: 'ch_alpha' | 'ch_beta') => ({
      id,
      name: id.slice(3),
      displayName: id === 'ch_alpha' ? 'Alpha' : 'Beta',
      parameters: [],
      outputs: [],
      localVariables: [],
      graph: {
        nodes: [
          {
            id: `n_${id}_start`,
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
          {
            id: `n_${id}_call`,
            type: StoryNodeType.CallSubstory,
            definitionVersion: 1,
            position: { x: 300, y: 0 },
            data: { chapterId: targetId, arguments: {}, resultVariableIds: {} },
          },
          {
            id: `n_${id}_return`,
            type: StoryNodeType.Return,
            definitionVersion: 1,
            position: { x: 600, y: 0 },
            data: { values: {} },
          },
        ],
        edges: [
          {
            from: { nodeId: `n_${id}_start`, portId: 'out' },
            to: { nodeId: `n_${id}_call`, portId: 'in' },
          },
          {
            from: { nodeId: `n_${id}_call`, portId: 'out' },
            to: { nodeId: `n_${id}_return`, portId: 'in' },
          },
        ],
      },
    });
    recursiveSource.chapters = [chapter('ch_alpha', 'ch_beta'), chapter('ch_beta', 'ch_alpha')];

    const result = compileProject(project(), [
      { path: 'Stories/project.story', source: recursiveSource },
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SUBSTORY_CALL_CYCLE',
          severity: 'error',
          sourceChapterId: expect.stringMatching(/^ch_(alpha|beta)$/),
          sourceNodeId: expect.stringMatching(/^n_ch_(alpha|beta)_call$/),
          message: expect.stringMatching(/Alpha|Beta/),
        }),
      ]),
    );
  });

  it('exports sample-quest.storyc.json and sample-quest.story.json examples', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { compileStory } = await import('../packages/compiler/src');
    const sampleDoc: StorySourceDocument = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_dragon_quest',
      name: 'dragon_quest',
      displayName: 'The Dragon Quest',
      variables: [
        {
          id: 'v_player_gold',
          name: 'gold',
          displayName: 'Player Gold',
          scope: 'story',
          valueType: { kind: 'number' },
          defaultValue: 100,
        },
        {
          id: 'v_player_name',
          name: 'playerName',
          displayName: 'Player Name',
          scope: 'story',
          valueType: { kind: 'string' },
          defaultValue: 'Hero',
        },
        {
          id: 'v_quest_accepted',
          name: 'questAccepted',
          displayName: 'Quest Accepted',
          scope: 'story',
          valueType: { kind: 'boolean' },
          defaultValue: false,
        },
      ],
      characters: [
        {
          id: 'c_elder',
          name: 'villageElder',
          displayName: 'Village Elder',
          defaultPortraitId: 'ast_elder_normal',
          emotions: {
            happy: { portraitId: 'ast_elder_happy' },
          },
          fields: [],
        },
      ],
      assets: [
        {
          id: 'ast_elder_normal',
          name: 'elder_normal',
          displayName: 'Elder Normal Portrait',
          kind: 'portrait',
          path: 'Portraits/elder_normal.png',
        },
        {
          id: 'ast_elder_happy',
          name: 'elder_happy',
          displayName: 'Elder Happy Portrait',
          kind: 'portrait',
          path: 'Portraits/elder_happy.png',
        },
        {
          id: 'ast_voice_welcome',
          name: 'voice_welcome',
          displayName: 'Elder Greeting Voice',
          kind: 'audio',
          path: 'Audio/VO/elder_welcome.mp3',
        },
      ],
      events: [
        {
          id: 'ev_grant_reward',
          name: 'grantReward',
          displayName: 'Grant Quest Reward',
          parameters: [
            { name: 'amount', valueType: { kind: 'number' } },
            { name: 'reason', valueType: { kind: 'string' } },
          ],
          outputs: [
            { id: 'evo_success', name: 'success', displayName: 'Success', valueType: { kind: 'boolean' } },
          ],
          resumable: true,
          sideEffect: 'write',
        },
      ],
      signals: [
        {
          id: 'sig_boss_slain',
          name: 'Boss Slain Signal',
          parameters: [
            { name: 'bossId', valueType: { kind: 'string' } },
            { name: 'exp', valueType: { kind: 'number' } },
          ],
        },
      ],
      chapters: [],
      root: {
        nodes: [
          {
            id: 'n_start',
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
          {
            id: 'n_dialogue_greet',
            type: StoryNodeType.Dialogue,
            definitionVersion: 1,
            position: { x: 220, y: 0 },
            data: {
              speakerId: 'c_elder',
              emotion: 'happy',
              portraitId: 'ast_elder_happy',
              lines: [
                {
                  id: 'ln_greet',
                  textId: 't_greet_player',
                  text: { source: 'Welcome to our village, {playerName}! We desperately need your help.' },
                  voice: { default: 'ast_voice_welcome' },
                  tags: ['camera:close-up', 'audio:village_bgm'],
                },
              ],
            },
          },
          {
            id: 'n_choice_quest',
            type: StoryNodeType.Choice,
            definitionVersion: 1,
            position: { x: 500, y: 0 },
            data: {
              prompt: { source: 'Will you take up the quest to defeat the dragon?' },
              options: [
                {
                  id: 'opt_accept',
                  text: { source: 'I will defeat the dragon for you!' },
                  condition: { source: 'gold >= 0', bindings: {} },
                },
                {
                  id: 'opt_decline',
                  text: { source: 'Sorry, I am not ready yet.' },
                },
              ],
            },
          },
          {
            id: 'n_set_accepted',
            type: StoryNodeType.SetVariable,
            definitionVersion: 1,
            position: { x: 780, y: -80 },
            data: {
              variableId: 'v_quest_accepted',
              value: { source: 'true', bindings: {} },
            },
          },
          {
            id: 'n_wait_dragon',
            type: StoryNodeType.WaitSignal,
            definitionVersion: 1,
            position: { x: 1040, y: -80 },
            data: {
              signalId: 'sig_boss_slain',
              matches: { bossId: { source: '"red_dragon"', bindings: {} } },
            },
          },
          {
            id: 'n_call_reward',
            type: StoryNodeType.CallEvent,
            definitionVersion: 1,
            position: { x: 1300, y: -80 },
            data: {
              eventId: 'ev_grant_reward',
              arguments: {
                amount: { source: '500', bindings: {} },
                reason: { source: '"Dragon Slaying"', bindings: {} },
              },
              outputPorts: [{ id: 'evo_success', label: 'Success', valueType: { kind: 'boolean' } }],
              resultVariableIds: {},
            },
          },
          {
            id: 'n_end_victory',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 1560, y: -80 },
            data: { title: 'Quest Complete' },
          },
          {
            id: 'n_end_decline',
            type: StoryNodeType.End,
            definitionVersion: 1,
            position: { x: 780, y: 120 },
            data: { title: 'Quest Declined' },
          },
        ],
        edges: [
          { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_dialogue_greet', portId: 'in' } },
          { from: { nodeId: 'n_dialogue_greet', portId: 'out' }, to: { nodeId: 'n_choice_quest', portId: 'in' } },
          { from: { nodeId: 'n_choice_quest', portId: 'opt_accept' }, to: { nodeId: 'n_set_accepted', portId: 'in' } },
          { from: { nodeId: 'n_choice_quest', portId: 'opt_decline' }, to: { nodeId: 'n_end_decline', portId: 'in' } },
          { from: { nodeId: 'n_set_accepted', portId: 'out' }, to: { nodeId: 'n_wait_dragon', portId: 'in' } },
          { from: { nodeId: 'n_wait_dragon', portId: 'out' }, to: { nodeId: 'n_call_reward', portId: 'in' } },
          { from: { nodeId: 'n_call_reward', portId: 'out' }, to: { nodeId: 'n_end_victory', portId: 'in' } },
        ],
      },
    };

    const compiled = compileStory(sampleDoc);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const examplesDir = path.resolve(__dirname, '../docs/examples');
    if (!fs.existsSync(examplesDir)) {
      fs.mkdirSync(examplesDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(examplesDir, 'sample-quest.story.json'),
      JSON.stringify(sampleDoc, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(examplesDir, 'sample-quest.storyc.json'),
      JSON.stringify(compiled.program, null, 2),
      'utf-8',
    );
  });
});

