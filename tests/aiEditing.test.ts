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

  it('adds variables and edits Dialogue lines with stable line and text IDs', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'add-score',
          kind: 'add-variable',
          variable: {
            id: 'v_score',
            name: 'score',
            displayName: 'Score',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
        {
          operationId: 'rewrite-original',
          kind: 'update-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
          lineId: 'ln_original',
          patch: { text: 'Score: {score}', emotion: 'happy', tags: ['ai'] },
        },
        {
          operationId: 'append-line',
          kind: 'add-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
          afterLineId: 'ln_original',
          line: {
            id: 'ln_followup',
            textId: 't_followup',
            text: 'Keep going.',
          },
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.variables).toContainEqual(
      expect.objectContaining({ id: 'v_score', name: 'score', defaultValue: 0 }),
    );
    const dialogue = result.document.root.nodes.find((node) => node.id === 'n_talk');
    expect(dialogue?.data).toMatchObject({
      lines: [
        {
          id: 'ln_original',
          text: { source: 'Score: {score}' },
          emotion: 'happy',
          tags: ['ai'],
        },
        { id: 'ln_followup', textId: 't_followup', text: { source: 'Keep going.' } },
      ],
    });
    expect(source.variables).toEqual([]);
  });

  it('edits Choice options, expressions, and removes an option connection atomically', () => {
    const base = story();
    const source: StorySourceDocument = {
      ...base,
      root: {
        nodes: [
          ...base.root.nodes,
          {
            id: 'n_choice',
            type: StoryNodeType.Choice,
            definitionVersion: 1,
            position: { x: 500, y: 180 },
            data: {
              prompt: { source: 'Choose' },
              options: [{ id: 'o_original', text: { source: 'Original option' } }],
            },
          },
        ],
        edges: [
          ...base.root.edges,
          {
            from: { nodeId: 'n_choice', portId: 'o_original' },
            to: { nodeId: 'n_endxx', portId: 'in' },
          },
        ],
      },
    };
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'add-enabled',
          kind: 'add-variable',
          variable: {
            id: 'v_enabled',
            name: 'enabled',
            displayName: 'Enabled',
            scope: 'story',
            valueType: { kind: 'boolean' },
            defaultValue: true,
          },
        },
        {
          operationId: 'add-option',
          kind: 'add-choice-option',
          graph: { kind: 'root' },
          nodeId: 'n_choice',
          afterOptionId: 'o_original',
          option: { id: 'o_added', text: 'Added option' },
        },
        {
          operationId: 'condition-option',
          kind: 'set-expression',
          graph: { kind: 'root' },
          nodeId: 'n_choice',
          target: { kind: 'choice-enabled', optionId: 'o_added' },
          source: 'enabled',
        },
        {
          operationId: 'remove-original',
          kind: 'remove-choice-option',
          graph: { kind: 'root' },
          nodeId: 'n_choice',
          optionId: 'o_original',
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const choice = result.document.root.nodes.find((node) => node.id === 'n_choice');
    expect(choice?.data).toMatchObject({
      options: [
        {
          id: 'o_added',
          text: { source: 'Added option' },
          enabledIf: { source: 'enabled', bindings: {} },
        },
      ],
    });
    expect(
      result.document.root.edges.some(
        (edge) => edge.from.nodeId === 'n_choice' && edge.from.portId === 'o_original',
      ),
    ).toBe(false);
    expect(source.root.edges.some((edge) => edge.from.portId === 'o_original')).toBe(true);
  });

  it('rejects duplicate variables and invalid default value types without partial changes', () => {
    const source = story();
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'valid-first',
          kind: 'add-variable',
          variable: {
            id: 'v_first',
            name: 'score',
            displayName: 'Score',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
        {
          operationId: 'invalid-second',
          kind: 'add-variable',
          variable: {
            id: 'v_second',
            name: 'other',
            displayName: 'Other',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 'wrong',
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.document).toBe(source);
    expect(source.variables).toEqual([]);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: 'INVALID_TARGET',
        operationId: 'invalid-second',
      });
    }
  });

  it('targets Branch, Set Variable, Event, and Signal expressions explicitly', () => {
    const source = story();
    const graph = { kind: 'root' } as const;
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      operations: [
        {
          operationId: 'add-count',
          kind: 'add-variable',
          variable: {
            id: 'v_count',
            name: 'count',
            displayName: 'Count',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
        {
          operationId: 'rename-count',
          kind: 'update-variable',
          variableId: 'v_count',
          patch: { name: 'total', defaultValue: 1 },
        },
        {
          operationId: 'add-branch',
          kind: 'add-node',
          graph,
          node: {
            id: 'n_branch',
            type: StoryNodeType.Branch,
            data: { condition: { source: 'true', bindings: {} } },
          },
        },
        {
          operationId: 'add-set',
          kind: 'add-node',
          graph,
          node: {
            id: 'n_setvar',
            type: StoryNodeType.SetVariable,
            data: { variableId: 'v_count', value: { source: '0', bindings: {} } },
          },
        },
        {
          operationId: 'add-event',
          kind: 'add-node',
          graph,
          node: {
            id: 'n_event',
            type: StoryNodeType.CallEvent,
            data: { arguments: {} },
          },
        },
        {
          operationId: 'add-signal',
          kind: 'add-node',
          graph,
          node: {
            id: 'n_signal',
            type: StoryNodeType.WaitSignal,
            data: { matches: {} },
          },
        },
        {
          operationId: 'set-branch-expression',
          kind: 'set-expression',
          graph,
          nodeId: 'n_branch',
          target: { kind: 'branch-condition' },
          source: 'total >= 10',
        },
        {
          operationId: 'set-value-expression',
          kind: 'set-expression',
          graph,
          nodeId: 'n_setvar',
          target: { kind: 'set-variable-value' },
          source: 'total + 1',
        },
        {
          operationId: 'set-event-expression',
          kind: 'set-expression',
          graph,
          nodeId: 'n_event',
          target: { kind: 'event-argument', parameterName: 'amount' },
          source: 'total',
        },
        {
          operationId: 'set-signal-expression',
          kind: 'set-expression',
          graph,
          nodeId: 'n_signal',
          target: { kind: 'signal-match', parameterName: 'amount' },
          source: null,
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.variables[0]).toMatchObject({
      name: 'total',
      displayName: 'total',
      defaultValue: 1,
    });
    const dataById = new Map(result.document.root.nodes.map((node) => [node.id, node.data]));
    expect(dataById.get('n_branch')).toMatchObject({ condition: { source: 'total >= 10' } });
    expect(dataById.get('n_setvar')).toMatchObject({ value: { source: 'total + 1' } });
    expect(dataById.get('n_event')).toMatchObject({ arguments: { amount: { source: 'total' } } });
    expect(dataById.get('n_signal')).toMatchObject({ matches: {} });
  });
});
