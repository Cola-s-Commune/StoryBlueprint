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
    variables: [],
    characters: [],
    assets: [],
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
    const loaded = parseCompiledStoryProject(json);
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
                speakerId: 'c_missing',
                lines: [
                  {
                    id: 'ln_projecthello',
                    textId: 't_projecthello',
                    text: { source: 'Hello' },
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
        expect.objectContaining({ code: 'INVALID_NODE', sourceNodeId: 'n_projectdialogue' }),
      ]),
    );
  });
});
