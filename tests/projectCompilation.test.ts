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
});
