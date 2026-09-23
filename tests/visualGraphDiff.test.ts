import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  nodeRegistry,
  parseStorySource,
  serializeStorySource,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type StorySourceDocument,
} from '@story-blueprint/common';
import { readStoryGitHead } from '../packages/editor/src/main/storyGitConflict';
import {
  diffStoryDocuments,
  type StoryMergeDecisions,
} from '../packages/editor/src/renderer/graph/storyMerge';
import { buildStoryMergePreview } from '../packages/editor/src/renderer/graph/storyMergePreview';
import { getNodeDiffKind } from '../packages/editor/src/renderer/components/Panels/graphMinimap';

nodeRegistry.registerBuiltins();

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createBaseStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_visual_diff',
    name: 'visual_diff',
    displayName: 'Visual Diff Story',
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
          id: 'n_dialogue_1',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: {
            lines: [{ id: 'ln_dialogue_1', textId: 't_dialogue_1', text: { source: 'Original line' } }],
          },
        },
        {
          id: 'n_deleted_node',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 400, y: 0 },
          data: {
            lines: [{ id: 'ln_deleted_node', textId: 't_deleted_node', text: { source: 'Will be deleted' } }],
          },
        },
      ],
      edges: [
        {
          id: 'e_edge1',
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_dialogue_1', portId: 'in' },
        },
        {
          id: 'e_to_delete',
          from: { nodeId: 'n_dialogue_1', portId: 'out' },
          to: { nodeId: 'n_deleted_node', portId: 'in' },
        },
      ],
    },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
  };
}

describe('Visual Graph Diff Preview', () => {
  describe('readStoryGitHead', () => {
    it('reads the HEAD version of a tracked story from a real Git repository', async () => {
      const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-head-'));
      temporaryDirectories.push(repository);
      const storyPath = join(repository, 'main.story');

      await git(repository, 'init', '--initial-branch=main');
      await git(repository, 'config', 'user.email', 'test@example.invalid');
      await git(repository, 'config', 'user.name', 'Diff Test');

      const initialSource = serializeStorySource(createBaseStory());
      await writeFile(storyPath, initialSource, 'utf8');
      await git(repository, 'add', 'main.story');
      await git(repository, 'commit', '-m', 'commit-1');

      // Now modify the working copy
      await writeFile(storyPath, `${initialSource}\n// modified locally`, 'utf8');

      const headContent = await readStoryGitHead(storyPath);
      expect(headContent).toBe(initialSource);
    });

    it('returns undefined for files not yet committed to Git HEAD', async () => {
      const repository = await mkdtemp(join(tmpdir(), 'story-blueprint-git-uncommitted-'));
      temporaryDirectories.push(repository);
      const storyPath = join(repository, 'untracked.story');

      await git(repository, 'init', '--initial-branch=main');
      await writeFile(storyPath, 'uncommitted', 'utf8');

      const headContent = await readStoryGitHead(storyPath);
      expect(headContent).toBeUndefined();
    });
  });

  describe('diffStoryDocuments and buildStoryMergePreview for Visual Graph Diff', () => {
    it('accurately identifies added, changed, and removed nodes and edges against HEAD', () => {
      const headStory = createBaseStory();

      // Working copy:
      // - n_dialogue_1 is modified ('Modified line')
      // - n_deleted_node is removed
      // - n_added_node is added
      // - e_to_delete is removed
      // - e_new_edge is added
      const workingStory: StorySourceDocument = {
        ...headStory,
        root: {
          nodes: [
            headStory.root.nodes[0],
            {
              ...headStory.root.nodes[1],
              data: {
                lines: [{ id: 'ln_dialogue_1', textId: 't_dialogue_1', text: { source: 'Modified line' } }],
              },
            },
            {
              id: 'n_added_node',
              type: StoryNodeType.Dialogue,
              definitionVersion: 1,
              position: { x: 500, y: 100 },
              data: {
                lines: [{ id: 'ln_added_node', textId: 't_added_node', text: { source: 'Brand new node' } }],
              },
            },
          ],
          edges: [
            headStory.root.edges[0],
            {
              id: 'e_new_edge',
              from: { nodeId: 'n_dialogue_1', portId: 'out' },
              to: { nodeId: 'n_added_node', portId: 'in' },
            },
          ],
        },
      };

      const conflicts = diffStoryDocuments(headStory, workingStory);
      expect(conflicts.length).toBeGreaterThan(0);

      // In 2-way Visual Diff against HEAD, differences default to keeping the working copy
      const decisions: StoryMergeDecisions = Object.fromEntries(
        conflicts.map((conflict) => [conflict.id, 'remote']),
      );

      const preview = buildStoryMergePreview(headStory, workingStory, conflicts, decisions, workingStory);
      expect(preview.graphs).toHaveLength(1);

      const rootGraph = preview.graphs[0];
      expect(rootGraph.addedNodeIds).toContain('n_added_node');
      expect(rootGraph.changedNodeIds).toContain('n_dialogue_1');
      expect(rootGraph.removedNodeIds).toContain('n_deleted_node');

      expect(rootGraph.addedEdgeIds.length).toBeGreaterThanOrEqual(1);
      expect(rootGraph.removedEdgeIds.length).toBeGreaterThanOrEqual(1);

      // Verify that Minimap diff resolver correctly classifies them
      expect(getNodeDiffKind('n_added_node', rootGraph)).toBe('added');
      expect(getNodeDiffKind('n_dialogue_1', rootGraph)).toBe('modified');
      expect(getNodeDiffKind('n_deleted_node', rootGraph)).toBe('removed');
      expect(getNodeDiffKind('n_start', rootGraph)).toBeUndefined();
    });

    it('reports empty conflicts when working story is identical to HEAD', () => {
      const serialized = serializeStorySource(createBaseStory());
      const headStory = parseStorySource(serialized);
      const workingStory = parseStorySource(serialized);

      const conflicts = diffStoryDocuments(headStory, workingStory);
      expect(conflicts).toHaveLength(0);
    });
  });
});
