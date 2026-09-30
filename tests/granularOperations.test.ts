import { describe, it, expect } from 'vitest';
import {
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type StorySourceDocument,
  type BlueprintCommandTransaction,
} from '@story-blueprint/common';

function createInitialStory(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 'story-granular-test',
    name: 'granular_test',
    displayName: 'Granular Test Story',
    revision: 'rev_initial',
    root: {
      nodes: [
        {
          id: 'n_entry',
          type: StoryNodeType.Start,
          position: { x: 0, y: 0 },
          name: 'Entry',
          data: { title: 'Start' },
        },
        {
          id: 'n_dialogue',
          type: StoryNodeType.Dialogue,
          position: { x: 100, y: 0 },
          name: 'Dialogue 1',
          data: {
            lines: [
              {
                id: 'ln_first',
                textId: 't_first',
                text: { source: 'First line' },
              },
            ],
          },
        },
        {
          id: 'n_choice',
          type: StoryNodeType.Choice,
          position: { x: 200, y: 0 },
          name: 'Choice 1',
          data: {
            prompt: { source: 'Choose an option' },
            options: [
              {
                id: 'opt_first',
                text: { source: 'Option 1' },
              },
            ],
          },
        },
        {
          id: 'n_narration',
          type: StoryNodeType.Narration,
          position: { x: 300, y: 0 },
          name: 'Narration 1',
          data: {
            textId: 't_narr',
            text: { source: 'Original narration' },
          },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_entry', portId: 'out' },
          to: { nodeId: 'n_dialogue', portId: 'in' },
        },
      ],
    },
    assets: [],
    chapters: [],
    variables: [],
    characters: [],
    conditions: [],
    events: [],
    signals: [],
  };
}

describe('Granular AI Operations & Flexible Inputs', () => {
  it('supports add-dialogue-line with plain string text and auto-generated IDs', () => {
    const story = createInitialStory();
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_add_line',
          kind: 'add-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_dialogue',
          line: {
            text: 'Second line added by AI',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();

    const dialogueNode = result.document.root.nodes.find((n) => n.id === 'n_dialogue');
    const lines = (dialogueNode?.data as { lines: Array<{ id: string; text: { source: string }; textId: string }> }).lines;
    expect(lines).toHaveLength(2);
    expect(lines[1]!.text.source).toBe('Second line added by AI');
    expect(lines[1]!.id).toMatch(/^ln_/);
    expect(lines[1]!.textId).toMatch(/^t_/);
  });

  it('supports update-dialogue-line with both string and object text format', () => {
    const story = createInitialStory();
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_update_line',
          kind: 'update-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_dialogue',
          lineId: 'ln_first',
          patch: {
            text: 'Updated first line via string',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics).toEqual([]);

    const dialogueNode = result.document.root.nodes.find((n) => n.id === 'n_dialogue');
    const lines = (dialogueNode?.data as { lines: Array<{ id: string; text: { source: string } }> }).lines;
    expect(lines[0]!.text.source).toBe('Updated first line via string');
  });

  it('supports add-choice-option with plain string text and auto-generated ID', () => {
    const story = createInitialStory();
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_add_opt',
          kind: 'add-choice-option',
          graph: { kind: 'root' },
          nodeId: 'n_choice',
          option: {
            text: 'Option 2 appended by AI',
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics).toEqual([]);

    const choiceNode = result.document.root.nodes.find((n) => n.id === 'n_choice');
    const options = (choiceNode?.data as { options: Array<{ id: string; text: { source: string } }> }).options;
    expect(options).toHaveLength(2);
    expect(options[1]!.text.source).toBe('Option 2 appended by AI');
    expect(options[1]!.id).toMatch(/^o_/);
  });

  it('supports update-node with top-level data/name and auto-wraps narration string text', () => {
    const story = createInitialStory();
    // AI sends update-node with top-level `data` and `name` instead of nesting in `patch`
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_update_narration',
          kind: 'update-node',
          graph: { kind: 'root' },
          nodeId: 'n_narration',
          name: 'Renamed Narration',
          data: {
            text: 'Modified narration text as raw string',
          },
        } as unknown as BlueprintCommandTransaction['operations'][number],
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics).toEqual([]);

    const narrationNode = result.document.root.nodes.find((n) => n.id === 'n_narration');
    expect(narrationNode?.name).toBe('Renamed Narration');
    const narrData = narrationNode?.data as { text: { source: string } };
    expect(narrData.text.source).toBe('Modified narration text as raw string');
  });

  it('gives friendly diagnostic when graph target is missing or malformed', () => {
    const story = createInitialStory();
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_invalid_graph',
          kind: 'add-node',
          graph: 'root' as unknown as { kind: 'root' },
          node: {
            id: 'n_new',
            type: StoryNodeType.Narration,
            name: 'New Node',
            data: { text: { source: 'Hello' } },
          },
        },
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toContain('Expected { "kind": "root" }');
  });

  it('gives helpful diagnostic listing valid kinds when operation kind is unsupported', () => {
    const story = createInitialStory();
    const command: BlueprintCommandTransaction = {
      format: 'story-blueprint-commands',
      version: 1,
      baseRevision: createStorySemanticSnapshot(story).revision,
      operations: [
        {
          operationId: 'op_bad',
          kind: 'addNode' as unknown as 'add-node',
          graph: { kind: 'root' },
        } as unknown as BlueprintCommandTransaction['operations'][number],
      ],
    };

    const result = executeBlueprintCommandTransaction(story, command);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toContain('Supported kinds are:');
    expect(result.diagnostics[0]!.message).toContain('add-dialogue-line');
  });
});
