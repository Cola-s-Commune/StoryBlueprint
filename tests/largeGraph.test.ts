import { performance } from 'node:perf_hooks';
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
  type NodeId,
  type SourceEdge,
  type SourceNode,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '../packages/common/src';
import { compileProject } from '../packages/compiler/src';
import {
  autoLayoutGraph,
  fromSourceGraph,
  toSourceGraph,
} from '../packages/editor/src/renderer/graph/editorGraph';

const LARGE_GRAPH_NODE_COUNT = 1_000;
const OPERATION_BUDGET_MS = 5_000;

beforeAll(() => nodeRegistry.registerBuiltins());

function nodeId(index: number): NodeId {
  return `n_large_${index.toString().padStart(4, '0')}` as NodeId;
}

function largeStory(): StorySourceDocument {
  const nodes: SourceNode[] = Array.from({ length: LARGE_GRAPH_NODE_COUNT }, (_, index) => {
    const id = nodeId(index);
    if (index === 0) {
      return {
        id,
        type: StoryNodeType.Start,
        definitionVersion: 1,
        position: { x: 0, y: 0 },
        data: { title: 'Start' },
      };
    }
    if (index === LARGE_GRAPH_NODE_COUNT - 1) {
      return {
        id,
        type: StoryNodeType.End,
        definitionVersion: 1,
        position: { x: 0, y: 0 },
        data: { title: 'End' },
      };
    }
    return {
      id,
      type: StoryNodeType.Dialogue,
      definitionVersion: 1,
      position: { x: (index % 20) * 280, y: Math.floor(index / 20) * 150 },
      data: {
        lines: [
          {
            id: `ln_large_${index.toString().padStart(4, '0')}`,
            textId: `t_large_${index.toString().padStart(4, '0')}`,
            text: { source: `Dialogue line ${index}` },
          },
        ],
      },
    };
  });
  const edges: SourceEdge[] = Array.from({ length: LARGE_GRAPH_NODE_COUNT - 1 }, (_, index) => ({
    from: { nodeId: nodeId(index), portId: 'out' },
    to: { nodeId: nodeId(index + 1), portId: 'in' },
  }));
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_large_graph',
    name: 'large-graph',
    displayName: 'Large Graph',
    root: { nodes, edges },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
    signals: [],
  };
}

function largeProject(): StoryProjectDocument {
  return {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: 'p_large_graph',
    name: 'large-graph',
    displayName: 'Large Graph',
    entryStoryId: 's_large_graph',
    stories: [
      {
        id: 's_large_graph',
        path: 'large.story',
        name: 'large-graph',
        displayName: 'Large Graph',
      },
    ],
    characters: [],
    assets: [],
    variables: [],
    events: [],
    signals: [],
  };
}

function measure<T>(work: () => T): { value: T; duration: number } {
  const start = performance.now();
  const value = work();
  return { value, duration: performance.now() - start };
}

describe('large graph performance baseline', () => {
  it('round-trips, loads, lays out, and compiles a 1000-node Story within bounded time', () => {
    const story = largeStory();
    const serialized = measure(() => serializeStorySource(story));
    const parsed = measure(() => parseStorySource(serialized.value));
    const loaded = measure(() => fromSourceGraph(parsed.value.root));
    const arranged = measure(() => autoLayoutGraph(loaded.value));
    const saved = measure(() => toSourceGraph(arranged.value));
    const compiled = measure(() =>
      compileProject(largeProject(), [{ path: 'large.story', source: parsed.value }]),
    );

    expect(parsed.value.root.nodes).toHaveLength(LARGE_GRAPH_NODE_COUNT);
    expect(loaded.value.edges).toHaveLength(LARGE_GRAPH_NODE_COUNT - 1);
    expect(saved.value.nodes).toHaveLength(LARGE_GRAPH_NODE_COUNT);
    expect(compiled.value.ok, compiled.value.ok ? undefined : compiled.value.diagnostics).toBe(
      true,
    );
    const positions = new Map(arranged.value.nodes.map((node) => [node.id, node.position]));
    for (let index = 1; index < LARGE_GRAPH_NODE_COUNT; index += 1) {
      expect(positions.get(nodeId(index))!.x).toBeGreaterThan(positions.get(nodeId(index - 1))!.x);
    }

    const timings = {
      serialize: serialized.duration,
      parse: parsed.duration,
      load: loaded.duration,
      layout: arranged.duration,
      save: saved.duration,
      compile: compiled.duration,
    };
    for (const [operation, duration] of Object.entries(timings)) {
      expect(duration, `${operation}: ${duration.toFixed(1)}ms`).toBeLessThan(OPERATION_BUDGET_MS);
    }
  }, 30_000);
});
