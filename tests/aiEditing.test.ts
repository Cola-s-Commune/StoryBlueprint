import { describe, expect, it } from 'vitest';
import { compileStory } from '../packages/compiler/src';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_JSON_SCHEMA,
  BLUEPRINT_COMMAND_VERSION,
  blueprintOperationFingerprint,
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
  it('creates a Substory through one validated transaction', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'add-substory',
          kind: 'add-substory',
          substory: {
            id: 'ch_intro',
            name: 'intro',
            displayName: 'Intro',
            parameters: [],
            outputs: [],
            localVariables: [],
            nodes: [
              { id: 'n_sub_start', type: StoryNodeType.Start, data: { title: 'Entry' } },
              { id: 'n_sub_return', type: StoryNodeType.Return, data: { values: {} } },
            ],
            edges: [
              {
                from: { nodeId: 'n_sub_start', portId: 'out' },
                to: { nodeId: 'n_sub_return', portId: 'in' },
              },
            ],
          },
        },
      ],
    };
    expect(validateBlueprintCommandTransaction(transaction)).toEqual([]);
    const result = executeBlueprintCommandTransaction(source, transaction, { dryRun: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.document.chapters).toHaveLength(1);
    expect(result.document.chapters[0]?.graph.nodes).toHaveLength(2);
  });

  it('refactors a Substory interface and removes obsolete typed links atomically', () => {
    const source = story();
    source.variables = [
      {
        id: 'v_root_result',
        name: 'rootResult',
        displayName: 'Root Result',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    source.root.nodes = [
      ...source.root.nodes,
      {
        id: 'n_call_refactor',
        type: StoryNodeType.CallSubstory,
        definitionVersion: 1,
        position: { x: 820, y: 50 },
        data: {
          chapterId: 'ch_refactor',
          arguments: { v_input: { source: '1', bindings: {} } },
          argumentInputTypes: { v_input: { kind: 'number' } },
          outputPorts: [{ id: 'v_output', label: 'Output', valueType: { kind: 'number' } }],
          resultVariableIds: { v_output: 'v_root_result' },
        },
      },
    ];
    source.root.edges = [
      {
        from: { nodeId: 'n_start', portId: 'out' },
        to: { nodeId: 'n_talk', portId: 'in' },
      },
      {
        from: { nodeId: 'n_talk', portId: 'out' },
        to: { nodeId: 'n_call_refactor', portId: 'in' },
      },
      {
        from: { nodeId: 'n_call_refactor', portId: 'out' },
        to: { nodeId: 'n_endxx', portId: 'in' },
      },
    ];
    source.chapters = [
      {
        id: 'ch_refactor',
        name: 'refactor',
        displayName: 'Refactor',
        parameters: [
          {
            direction: 'input',
            variable: {
              id: 'v_input',
              name: 'input',
              displayName: 'Input',
              scope: 'local',
              valueType: { kind: 'number' },
              defaultValue: 1,
            },
          },
        ],
        outputs: [
          {
            direction: 'output',
            variable: {
              id: 'v_output',
              name: 'output',
              displayName: 'Output',
              scope: 'local',
              valueType: { kind: 'number' },
              defaultValue: 1,
            },
          },
        ],
        localVariables: [
          {
            id: 'v_local',
            name: 'local',
            displayName: 'Local',
            scope: 'local',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        ],
        graph: {
          nodes: [
            {
              id: 'n_refactor_start',
              type: StoryNodeType.Start,
              definitionVersion: 1,
              position: { x: 0, y: 0 },
              data: { title: 'Entry' },
            },
            {
              id: 'n_refactor_set',
              type: StoryNodeType.SetVariable,
              definitionVersion: 1,
              position: { x: 240, y: 0 },
              data: {
                variableId: 'v_local',
                value: { source: 'input + 1', bindings: {} },
              },
            },
            {
              id: 'n_refactor_return',
              type: StoryNodeType.Return,
              definitionVersion: 1,
              position: { x: 480, y: 0 },
              data: {
                values: { v_output: { source: 'local', bindings: {} } },
                valueInputTypes: { v_output: { kind: 'number' } },
              },
            },
          ],
          edges: [
            {
              from: { nodeId: 'n_refactor_start', portId: 'out' },
              to: { nodeId: 'n_refactor_set', portId: 'in' },
            },
            {
              from: { nodeId: 'n_refactor_set', portId: 'out' },
              to: { nodeId: 'n_refactor_return', portId: 'in' },
            },
          ],
        },
      },
    ];
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'refactor-interface',
          kind: 'update-substory',
          chapterId: 'ch_refactor',
          patch: {
            displayName: 'Refactored',
            parameters: [
              {
                id: 'v_input',
                name: 'amount',
                displayName: 'Amount',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 2,
              },
            ],
            outputs: [],
            localVariables: [
              {
                id: 'v_local',
                name: 'local',
                displayName: 'Local',
                scope: 'local',
                valueType: { kind: 'number' },
                defaultValue: 0,
              },
            ],
          },
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.document.chapters[0]?.displayName).toBe('Refactored');
    expect(result.document.chapters[0]?.parameters[0]?.variable.name).toBe('amount');
    expect(result.document.chapters[0]?.outputs).toEqual([]);
    const call = result.document.root.nodes.find((node) => node.id === 'n_call_refactor');
    expect((call?.data as { outputPorts?: unknown }).outputPorts).toEqual([]);
    expect((call?.data as { arguments?: Record<string, { source: string }> }).arguments).toEqual({
      v_input: { source: '1', bindings: {} },
    });
    expect(result.document.root.edges).toHaveLength(3);
    const set = result.document.chapters[0]?.graph.nodes.find(
      (node) => node.id === 'n_refactor_set',
    );
    expect((set?.data as { value?: unknown }).value).toEqual({
      source: 'amount + 1',
      bindings: {},
    });
  });

  it('accepts recursive Struct variables', () => {
    const source = story();
    source.characters = [{ id: 'c_hero', name: 'hero', displayName: 'Hero', emotions: {} }];
    const revision = createStorySemanticSnapshot(source).revision;
    const payloadType = {
      kind: 'struct' as const,
      name: 'Payload',
      fields: {
        actor: { kind: 'character-ref' as const },
        scores: {
          kind: 'map' as const,
          keyType: 'string' as const,
          valueType: { kind: 'number' as const },
        },
      },
    };
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'add-struct-variable',
          kind: 'add-variable',
          variable: {
            id: 'v_payload',
            name: 'payload',
            displayName: 'Payload',
            scope: 'story',
            valueType: payloadType,
            defaultValue: { actor: 'c_hero', scores: { affinity: 1 } },
          },
        },
      ],
    };
    expect(validateBlueprintCommandTransaction(transaction)).toEqual([]);
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.variables[0]).toMatchObject({
      valueType: payloadType,
      defaultValue: { actor: 'c_hero', scores: { affinity: 1 } },
    });
  });

  it('creates, updates, and removes reusable condition resources', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const add: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'add-condition',
          kind: 'add-condition',
          condition: {
            id: 'cond_has_key',
            name: 'hasKey',
            displayName: 'Has Key',
            root: {
              kind: 'all',
              children: [{ kind: 'expression', expression: { source: 'true', bindings: {} } }],
            },
          },
        },
      ],
    };
    expect(validateBlueprintCommandTransaction(add)).toEqual([]);
    const added = executeBlueprintCommandTransaction(source, add);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.document.conditions).toHaveLength(1);

    const updated = executeBlueprintCommandTransaction(added.document, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: added.snapshot.revision,
      operations: [
        {
          operationId: 'update-condition',
          kind: 'update-condition',
          conditionId: 'cond_has_key',
          patch: {
            description: 'The player owns the key.',
            root: {
              kind: 'not',
              child: { kind: 'expression', expression: { source: 'false', bindings: {} } },
            },
          },
        },
      ],
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.document.conditions?.[0]).toMatchObject({
      description: 'The player owns the key.',
      root: { kind: 'not' },
    });

    const removed = executeBlueprintCommandTransaction(updated.document, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: updated.snapshot.revision,
      operations: [
        { operationId: 'remove-condition', kind: 'remove-condition', conditionId: 'cond_has_key' },
      ],
    });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.document.conditions).toEqual([]);
  });

  it('rejects condition reference cycles while applying AI operations', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'add-condition-a',
          kind: 'add-condition',
          condition: {
            id: 'cond_aaa',
            name: 'a',
            displayName: 'A',
            root: { kind: 'reference', conditionId: 'cond_bbb' },
          },
        },
        {
          operationId: 'add-condition-b',
          kind: 'add-condition',
          condition: {
            id: 'cond_bbb',
            name: 'b',
            displayName: 'B',
            root: { kind: 'reference', conditionId: 'cond_aaa' },
          },
        },
      ],
    };
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain(
      'Condition reference cycle detected: cond_aaa -> cond_bbb -> cond_aaa',
    );
    expect(result.document.conditions ?? []).toEqual([]);
  });

  it('rejects removing a condition that is referenced by the graph or another condition', () => {
    const source = story();
    const sourceWithReferences: StorySourceDocument = {
      ...source,
      conditions: [
        {
          id: 'cond_child',
          name: 'child',
          displayName: 'Child',
          root: { kind: 'expression', expression: { source: 'true', bindings: {} } },
        },
        {
          id: 'cond_parent',
          name: 'parent',
          displayName: 'Parent',
          root: { kind: 'reference', conditionId: 'cond_child' },
        },
      ],
      root: {
        ...source.root,
        nodes: [
          ...source.root.nodes,
          {
            id: 'n_branch_ref',
            type: StoryNodeType.Branch,
            definitionVersion: 1,
            position: { x: 820, y: 50 },
            data: {
              condition: { source: 'true', bindings: {} },
              conditionId: 'cond_child',
            },
          },
        ],
      },
    };
    const result = executeBlueprintCommandTransaction(sourceWithReferences, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(sourceWithReferences).revision,
      operations: [
        {
          operationId: 'remove-referenced-condition',
          kind: 'remove-condition',
          conditionId: 'cond_child',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toBe('Condition is still referenced: cond_child');
    expect(result.document.conditions).toHaveLength(2);
  });

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

  it('returns validated layout requests without letting AI write coordinates', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'layout-selected-story-beat',
          kind: 'layout-selection',
          graph: { kind: 'root' },
          nodeIds: ['n_start', 'n_talk'],
        },
        {
          operationId: 'layout-around-dialogue',
          kind: 'layout-neighborhood',
          graph: { kind: 'root' },
          nodeIds: ['n_talk'],
        },
      ],
    };
    expect(validateBlueprintCommandTransaction(transaction)).toEqual([]);
    const result = executeBlueprintCommandTransaction(source, transaction, { dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layoutRequests).toEqual(transaction.operations);
    expect(result.document.root.nodes.map((node) => node.position)).toEqual(
      source.root.nodes.map((node) => node.position),
    );
    expect(result.snapshot.revision).toBe(revision);
    expect(JSON.stringify(transaction)).not.toContain('position');
  });

  it('supports an explicit read-only graph validation command', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'validate-root-graph',
          kind: 'validate-graph',
          graph: { kind: 'root' },
        },
      ],
    };
    expect(validateBlueprintCommandTransaction(transaction)).toEqual([]);
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readOnly).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.snapshot.revision).toBe(revision);
    expect(result.document).not.toBe(source);
    expect(result.document.root).toEqual(source.root);
    expect(result.document.variables).toEqual(source.variables);

    const invalidSource: StorySourceDocument = {
      ...source,
      root: {
        ...source.root,
        nodes: source.root.nodes.filter((node) => node.type !== StoryNodeType.Start),
      },
    };
    const invalidRevision = createStorySemanticSnapshot(invalidSource).revision;
    const invalid = executeBlueprintCommandTransaction(invalidSource, {
      ...transaction,
      baseRevision: invalidRevision,
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.committed).toBe(false);
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_GRAPH',
          message: expect.stringContaining('exactly one Story Entry'),
        }),
      ]),
    );
    expect(invalidSource.root.nodes).toHaveLength(source.root.nodes.length - 1);
  });

  it('reorders dialogue lines and choice options without recreating stable IDs', () => {
    const source = story();
    const dialogue = source.root.nodes.find((node) => node.type === StoryNodeType.Dialogue)!;
    const withDialogue: StorySourceDocument = {
      ...source,
      root: {
        ...source.root,
        nodes: source.root.nodes.map((node) =>
          node.id === dialogue.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  lines: [
                    ...(node.data as { lines: readonly unknown[] }).lines,
                    { id: 'ln_second', textId: 't_second_line', text: { source: 'Second line' } },
                  ],
                },
              }
            : node,
        ),
      },
    };
    const choice = {
      id: 'n_choice',
      type: StoryNodeType.Choice,
      definitionVersion: 1,
      position: { x: 560, y: 50 },
      data: {
        prompt: { source: 'Choose', bindings: {} },
        options: [
          { id: 'o_first', textId: 't_first', text: { source: 'First', bindings: {} } },
          { id: 'o_second', textId: 't_second', text: { source: 'Second', bindings: {} } },
          { id: 'o_third', textId: 't_third', text: { source: 'Third', bindings: {} } },
        ],
      },
    } as const;
    const withChoice: StorySourceDocument = {
      ...withDialogue,
      root: { ...withDialogue.root, nodes: [...withDialogue.root.nodes, choice] },
    };
    const revision = createStorySemanticSnapshot(withChoice).revision;
    const result = executeBlueprintCommandTransaction(withChoice, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'move-line-to-front',
          kind: 'move-dialogue-line',
          graph: { kind: 'root' },
          nodeId: dialogue.id,
          lineId: 'ln_original',
          afterLineId: undefined,
        },
        {
          operationId: 'move-option-to-front',
          kind: 'move-choice-option',
          graph: { kind: 'root' },
          nodeId: choice.id,
          optionId: 'o_third',
          afterOptionId: null,
        },
      ],
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(
      (result.document.root.nodes.find((node) => node.id === dialogue.id)!.data as any).lines.map(
        (line: { id: string }) => line.id,
      ),
    ).toEqual(['ln_second', 'ln_original']);
    expect(
      (result.document.root.nodes.find((node) => node.id === choice.id)!.data as any).options.map(
        (option: { id: string }) => option.id,
      ),
    ).toEqual(['o_third', 'o_first', 'o_second']);
  });

  it('rejects invalid reorder anchors and moving an item after itself', () => {
    const source = story();
    const revision = createStorySemanticSnapshot(source).revision;
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [
        {
          operationId: 'move-line-after-missing',
          kind: 'move-dialogue-line',
          graph: { kind: 'root' },
          nodeId: 'n_talk',
          lineId: 'ln_original',
          afterLineId: 'ln_missing',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_LINE' });
  });

  it('rejects layout requests that target a missing node', () => {
    const source = story();
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'layout-missing-node',
          kind: 'layout-selection',
          graph: { kind: 'root' },
          nodeIds: ['n_missing'],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_NODE' });
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

  it('treats a complete retry as an idempotent no-op and never records dry runs', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'add-idempotent-variable',
          kind: 'add-variable',
          variable: {
            id: 'v_idempotent',
            name: 'idempotent',
            displayName: 'Idempotent',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
      ],
    };
    const first = executeBlueprintCommandTransaction(source, transaction);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const ledger = new Map([
      [
        transaction.operations[0]!.operationId,
        blueprintOperationFingerprint(transaction.operations[0]),
      ],
    ]);
    const retry = executeBlueprintCommandTransaction(first.document, transaction, {
      appliedOperationIds: ledger,
    });
    expect(retry).toMatchObject({ ok: true, committed: false });
    if (retry.ok) expect(retry.document).toBe(first.document);

    const dryRun = executeBlueprintCommandTransaction(source, transaction, {
      dryRun: true,
      appliedOperationIds: ledger,
    });
    expect(dryRun).toMatchObject({ ok: true, committed: false });
    if (dryRun.ok) expect(dryRun.document.variables).toHaveLength(1);
  });

  it('rejects partial and conflicting idempotency replays atomically', () => {
    const source = story();
    const firstTransaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'first-replayed-operation',
          kind: 'add-variable',
          variable: {
            id: 'v_replayed',
            name: 'replayed',
            displayName: 'Replayed',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
      ],
    };
    const first = executeBlueprintCommandTransaction(source, firstTransaction);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const ledger = new Map([
      [
        firstTransaction.operations[0]!.operationId,
        blueprintOperationFingerprint(firstTransaction.operations[0]),
      ],
    ]);
    const partial: BlueprintCommandTransaction = {
      ...firstTransaction,
      baseRevision: createStorySemanticSnapshot(first.document).revision,
      operations: [
        ...firstTransaction.operations,
        {
          operationId: 'new-operation',
          kind: 'add-variable',
          variable: {
            id: 'v_new',
            name: 'newValue',
            displayName: 'New Value',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 1,
          },
        },
      ],
    };
    const partialResult = executeBlueprintCommandTransaction(first.document, partial, {
      appliedOperationIds: ledger,
    });
    expect(partialResult.ok).toBe(false);
    expect(partialResult.document).toBe(first.document);
    expect(first.document.variables).toHaveLength(1);
    if (!partialResult.ok) expect(partialResult.diagnostics[0]?.code).toBe('INVALID_TRANSACTION');

    const conflicting: BlueprintCommandTransaction = {
      ...firstTransaction,
      baseRevision: createStorySemanticSnapshot(first.document).revision,
      operations: [
        {
          operationId: 'first-replayed-operation',
          kind: 'add-variable',
          variable: {
            id: 'v_replayed',
            name: 'replayed',
            displayName: 'Replayed',
            scope: 'story',
            valueType: { kind: 'number' },
            defaultValue: 99,
          },
        },
      ],
    };
    const conflictingResult = executeBlueprintCommandTransaction(first.document, conflicting, {
      appliedOperationIds: ledger,
    });
    expect(conflictingResult.ok).toBe(false);
    expect(conflictingResult.document).toBe(first.document);
    if (!conflictingResult.ok) {
      expect(conflictingResult.diagnostics[0]?.message).toContain('different content');
    }
  });

  it('rolls back every operation when a later command is invalid', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
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
      baseRevision: createStorySemanticSnapshot(source).revision,
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
      baseRevision: createStorySemanticSnapshot(source).revision,
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

  it('reports guessed AI envelopes and extra node ports in one validation pass', () => {
    expect(BLUEPRINT_COMMAND_JSON_SCHEMA.required).toEqual([
      'format',
      'version',
      'baseRevision',
      'operations',
    ]);
    const guessed = validateBlueprintCommandTransaction({ commands: [] });
    expect(guessed.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining(['commands', 'format', 'version', 'baseRevision', 'operations']),
    );
    expect(guessed.find((diagnostic) => diagnostic.path === 'commands')?.message).toContain(
      'operations',
    );

    const malformedOperation = validateBlueprintCommandTransaction({
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(story()).revision,
      operations: [
        {
          operationId: 'guessed-add',
          kind: 'add-node',
          graph: 'root',
          node: {
            id: 'n_guessed',
            type: StoryNodeType.Dialogue,
            data: { lines: [] },
            ports: [],
          },
        },
      ],
    });
    expect(malformedOperation.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining(['operations.0.graph', 'operations.0.node.ports']),
    );
  });

  it('uses resolved project resources for AI revision, snapshot, and compiler validation', () => {
    const base = story();
    const source: StorySourceDocument = {
      ...base,
      root: {
        ...base.root,
        nodes: base.root.nodes.map((node) =>
          node.id === 'n_talk'
            ? {
                ...node,
                data: {
                  lines: [
                    {
                      id: 'ln_original',
                      textId: 't_original',
                      text: { source: 'Existing project character line' },
                      speakerId: 'c_external',
                    },
                  ],
                },
              }
            : node,
        ),
      },
    };
    const semanticContext = {
      characters: [
        {
          id: 'c_external' as const,
          name: 'external',
          displayName: 'External Character',
          emotions: {},
        },
      ],
      assets: [],
      events: [],
      signals: [],
    };
    const revision = createStorySemanticSnapshot({ ...source, ...semanticContext }).revision;
    const result = executeBlueprintCommandTransaction(
      source,
      {
        format: BLUEPRINT_COMMAND_FORMAT,
        version: BLUEPRINT_COMMAND_VERSION,
        baseRevision: revision,
        operations: [
          {
            operationId: 'append-external-speaker-line',
            kind: 'add-dialogue-line',
            graph: { kind: 'root' },
            nodeId: 'n_talk',
            line: {
              id: 'ln_external',
              textId: 't_external',
              text: 'New project character line',
              speakerId: 'c_external',
            },
          },
        ],
      },
      { dryRun: true, semanticContext },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.characters).toContainEqual(
      expect.objectContaining({ id: 'c_external', name: 'external' }),
    );
    const unresolved = compileStory(result.document).diagnostics.filter((diagnostic) =>
      diagnostic.message.includes('missing character'),
    );
    const resolved = compileStory({ ...result.document, ...semanticContext }).diagnostics.filter(
      (diagnostic) => diagnostic.message.includes('missing character'),
    );
    expect(unresolved.length).toBeGreaterThan(0);
    expect(resolved).toEqual([]);
    expect(result.document.characters).toEqual([]);
  });

  it('adds and updates characters with stable Character fields', () => {
    const source = story();
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'add-alice',
          kind: 'add-character',
          character: {
            id: 'c_alice',
            name: 'Alice',
            displayName: 'Alice',
            description: 'A patient investigator.',
            relationships: {
              c_bob: { label: 'Reluctant partner', description: 'Trust is still developing.' },
            },
            emotions: {},
            fields: [
              {
                id: 'v_affinity',
                name: 'affinity',
                displayName: 'Affinity',
                scope: 'character',
                valueType: { kind: 'number' },
                defaultValue: 0,
              },
            ],
          },
        },
        {
          operationId: 'add-bob',
          kind: 'add-character',
          character: {
            id: 'c_bob',
            name: 'Bob',
            displayName: 'Bob',
            emotions: {},
            fields: [
              {
                id: 'v_profile',
                name: 'profile',
                displayName: 'Profile',
                scope: 'character',
                valueType: {
                  kind: 'struct',
                  name: 'Profile',
                  fields: { rank: { kind: 'number' } },
                },
                defaultValue: { rank: 1 },
              },
            ],
          },
        },
        {
          operationId: 'rename-alice-field',
          kind: 'update-character',
          characterId: 'c_alice',
          patch: {
            dialogueStyle: 'Short sentences with dry humor.',
            tags: ['investigator', 'party-member'],
            metadata: { faction: 'Watch', rank: 4, recruitable: true },
            fields: [
              {
                id: 'v_affinity',
                name: 'relationship',
                displayName: 'Relationship',
                scope: 'character',
                valueType: { kind: 'number' },
                defaultValue: 0,
              },
            ],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.characters[0]?.fields?.[0]).toMatchObject({
      id: 'v_affinity',
      name: 'relationship',
      scope: 'character',
    });
    expect(result.document.characters[0]).toMatchObject({
      description: 'A patient investigator.',
      dialogueStyle: 'Short sentences with dry humor.',
      tags: ['investigator', 'party-member'],
      metadata: { faction: 'Watch', rank: 4, recruitable: true },
      relationships: {
        c_bob: { label: 'Reluctant partner', description: 'Trust is still developing.' },
      },
    });
  });

  it('rejects removing an AI-managed Character field that is already referenced', () => {
    const source = story();
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'add-character-with-field',
          kind: 'add-character',
          character: {
            id: 'c_guarded',
            name: 'Guarded',
            displayName: 'Guarded',
            emotions: {},
            fields: [
              {
                id: 'v_guardedfield',
                name: 'state',
                displayName: 'State',
                scope: 'character',
                valueType: { kind: 'boolean' },
                defaultValue: false,
              },
            ],
          },
        },
        {
          operationId: 'add-field-reference',
          kind: 'add-node',
          graph: { kind: 'root' },
          node: {
            id: 'n_guardedfield',
            type: StoryNodeType.GetVariable,
            data: { variableId: 'v_guardedfield' },
          },
        },
        {
          operationId: 'remove-referenced-field',
          kind: 'update-character',
          characterId: 'c_guarded',
          patch: { fields: [] },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toMatch(/referenced/);
  });

  it('adds variables and edits Dialogue lines with stable line and text IDs', () => {
    const source = story();
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
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

  it('accepts Project Scope variables as external project state', () => {
    const source = story();
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'add-project-reputation',
          kind: 'add-variable',
          variable: {
            id: 'v_projectreputation',
            name: 'projectReputation',
            displayName: 'Project Reputation',
            scope: 'project',
            valueType: { kind: 'number' },
            defaultValue: 0,
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.variables).toContainEqual(
      expect.objectContaining({ id: 'v_projectreputation', scope: 'project' }),
    );
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
      baseRevision: createStorySemanticSnapshot(source).revision,
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
      baseRevision: createStorySemanticSnapshot(source).revision,
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

  it('removes an unreferenced variable and accepts the remove-variable schema', () => {
    const source = story();
    source.variables = [
      {
        id: 'v_unused',
        name: 'unused',
        displayName: 'Unused',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        { operationId: 'remove-unused', kind: 'remove-variable', variableId: 'v_unused' },
      ],
    };

    expect(validateBlueprintCommandTransaction(transaction)).toEqual([]);
    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.variables).toEqual([]);
  });

  it('rejects removing a variable referenced by a node and leaves the source unchanged', () => {
    const source = story();
    source.variables = [
      {
        id: 'v_score',
        name: 'score',
        displayName: 'Score',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    source.root.nodes.push({
      id: 'n_set_score',
      type: StoryNodeType.SetVariable,
      definitionVersion: 1,
      position: { x: 820, y: 50 },
      data: { variableId: 'v_score', value: { source: '1', bindings: {} } },
    });
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [{ operationId: 'remove-score', kind: 'remove-variable', variableId: 'v_score' }],
    };

    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(false);
    expect(result.document).toBe(source);
    expect(source.variables).toHaveLength(1);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: 'INVALID_TARGET',
        operationId: 'remove-score',
      });
    }
  });

  it('rejects removing a variable referenced by a reusable condition expression', () => {
    const source = story();
    source.variables = [
      {
        id: 'v_affinity',
        name: 'affinity',
        displayName: 'Affinity',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    source.conditions = [
      {
        id: 'cond_affinity',
        name: 'has-affinity',
        displayName: 'Has Affinity',
        root: {
          kind: 'expression',
          expression: { source: 'affinity > 0', bindings: { affinity: 'v_affinity' } },
        },
      },
    ];
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        { operationId: 'remove-affinity', kind: 'remove-variable', variableId: 'v_affinity' },
      ],
    };

    const result = executeBlueprintCommandTransaction(source, transaction);
    expect(result.ok).toBe(false);
    expect(result.document).toBe(source);
    expect(source.variables).toHaveLength(1);
    expect(source.conditions).toHaveLength(1);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('INVALID_TARGET');
  });

  it('allows retyping an unreferenced variable but rejects retyping a referenced one atomically', () => {
    const unreferenced = story();
    unreferenced.variables = [
      {
        id: 'v_status',
        name: 'status',
        displayName: 'Status',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    const retype: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(unreferenced).revision,
      operations: [
        {
          operationId: 'retype-status',
          kind: 'update-variable',
          variableId: 'v_status',
          patch: { valueType: { kind: 'string' }, defaultValue: 'ready' },
        },
      ],
    };
    const retyped = executeBlueprintCommandTransaction(unreferenced, retype);
    expect(retyped.ok).toBe(true);
    if (retyped.ok)
      expect(retyped.document.variables[0]).toMatchObject({ valueType: { kind: 'string' } });

    const referenced = story();
    referenced.variables = structuredClone(unreferenced.variables);
    referenced.root.nodes.push({
      id: 'n_read_status',
      type: StoryNodeType.SetVariable,
      definitionVersion: 1,
      position: { x: 820, y: 50 },
      data: { variableId: 'v_status', value: { source: '0', bindings: {} } },
    });
    const blocked = executeBlueprintCommandTransaction(referenced, {
      ...retype,
      baseRevision: createStorySemanticSnapshot(referenced).revision,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.document).toBe(referenced);
    expect(referenced.variables[0]?.valueType).toEqual({ kind: 'number' });
    if (!blocked.ok) {
      expect(blocked.diagnostics[0]).toMatchObject({
        code: 'INVALID_TARGET',
        operationId: 'retype-status',
      });
    }
  });

  it('targets Branch, Set Variable, Event, and Signal expressions explicitly', () => {
    const source = story();
    const graph = { kind: 'root' } as const;
    const transaction: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
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

  it('adds a relative numeric adjustment with a stable self binding', () => {
    const source = story();
    source.variables = [
      {
        id: 'v_affinity',
        name: 'tianzhu_affinity',
        displayName: 'Tianzhu Affinity',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    const result = executeBlueprintCommandTransaction(source, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: createStorySemanticSnapshot(source).revision,
      operations: [
        {
          operationId: 'increase-affinity',
          kind: 'add-variable-adjustment',
          graph: { kind: 'root' },
          node: { id: 'n_affinity' },
          variableId: 'v_affinity',
          delta: 1,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.nodes.at(-1)).toMatchObject({
      id: 'n_affinity',
      type: StoryNodeType.SetVariable,
      data: {
        variableId: 'v_affinity',
        value: {
          source: 'tianzhu_affinity + 1',
          bindings: { tianzhu_affinity: 'v_affinity' },
        },
      },
    });
  });

  it('hydrates and exposes data pins in AI semantic snapshots', () => {
    const doc = story();
    doc.variables = [
      {
        id: 'v_count',
        name: 'player_count',
        displayName: 'Player Count',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 0,
      },
    ];
    doc.signals = [
      {
        id: 'sig_spawn',
        name: 'on_spawn',
        displayName: 'On Spawn',
        parameters: [{ name: 'amount', valueType: { kind: 'number' } }],
      },
    ];
    doc.events = [
      {
        id: 'ev_attack',
        name: 'do_attack',
        displayName: 'Do Attack',
        parameters: [{ name: 'damage', valueType: { kind: 'number' } }],
        outputs: [{ id: 'success', displayName: 'Is Success', valueType: { kind: 'boolean' } }],
      },
    ];
    doc.root.nodes.push(
      {
        id: 'n_getvar',
        type: StoryNodeType.GetVariable,
        definitionVersion: 1,
        position: { x: 100, y: 100 },
        data: { variableId: 'v_count' },
      },
      {
        id: 'n_setvar',
        type: StoryNodeType.SetVariable,
        definitionVersion: 1,
        position: { x: 300, y: 100 },
        data: { variableId: 'v_count', value: { source: '0', bindings: {} } },
      },
      {
        id: 'n_wait_sig',
        type: StoryNodeType.WaitSignal,
        definitionVersion: 1,
        position: { x: 100, y: 200 },
        data: { signalId: 'sig_spawn', matches: {} },
      },
      {
        id: 'n_call_evt',
        type: StoryNodeType.CallEvent,
        definitionVersion: 1,
        position: { x: 300, y: 200 },
        data: { eventId: 'ev_attack', arguments: {}, resultVariableIds: {} },
      },
      {
        id: 'n_branch',
        type: StoryNodeType.Branch,
        definitionVersion: 1,
        position: { x: 500, y: 200 },
        data: { condition: { source: 'true', bindings: {} } },
      },
    );

    const snapshot = createStorySemanticSnapshot(doc);
    const rootNodes = snapshot.graphs[0].nodes;
    const getNode = (id: string) => rootNodes.find((n) => n.id === id);

    const getVar = getNode('n_getvar');
    expect(getVar?.ports).toContainEqual(
      expect.objectContaining({ id: 'value', direction: 'output', valueType: { kind: 'number' } }),
    );

    const setVar = getNode('n_setvar');
    expect(setVar?.ports).toContainEqual(
      expect.objectContaining({ id: 'value', direction: 'input', valueType: { kind: 'number' } }),
    );

    const waitSig = getNode('n_wait_sig');
    expect(waitSig?.ports).toContainEqual(
      expect.objectContaining({ id: 'payload:amount', direction: 'output', valueType: { kind: 'number' } }),
    );

    const callEvt = getNode('n_call_evt');
    expect(callEvt?.ports).toContainEqual(
      expect.objectContaining({ id: 'argument:damage', direction: 'input', valueType: { kind: 'number' } }),
    );
    expect(callEvt?.ports).toContainEqual(
      expect.objectContaining({ id: 'output:success', direction: 'output', valueType: { kind: 'boolean' } }),
    );

    const branch = getNode('n_branch');
    expect(branch?.ports).toContainEqual(
      expect.objectContaining({ id: 'condition', direction: 'input', valueType: { kind: 'boolean' } }),
    );
  });

  it('connects and disconnects data pins across GetVariable, SetVariable, WaitSignal, CallEvent, and Branch', () => {
    const doc = story();
    doc.variables = [
      {
        id: 'v_health',
        name: 'player_health',
        displayName: 'Player Health',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 100,
      },
    ];
    doc.signals = [
      {
        id: 'sig_heal',
        name: 'on_heal',
        displayName: 'On Heal',
        parameters: [{ name: 'heal_amount', valueType: { kind: 'number' } }],
      },
    ];
    doc.events = [
      {
        id: 'ev_check',
        name: 'check_status',
        displayName: 'Check Status',
        parameters: [{ name: 'power', valueType: { kind: 'number' } }],
        outputs: [{ id: 'is_alive', displayName: 'Is Alive', valueType: { kind: 'boolean' } }],
      },
    ];
    doc.root.nodes.push(
      {
        id: 'n_get_health',
        type: StoryNodeType.GetVariable,
        definitionVersion: 1,
        position: { x: 100, y: 100 },
        data: { variableId: 'v_health' },
      },
      {
        id: 'n_set_health',
        type: StoryNodeType.SetVariable,
        definitionVersion: 1,
        position: { x: 300, y: 100 },
        data: { variableId: 'v_health', value: { source: '100', bindings: {} } },
      },
      {
        id: 'n_wait_heal',
        type: StoryNodeType.WaitSignal,
        definitionVersion: 1,
        position: { x: 100, y: 200 },
        data: { signalId: 'sig_heal', matches: {} },
      },
      {
        id: 'n_call_check',
        type: StoryNodeType.CallEvent,
        definitionVersion: 1,
        position: { x: 300, y: 200 },
        data: { eventId: 'ev_check', arguments: {}, resultVariableIds: {} },
      },
      {
        id: 'n_branch_alive',
        type: StoryNodeType.Branch,
        definitionVersion: 1,
        position: { x: 500, y: 200 },
        data: { condition: { source: 'true', bindings: {} } },
      },
    );

    const baseRevision = createStorySemanticSnapshot(doc).revision;

    // Connect GetVariable -> SetVariable, WaitSignal payload -> CallEvent argument, CallEvent output -> Branch condition
    const connectTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'connect-data-var',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_get_health', portId: 'value' },
          to: { nodeId: 'n_set_health', portId: 'value' },
        },
        {
          operationId: 'connect-signal-arg',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_wait_heal', portId: 'payload:heal_amount' },
          to: { nodeId: 'n_call_check', portId: 'argument:power' },
        },
        {
          operationId: 'connect-evt-branch',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_call_check', portId: 'output:is_alive' },
          to: { nodeId: 'n_branch_alive', portId: 'condition' },
        },
      ],
    };

    const connectResult = executeBlueprintCommandTransaction(doc, connectTx);
    expect(connectResult.ok).toBe(true);
    if (!connectResult.ok) return;

    expect(connectResult.document.root.edges).toContainEqual({
      from: { nodeId: 'n_get_health', portId: 'value' },
      to: { nodeId: 'n_set_health', portId: 'value' },
    });
    expect(connectResult.document.root.edges).toContainEqual({
      from: { nodeId: 'n_wait_heal', portId: 'payload:heal_amount' },
      to: { nodeId: 'n_call_check', portId: 'argument:power' },
    });
    expect(connectResult.document.root.edges).toContainEqual({
      from: { nodeId: 'n_call_check', portId: 'output:is_alive' },
      to: { nodeId: 'n_branch_alive', portId: 'condition' },
    });

    // Now disconnect one data connection
    const disconnectTx: BlueprintCommandTransaction = {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: connectResult.snapshot.revision,
      operations: [
        {
          operationId: 'disconnect-evt-branch',
          kind: 'disconnect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_call_check', portId: 'output:is_alive' },
          to: { nodeId: 'n_branch_alive', portId: 'condition' },
        },
      ],
    };

    const disconnectResult = executeBlueprintCommandTransaction(connectResult.document, disconnectTx);
    expect(disconnectResult.ok).toBe(true);
    if (!disconnectResult.ok) return;

    expect(disconnectResult.document.root.edges).not.toContainEqual({
      from: { nodeId: 'n_call_check', portId: 'output:is_alive' },
      to: { nodeId: 'n_branch_alive', portId: 'condition' },
    });
    expect(disconnectResult.document.root.edges).toContainEqual({
      from: { nodeId: 'n_get_health', portId: 'value' },
      to: { nodeId: 'n_set_health', portId: 'value' },
    });
  });

  it('rejects type-incompatible data pin connections with INVALID_CONNECTION diagnostic', () => {
    const doc = story();
    doc.variables = [
      {
        id: 'v_name',
        name: 'player_name',
        displayName: 'Player Name',
        scope: 'story',
        valueType: { kind: 'string' },
        defaultValue: 'Hero',
      },
      {
        id: 'v_count',
        name: 'player_count',
        displayName: 'Player Count',
        scope: 'story',
        valueType: { kind: 'number' },
        defaultValue: 1,
      },
    ];
    doc.root.nodes.push(
      {
        id: 'n_get_str',
        type: StoryNodeType.GetVariable,
        definitionVersion: 1,
        position: { x: 100, y: 100 },
        data: { variableId: 'v_name' },
      },
      {
        id: 'n_set_num',
        type: StoryNodeType.SetVariable,
        definitionVersion: 1,
        position: { x: 300, y: 100 },
        data: { variableId: 'v_count', value: { source: '1', bindings: {} } },
      },
      {
        id: 'n_branch',
        type: StoryNodeType.Branch,
        definitionVersion: 1,
        position: { x: 500, y: 100 },
        data: { condition: { source: 'true', bindings: {} } },
      },
    );

    const baseRevision = createStorySemanticSnapshot(doc).revision;

    // String -> Number SetVariable.value: should fail type check
    const invalidResult = executeBlueprintCommandTransaction(doc, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'connect-incompatible',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_get_str', portId: 'value' },
          to: { nodeId: 'n_set_num', portId: 'value' },
        },
      ],
    });

    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) return;
    expect(invalidResult.diagnostics[0]?.code).toBe('INVALID_CONNECTION');

    // String -> Branch.condition (requires boolean): should fail type check
    const invalidBranchResult = executeBlueprintCommandTransaction(doc, {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision,
      operations: [
        {
          operationId: 'connect-string-to-bool',
          kind: 'connect',
          graph: { kind: 'root' },
          from: { nodeId: 'n_get_str', portId: 'value' },
          to: { nodeId: 'n_branch', portId: 'condition' },
        },
      ],
    });

    expect(invalidBranchResult.ok).toBe(false);
    if (invalidBranchResult.ok) return;
    expect(invalidBranchResult.diagnostics[0]?.code).toBe('INVALID_CONNECTION');
  });
});

