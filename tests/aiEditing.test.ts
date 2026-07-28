import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
  validateBlueprintCommandTransaction,
  type BlueprintCommandTransaction,
  type StorySourceDocument,
} from '../packages/common/src';

function story(): StorySourceDocument {
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: 's_ai_editing',
    name: 'ai-editing',
    displayName: 'AI Editing',
    variables: [],
    characters: [],
    assets: [],
    events: [],
    signals: [],
    chapters: [],
    root: {
      nodes: [
        {
          id: 'n_start',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 100, y: 50 },
          data: { title: 'Start' },
        },
        {
          id: 'n_talk',
          type: StoryNodeType.Dialogue,
          definitionVersion: 1,
          position: { x: 340, y: 50 },
          data: {
            lines: [
              {
                id: 'ln_original',
                textId: 't_original',
                text: { source: 'Original' },
              },
            ],
          },
        },
        {
          id: 'n_endxx',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 580, y: 50 },
          data: { title: 'End' },
        },
      ],
      edges: [
        { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_talk', portId: 'in' } },
        { from: { nodeId: 'n_talk', portId: 'out' }, to: { nodeId: 'n_endxx', portId: 'in' } },
      ],
    },
  };
}

function insertionTransaction(baseRevision: string): BlueprintCommandTransaction {
  return {
    format: BLUEPRINT_COMMAND_FORMAT,
    version: BLUEPRINT_COMMAND_VERSION,
    baseRevision,
    operations: [
      {
        operationId: 'disconnect-old-successor',
        kind: 'disconnect',
        graph: { kind: 'root' },
        from: { nodeId: 'n_talk', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
      {
        operationId: 'add-follow-up',
        kind: 'add-node',
        graph: { kind: 'root' },
        node: {
          id: 'n_followup',
          type: StoryNodeType.Dialogue,
          data: {
            lines: [
              {
                id: 'ln_followup',
                textId: 't_followup',
                text: { source: 'Follow up' },
              },
            ],
          },
        },
      },
      {
        operationId: 'connect-follow-up',
        kind: 'connect',
        graph: { kind: 'root' },
        from: { nodeId: 'n_talk', portId: 'out' },
        to: { nodeId: 'n_followup', portId: 'in' },
      },
      {
        operationId: 'connect-end',
        kind: 'connect',
        graph: { kind: 'root' },
        from: { nodeId: 'n_followup', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ],
  };
}

describe('AI semantic editing foundation', () => {
  it('creates a stable semantic view without editor layout fields', () => {
    const snapshot = createStorySemanticSnapshot(story());
    const json = JSON.stringify(snapshot);
    expect(snapshot.revision).toMatch(/^rev_/);
    expect(json).not.toContain('position');
    expect(json).not.toContain('definitionVersion');
    expect(snapshot.graphs[0].nodes.find((node) => node.id === 'n_talk')?.ports).toMatchObject([
      { id: 'in', direction: 'input', kind: 'execution' },
      { id: 'out', direction: 'output', kind: 'execution' },
    ]);
    expect(createStorySemanticSnapshot(story()).revision).toBe(snapshot.revision);
  });

  it('dry-runs an atomic insertion without mutating the source', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const result = executeBlueprintCommandTransaction(source, insertionTransaction(revision), {
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.committed).toBe(false);
    expect(source.root.nodes).toHaveLength(3);
    expect(result.document.root.nodes).toHaveLength(4);
    expect(result.document.root.edges).toContainEqual({
      from: { nodeId: 'n_followup', portId: 'out' },
      to: { nodeId: 'n_endxx', portId: 'in' },
    });
    expect(result.snapshot.revision).not.toBe(revision);
  });

  it('rolls back every operation when a later command is invalid', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'rename-first',
          kind: 'update-node',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
          patch: { name: 'renamed' },
        },
        {
          operationId: 'bad-connection',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_talk', portId: 'missing' },
          to: { nodeId: 'n_endxx', portId: 'in' },
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(false);
    expect(result.document).toBe(source);
    expect(source.root.nodes.find((node) => node.id === 'n_talk')?.name).toBeUndefined();
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({
      code: 'INVALID_CONNECTION',
      operationId: 'bad-connection',
    });
  });

  it('updates and removes nodes while cleaning and rebuilding their connections', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'rename-ending',
          kind: 'update-node',
          graph: { kind: 'root' },
          nodeId: 'n_endxx',
          patch: { name: 'ending', data: { title: 'Finished' } },
        },
        {
          operationId: 'remove-dialogue',
          kind: 'remove-node',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
        },
        {
          operationId: 'connect-directly',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_start', portId: 'out' },
          to: { nodeId: 'n_endxx', portId: 'in' },
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.committed).toBe(true);
    expect(result.document.root.nodes.some((node) => node.id === 'n_talk')).toBe(false);
    expect(result.document.root.nodes.find((node) => node.id === 'n_endxx')).toMatchObject({
      name: 'ending',
      data: { title: 'Finished' },
    });
    expect(result.document.root.edges).toEqual([
      { from: { nodeId: 'n_start', portId: 'out' }, to: { nodeId: 'n_endxx', portId: 'in' } },
    ]);
    expect(source.root.nodes).toHaveLength(3);
  });

  it('rejects stale revisions and malformed or duplicated operations', () => {
    const source = story();
    const stale = executeBlueprintCommandTransaction(source, insertionTransaction('rev_stale'));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics[0].code).toBe('REVISION_CONFLICT');

    const diagnostics = validateBlueprintCommandTransaction({
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'same',
          kind: 'remove-node',
          graph: { kind: 'root' },
          nodeId: 'not-an-id',
        },
        {
          operationId: 'same',
          kind: 'remove-node',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
        },
      ],
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'DUPLICATE_OPERATION_ID')).toBe(
      true,
    );
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'INVALID_TRANSACTION')).toBe(true);
  });
});
