import { beforeAll, describe, expect, it } from 'vitest';
import {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  nodeRegistry,
  parseStorySource,
  serializeStorySource,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { compileProject, compileStory } from '../packages/compiler/src';
import { StoryRuntime } from '../packages/runtime/src';
import {
  createGraphClipboard,
  fromSourceGraph,
  pasteGraphClipboard,
} from '../packages/editor/src/renderer/graph/editorGraph';

beforeAll(() => nodeRegistry.registerBuiltins());

function portalStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_portalstory',
    name: 'portal-story',
    displayName: 'Portal Story',
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
          id: 'n_route',
          type: StoryNodeType.Reroute,
          definitionVersion: 1,
          position: { x: 180, y: 0 },
          data: {},
        },
        {
          id: 'n_talk',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 360, y: 0 },
          data: {
            lines: [
              {
                id: 'ln_portaltalk',
                textId: 't_portaltalk',
                text: { source: 'Through the portal' },
              },
            ],
          },
        },
        {
          id: 'n_jump',
          type: StoryNodeType.FlowJump,
          definitionVersion: 1,
          position: { x: 620, y: 0 },
          data: { targetNodeId: 'n_anchor' },
        },
        {
          id: 'n_anchor',
          type: StoryNodeType.FlowAnchor,
          definitionVersion: 1,
          position: { x: 900, y: 0 },
          data: { label: 'After Dialogue' },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 1100, y: 0 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_route', portId: 'in' } },
        { from: { nodeId: 'n_route', portId: 'out' }, to: { nodeId: 'n_talk', portId: 'in' } },
        { from: { nodeId: 'n_talk', portId: 'out' }, to: { nodeId: 'n_jump', portId: 'in' } },
        { from: { nodeId: 'n_anchor', portId: 'out' }, to: { nodeId: 'n_end', portId: 'in' } },
      ],
    },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
  };
}

function portalProject(): StoryProjectDocument {
  return {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: 'p_portalproject',
    name: 'portal-project',
    displayName: 'Portal Project',
    stories: [
      {
        id: 's_portalstory',
        path: 'Stories/portal.story',
        name: 'portal-story',
        displayName: 'Portal Story',
      },
    ],
    characters: [],
    assets: [],
    events: [],
    signals: [],
  };
}

describe('Reroute and Flow Portal', () => {
  it('preserves portal references and reroutes through KDL round trips', () => {
    const serialized = serializeStorySource(portalStory());
    expect(serialized).toContain('reroute n_route');
    expect(serialized).toContain('flow-anchor n_anchor label="After Dialogue"');
    expect(serialized).toContain('flow-jump n_jump target=n_anchor');
    expect(serialized).toContain('position n_jump x=620 y=0');
    expect(serialized).toContain('position n_anchor x=900 y=0');
    expect(parseStorySource(serialized)).toEqual(portalStory());
  });

  it('removes visual nodes while compiling portal flow into executable jumps', () => {
    const result = compileStory(portalStory());
    expect(result.ok, result.diagnostics.map((item) => item.message).join('\n')).toBe(true);
    if (!result.ok) return;
    expect(result.program.blocks).not.toHaveProperty('b_route');
    expect(result.program.blocks).not.toHaveProperty('b_anchor');

    const runtime = new StoryRuntime(result.program);
    expect(runtime.runUntilPause().kind).toBe('waiting');
    expect(runtime.continueDialogue().kind).toBe('completed');
  });

  it('treats the virtual Jump to Anchor link as reachable project control flow', () => {
    const result = compileProject(portalProject(), [
      { path: 'Stories/portal.story', source: portalStory() },
    ]);
    expect(result.ok, result.diagnostics.map((item) => item.message).join('\n')).toBe(true);
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNREACHABLE_NODE' })]),
    );
  });

  it('remaps a copied Jump when its Anchor is copied with it', () => {
    const graph = fromSourceGraph(portalStory().root);
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      selected: node.id === 'n_jump' || node.id === 'n_anchor',
    }));
    const clipboard = createGraphClipboard(graph);
    expect(clipboard).not.toBeNull();
    const pasted = pasteGraphClipboard(graph, clipboard!);
    const pastedJump = pasted.nodes.find(
      (node) => node.type === StoryNodeType.FlowJump && node.id !== 'n_jump',
    );
    const pastedAnchor = pasted.nodes.find(
      (node) => node.type === StoryNodeType.FlowAnchor && node.id !== 'n_anchor',
    );
    expect(pastedJump?.data).toMatchObject({ targetNodeId: pastedAnchor?.id });
  });
});
