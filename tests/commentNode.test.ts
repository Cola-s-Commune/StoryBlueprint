import { beforeAll, describe, expect, it } from 'vitest';
import {
  nodeRegistry,
  StoryNodeType,
  parseStorySource,
  serializeStorySource,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  type CommentNodeData,
  type StorySourceDocument,
} from '../packages/common/src';
import { DefaultStoryCompiler } from '../packages/compiler/src';
import {
  buildStorySearchIndex,
  searchStoryIndex,
} from '../packages/editor/src/renderer/graph/storySearch';

beforeAll(() => {
  nodeRegistry.registerBuiltins();
});

function createDoc(nodes: StorySourceDocument['root']['nodes'], edges: StorySourceDocument['root']['edges'] = []): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_test',
    name: 'test',
    displayName: 'Test Story',
    root: {
      nodes,
      edges,
    },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
    signals: [],
  };
}

describe('CommentNode - Blueprint Group / Comment Box', () => {
  it('registers StoryNodeType.Comment in nodeRegistry with correct defaults', () => {
    const def = nodeRegistry.get(StoryNodeType.Comment);
    expect(def).toBeDefined();
    expect(def?.type).toBe(StoryNodeType.Comment);
    expect(def?.category).toBe('flow');
    const defaultData = def?.defaultData() as CommentNodeData;
    expect(defaultData.title).toBe('Comment');
    expect(defaultData.color).toBe('#2a3b4c');
    expect(defaultData.width).toBe(400);
    expect(defaultData.height).toBe(240);
  });

  it('serializes and deserializes comment nodes to/from KDL without data loss', () => {
    const doc = createDoc([
      {
        id: 'n_start',
        type: StoryNodeType.Start,
        definitionVersion: 1,
        position: { x: 0, y: 0 },
        data: { title: 'Start' },
      },
      {
        id: 'n_comment',
        type: StoryNodeType.Comment,
        definitionVersion: 1,
        position: { x: -20, y: -20 },
        data: {
          title: 'NPC Dialogue Zone',
          comment: 'This block handles first encounter with Alice.',
          color: '#34495e',
          width: 600,
          height: 380,
        } as CommentNodeData,
      },
    ]);

    const kdl = serializeStorySource(doc);
    expect(kdl).toContain('comment n_comment');
    expect(kdl).toContain('title="NPC Dialogue Zone"');
    expect(kdl).toContain('comment="This block handles first encounter with Alice."');
    expect(kdl).toContain('color="#34495e"');
    expect(kdl).toContain('width=600');
    expect(kdl).toContain('height=380');

    const parsed = parseStorySource(kdl);
    const commentNode = parsed.root.nodes.find((n) => n.id === 'n_comment');
    expect(commentNode).toBeDefined();
    expect(commentNode?.type).toBe(StoryNodeType.Comment);
    expect(commentNode?.position).toEqual({ x: -20, y: -20 });
    const data = commentNode?.data as CommentNodeData;
    expect(data.title).toBe('NPC Dialogue Zone');
    expect(data.comment).toBe('This block handles first encounter with Alice.');
    expect(data.color).toBe('#34495e');
    expect(data.width).toBe(600);
    expect(data.height).toBe(380);
  });

  it('compiles story containing comment nodes with 0 errors and ignores comment nodes in bytecode', () => {
    const doc = createDoc(
      [
        {
          id: 'n_start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 0, y: 0 },
          data: { title: 'Start' },
        },
        {
          id: 'n_comment_1',
          type: StoryNodeType.Comment,
          definitionVersion: 1,
          position: { x: -50, y: -50 },
          data: {
            title: 'Setup Phase',
            comment: 'Initialize player state',
            color: '#2a3b4c',
            width: 500,
            height: 300,
          },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 200, y: 0 },
          data: { title: 'End' },
        },
      ],
      [
        {
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_end', portId: 'in' },
        },
      ],
    );

    const compiler = new DefaultStoryCompiler();
    const result = compiler.compile(doc);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.program).toBeDefined();
      const allInstructions = Object.values(result.program.blocks).flatMap((b) => b.instructions);
      const commentInstructions = allInstructions.filter(
        (inst) => (inst as any).nodeId === 'n_comment_1',
      );
      expect(commentInstructions.length).toBe(0);
    }
  });

  it('indexes and searches Comment node title and comment text', () => {
    const semanticSnapshot = {
      format: 'story-blueprint-semantic',
      version: 1,
      revision: 'rev_1',
      story: { id: 's1', name: 'demo', displayName: 'Demo Story' },
      variables: [],
      characters: [],
      assets: [],
      events: [],
      signals: [],
      graphs: [
        {
          kind: 'root',
          name: 'root',
          displayName: 'Root',
          connections: [],
          nodes: [
            {
              id: 'n_comment_quest',
              type: StoryNodeType.Comment,
              data: {
                title: '主线任务区域',
                comment: '玩家在此触发第一章主要剧情和分支选择',
              },
              ports: [],
            },
          ],
        },
      ],
    } as any;

    const index = buildStorySearchIndex(semanticSnapshot);

    const titleResults = searchStoryIndex(index, '主线任务');
    expect(titleResults.some((r) => r.nodeId === 'n_comment_quest')).toBe(true);

    const commentResults = searchStoryIndex(index, '第一章主要剧情');
    expect(commentResults.some((r) => r.nodeId === 'n_comment_quest')).toBe(true);
  });
});
