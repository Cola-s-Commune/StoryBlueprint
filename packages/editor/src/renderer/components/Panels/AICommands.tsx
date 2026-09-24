import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_EXAMPLE,
  BLUEPRINT_COMMAND_JSON_SCHEMA,
  BLUEPRINT_NODE_CATALOG,
  BLUEPRINT_COMMAND_VERSION,
  StoryNodeType,
  buildMultiTurnContextBlock,
  type BlueprintCommandTransaction,
  type BlueprintTransactionResult,
  type SelectedNodeDetail,
  type StoryNodeDataMap,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import type {
  AIChatSession,
  AIConversationMessage,
  AIContextMode,
  AIFileAttachment,
  AIInstructionsStatus,
  AIProviderProfile,
  AIProviderRegistry,
  AIReasoningEffort,
  AIStructuredOutputMode,
  AIThinkingMode,
  AIStreamingMode,
  AIStreamProgress,
  AIToolsMode,
} from '../../../shared/electronApi';
import { normalizeAIBlueprintCommand, parseAIAssistantResponse } from '../../../shared/aiProvider';
import { AIQuickActions } from './AIQuickActions';
import {
  AI_SLASH_COMMANDS,
  applySlashCommandToText,
  findMatchingSlashCommands,
  type AISlashCommand,
  type SlashMatchResult,
} from './aiSlashCommands';
import { CopyButton } from './CopyButton';
import { processDroppedAIContextFiles } from '../../graph/aiAttachmentDrop';
import panelStyles from './Panel.module.css';
import styles from './AICommands.module.css';

interface SemanticDiff {
  addedVariables: string[];
  removedVariables: string[];
  changedVariables: string[];
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedConnections: string[];
  removedConnections: string[];
}

type AIContextScope = 'selection' | 'graph' | 'story';

interface AIProviderDraft {
  id?: string;
  name: string;
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  temperature: number;
  maxTokens: number;
  structuredOutput: AIStructuredOutputMode;
  thinkingMode: AIThinkingMode;
  reasoningEffort: AIReasoningEffort;
  streaming: AIStreamingMode;
  tools: AIToolsMode;
  contextMode: AIContextMode;
}

function draftFromProvider(profile: AIProviderProfile): AIProviderDraft {
  return {
    id: profile.id,
    name: profile.name,
    endpoint: profile.endpoint,
    model: profile.model,
    timeoutSeconds: profile.timeoutMs / 1_000,
    temperature: typeof profile.temperature === 'number' ? profile.temperature : 0.3,
    maxTokens: typeof profile.maxTokens === 'number' ? profile.maxTokens : 8192,
    structuredOutput: profile.structuredOutput,
    thinkingMode: profile.thinkingMode,
    reasoningEffort: profile.reasoningEffort,
    streaming: profile.streaming,
    tools: profile.tools,
    contextMode: profile.contextMode,
  };
}

function createProviderDraft(): AIProviderDraft {
  return {
    name: 'New Provider',
    endpoint: 'https://api.openai.com/v1',
    model: '',
    timeoutSeconds: 120,
    temperature: 0.3,
    maxTokens: 8192,
    structuredOutput: 'json-object',
    thinkingMode: 'auto',
    reasoningEffort: 'high',
    streaming: 'auto',
    tools: 'enabled',
    contextMode: 'full',
  };
}

const AI_ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'command'],
  properties: {
    reply: { type: 'string', minLength: 1 },
    command: {
      anyOf: [BLUEPRINT_COMMAND_JSON_SCHEMA, { type: 'null' }],
    },
    needsClarification: { type: 'boolean' },
    questions: { type: 'array', items: { type: 'string', minLength: 1 } },
    toolRequest: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        name: {
          enum: [
            'story.search',
            'story.get_nodes',
            'story.get_characters',
            'story.get_graph',
            'story.validate_command',
          ],
        },
        arguments: { type: 'object' },
      },
      required: ['name', 'arguments'],
    },
  },
} as const;

const AI_CONTEXT_CHAR_BUDGET = 1_800_000;
const AI_TOOL_RESULT_CHAR_BUDGET = 180_000;

function compactAIValue(value: string, limit = 480): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function compactAISnapshot(snapshot: StorySemanticSnapshot): StorySemanticSnapshot {
  return {
    ...snapshot,
    graphs: snapshot.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.type === StoryNodeType.Dialogue) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
          return {
            ...node,
            data: {
              ...data,
              lines: data.lines.map((line) => ({
                ...line,
                text: { ...line.text, source: compactAIValue(line.text.source) },
              })),
            },
          };
        }
        if (node.type === StoryNodeType.Narration) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.Narration];
          return {
            ...node,
            data: { ...data, text: { ...data.text, source: compactAIValue(data.text.source) } },
          };
        }
        if (node.type === StoryNodeType.Choice) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
          return {
            ...node,
            data: {
              ...data,
              prompt: { ...data.prompt, source: compactAIValue(data.prompt.source) },
              options: data.options.map((option) => ({
                ...option,
                text: { ...option.text, source: compactAIValue(option.text.source) },
              })),
            },
          };
        }
        if (node.type === StoryNodeType.InkBlock) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.InkBlock];
          return data.sourceMode === 'embedded'
            ? { ...node, data: { ...data, source: compactAIValue(data.source, 800) } }
            : node;
        }
        return node;
      }),
    })),
  };
}

function manifestAISnapshot(snapshot: StorySemanticSnapshot): StorySemanticSnapshot {
  return {
    ...snapshot,
    graphs: snapshot.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {} as StoryNodeDataMap[StoryNodeType],
      })),
    })),
  };
}

function graphKey(graph: StorySemanticSnapshot['graphs'][number]): string {
  return graph.kind === 'root' ? 'root' : `chapter:${graph.chapterId}`;
}

function connectionKey(
  graph: StorySemanticSnapshot['graphs'][number],
  connection: StorySemanticSnapshot['graphs'][number]['connections'][number],
): string {
  return `${graphKey(graph)}:${connection.from.nodeId}.${connection.from.portId} -> ${connection.to.nodeId}.${connection.to.portId}`;
}

function compactText(value: string, limit = 48): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function nodeSummary(
  key: string,
  node: StorySemanticSnapshot['graphs'][number]['nodes'][number],
): string {
  let content = '';
  if (node.type === StoryNodeType.Dialogue) {
    content = (node.data as StoryNodeDataMap[StoryNodeType.Dialogue]).lines[0]?.text.source ?? '';
  } else if (node.type === StoryNodeType.Narration) {
    content = (node.data as StoryNodeDataMap[StoryNodeType.Narration]).text.source;
  } else if (node.type === StoryNodeType.InkBlock) {
    const ink = node.data as StoryNodeDataMap[StoryNodeType.InkBlock];
    content = ink.sourceMode === 'embedded' ? ink.source : `[Linked Ink: ${ink.path}]`;
  } else if (node.type === StoryNodeType.Choice) {
    content = (node.data as StoryNodeDataMap[StoryNodeType.Choice]).prompt.source;
  } else if (node.type === StoryNodeType.SetVariable) {
    content = (node.data as StoryNodeDataMap[StoryNodeType.SetVariable]).value.source;
  }
  const label = node.name ? ` · ${node.name}` : '';
  return `${key} · ${node.type}${label}${content ? ` · “${compactText(content)}”` : ''}`;
}

function changedPaths(before: unknown, after: unknown, prefix = '', limit = 6): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (limit <= 0) return [prefix || 'value'];
  if (
    typeof before !== 'object' ||
    before === null ||
    typeof after !== 'object' ||
    after === null
  ) {
    return [prefix || 'value'];
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return [prefix || 'value'];
    const hasStableIds = [...before, ...after].every(
      (item) => typeof item === 'object' && item !== null && 'id' in item,
    );
    if (!hasStableIds) return [prefix || 'value'];
    const beforeItems = new Map(
      before.map((item) => [String((item as Record<string, unknown>).id), item]),
    );
    const afterItems = new Map(
      after.map((item) => [String((item as Record<string, unknown>).id), item]),
    );
    return [...new Set([...beforeItems.keys(), ...afterItems.keys()])].flatMap((id) => {
      const itemPrefix = `${prefix}[${id}]`;
      if (!beforeItems.has(id) || !afterItems.has(id)) return [itemPrefix];
      return changedPaths(beforeItems.get(id), afterItems.get(id), itemPrefix, limit - 1);
    });
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].flatMap((key) =>
    changedPaths(beforeRecord[key], afterRecord[key], prefix ? `${prefix}.${key}` : key, limit - 1),
  );
}

function semanticDiff(before: StorySemanticSnapshot, after: StorySemanticSnapshot): SemanticDiff {
  const beforeVariables = new Map(
    before.variables.map((variable) => [variable.id, variable] as const),
  );
  const afterVariables = new Map(
    after.variables.map((variable) => [variable.id, variable] as const),
  );
  const beforeNodes = new Map(
    before.graphs.flatMap((graph) =>
      graph.nodes.map((node) => [`${graphKey(graph)}:${node.id}`, node] as const),
    ),
  );
  const afterNodes = new Map(
    after.graphs.flatMap((graph) =>
      graph.nodes.map((node) => [`${graphKey(graph)}:${node.id}`, node] as const),
    ),
  );
  const beforeConnections = new Set(
    before.graphs.flatMap((graph) =>
      graph.connections.map((connection) => connectionKey(graph, connection)),
    ),
  );
  const afterConnections = new Set(
    after.graphs.flatMap((graph) =>
      graph.connections.map((connection) => connectionKey(graph, connection)),
    ),
  );
  return {
    addedVariables: [...afterVariables]
      .filter(([id]) => !beforeVariables.has(id))
      .map(([id, variable]) => `${id} · ${variable.name}: ${variable.valueType.kind}`),
    removedVariables: [...beforeVariables]
      .filter(([id]) => !afterVariables.has(id))
      .map(([id, variable]) => `${id} · ${variable.name}: ${variable.valueType.kind}`),
    changedVariables: [...afterVariables.keys()]
      .filter(
        (id) =>
          beforeVariables.has(id) &&
          JSON.stringify(beforeVariables.get(id)) !== JSON.stringify(afterVariables.get(id)),
      )
      .map((id) => {
        const variable = afterVariables.get(id)!;
        const paths = changedPaths(beforeVariables.get(id), variable);
        return `${id} · ${variable.name} · ${paths.join(', ')}`;
      }),
    addedNodes: [...afterNodes]
      .filter(([id]) => !beforeNodes.has(id))
      .map(([id, node]) => nodeSummary(id, node)),
    removedNodes: [...beforeNodes]
      .filter(([id]) => !afterNodes.has(id))
      .map(([id, node]) => nodeSummary(id, node)),
    changedNodes: [...afterNodes.keys()]
      .filter(
        (id) =>
          beforeNodes.has(id) &&
          JSON.stringify(beforeNodes.get(id)) !== JSON.stringify(afterNodes.get(id)),
      )
      .map((id) => {
        const node = afterNodes.get(id)!;
        const paths = changedPaths(beforeNodes.get(id), node).filter(
          (path) => path !== 'ports' && !path.startsWith('ports['),
        );
        return `${nodeSummary(id, node)} · ${paths.join(', ')}`;
      }),
    addedConnections: [...afterConnections].filter((edge) => !beforeConnections.has(edge)),
    removedConnections: [...beforeConnections].filter((edge) => !afterConnections.has(edge)),
  };
}

function commandTemplate(revision: string): string {
  return JSON.stringify(
    {
      format: BLUEPRINT_COMMAND_FORMAT,
      version: BLUEPRINT_COMMAND_VERSION,
      baseRevision: revision,
      operations: [],
    },
    null,
    2,
  );
}

function relativeVariableOverwriteOperations(command: unknown, request: string): string[] {
  const requestsRelativeChange =
    /(?:增加|加上|加\s*\d|提高|提升|减少|减去|降低|递增|递减|increment|decrement|increase|decrease|add\s+\d|subtract)/iu.test(
      request,
    );
  if (!requestsRelativeChange || typeof command !== 'object' || command === null) return [];
  const operations = (command as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((operation, index) => {
    if (typeof operation !== 'object' || operation === null) return [];
    const raw = operation as Record<string, unknown>;
    const operationId = typeof raw.operationId === 'string' ? raw.operationId : `#${index + 1}`;
    if (raw.kind === 'set-expression') {
      const target = raw.target as Record<string, unknown> | undefined;
      if (
        target?.kind === 'set-variable-value' &&
        typeof raw.source === 'string' &&
        /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.source.trim())
      ) {
        return [operationId];
      }
    }
    if (raw.kind !== 'add-node') return [];
    const node = raw.node as Record<string, unknown> | undefined;
    if (node?.type !== StoryNodeType.SetVariable) return [];
    const data = node.data as Record<string, unknown> | undefined;
    const value = data?.value as Record<string, unknown> | undefined;
    return typeof value?.source === 'string' &&
      /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.source.trim())
      ? [operationId]
      : [];
  });
}

function scopedSnapshot(
  snapshot: StorySemanticSnapshot,
  scope: AIContextScope,
  activeGraphId: string,
  selectedNodeIds: readonly string[],
): StorySemanticSnapshot {
  if (scope === 'story') return snapshot;
  const activeGraph = snapshot.graphs.find((graph) =>
    activeGraphId === 'root'
      ? graph.kind === 'root'
      : graph.kind === 'chapter' && graph.chapterId === activeGraphId,
  );
  if (!activeGraph) return { ...snapshot, graphs: [] };
  if (scope === 'graph') return { ...snapshot, graphs: [activeGraph] };

  const selectedIds = new Set(selectedNodeIds);
  const includedIds = new Set(selectedNodeIds);
  for (const connection of activeGraph.connections) {
    if (selectedIds.has(connection.from.nodeId) || selectedIds.has(connection.to.nodeId)) {
      includedIds.add(connection.from.nodeId);
      includedIds.add(connection.to.nodeId);
    }
  }
  return {
    ...snapshot,
    graphs: [
      {
        ...activeGraph,
        nodes: activeGraph.nodes.filter((node) => includedIds.has(node.id)),
        connections: activeGraph.connections.filter(
          (connection) =>
            includedIds.has(connection.from.nodeId) && includedIds.has(connection.to.nodeId),
        ),
      },
    ],
  };
}

function aiContext(
  snapshot: StorySemanticSnapshot,
  scope?: { kind: AIContextScope; activeGraphId: string; selectedNodeIds: readonly string[] },
  mode: AIContextMode = 'full',
  toolsEnabled = true,
  multiTurnBlock = '',
): string {
  const example = { ...BLUEPRINT_COMMAND_EXAMPLE, baseRevision: snapshot.revision };
  const build = (contextSnapshot: StorySemanticSnapshot, compacted: boolean) =>
    [
      'Use this semantic Story Blueprint state to answer the author or propose an edit.',
      'Answer questions normally. Ask for clarification instead of guessing important story intent.',
      `Any proposed command MUST validate against the ${BLUEPRINT_COMMAND_FORMAT}@${BLUEPRINT_COMMAND_VERSION} JSON Schema below.`,
      'The top-level array is named operations, never commands.',
      'A graph is an object such as { "kind": "root" }, never the string "root".',
      'Never emit ports, positions, definitionVersion, UI state, or fields not allowed by the schema.',
      'Use the Node Catalog for add-node data and port IDs; ports are always derived by the editor.',
      'IMPORTANT TEXT SHAPES: add-node data uses { "source": "text" } as shown in the Node Catalog, but add-dialogue-line, update-dialogue-line, add-choice-option, and update-choice-option use a plain string for text.',
      'TEXT QUOTES: Do not wrap ordinary dialogue or narration in ASCII double quotes. Use the exact player-facing text; use Chinese 「」 or “ ” for quotations. If an ASCII quote is necessary inside text, JSON-escape it as \\".',
      "DIALOGUE SEMANTICS: A Dialogue Line with speakerId is only that character's spoken words, without quotation marks or narration. Use a standalone Narration node for narration, action, inner thought, and scene description. Split mixed prose such as `I entered. 「Hello.」` into a Narration node and a spoken Dialogue node.",
      'SPEAKER RESOLUTION: For direct speech without a source speaker, bind an existing Character only when surrounding text makes the identity unambiguous. If the text clearly introduces a new temporary role (for example, a guard or clerk), propose one transaction with add-character (stable c_ ID, minimal definition, optional temporary tag) followed by the dialogue line binding. If identity remains ambiguous, ask the author. Never silently reclassify unassigned direct speech as Narration; only genuine narration, action, inner thought, or scene description belongs in a Narration node.',
      'NOVEL ADAPTATION: When the author supplies a novel or long-form prose and asks for a Galgame adaptation, preserve the source rather than summarizing it. Keep every scene beat, spoken line, narration, action, thought, pause, description, order, and pacing. Do not invent choices or gameplay actions, and do not reduce operation count by collapsing content. If the source is too large, propose explicit sequential batches with a covered range and continuation point; never silently omit or summarize the unprocessed range.',
      toolsEnabled
        ? 'READ-ONLY CONTEXT TOOLS: If this manifest is insufficient, return command:null and toolRequest:{name,arguments}. Available tools: story.search {query}, story.get_nodes {ids:string[]}, story.get_characters {ids:string[]}, story.get_graph {graphId:"root"|chapterId}, story.validate_command {command}. After receiving a tool result, answer the original request. Tools never modify the Story.'
        : 'READ-ONLY CONTEXT TOOLS are disabled for this Provider. Do not return toolRequest; use only the supplied context or ask the author a clarification question.',
      'SUBSTORY CREATION: To create a Substory, use one add-substory operation. Include a stable ch_ ID, unique name/displayName, chapter-scope parameters and outputs, local-scope localVariables, and an initial graph containing exactly one story-entry node and usually one return node. Do not use add-node with a chapter graph to simulate a Substory. The operation creates the Substory itself; it does not automatically add a Call Substory node.',
      'SUBSTORY REFACTORING: To change an existing Substory contract, use update-substory with chapterId and complete replacement arrays for parameters, outputs, or localVariables. Preserve stable variable IDs when editing an existing item. The editor updates Call Substory and Return pins and removes incompatible data links atomically; do not edit interface variables with generic update-variable.',
      'VARIABLE LIFECYCLE: Use remove-variable to delete a Story variable. Before remove-variable or changing update-variable.patch.valueType, inspect all node data and reusable condition expression bindings for references. If the variable is referenced, do not force the change: first remove or migrate every reference in the same transaction, or ask the author. A rejected transaction is atomic and leaves the Story unchanged.',
      'CONDITION RESOURCES: Reusable conditions are Story resources. Use add-condition with a stable cond_ ID, unique name/displayName, description when useful, and a root conditionTree. Tree nodes are expression ({ kind: "expression", expression: { source: "...", bindings: {} } }), all/any with children, not with one child, or reference with a conditionId. Use update-condition to replace metadata or the whole root; use remove-condition only when no Branch or other condition references it. Branch data may reference a conditionId, with its inline condition retained as fallback.',
      'CHOICE CONDITIONS: Choice options may use visibleConditionId or enabledConditionId to reference a reusable condition. These take precedence over visibleIf/enabledIf, which remain as inline fallbacks. Use the stable cond_ ID from the semantic context.',
      'Use replaceExisting: true on connect only when replacing an occupied compatible port.',
      'VALIDATION AND LAYOUT: Use validate-graph only when the author explicitly asks to validate a Graph; it is read-only and does not apply edits. Use layout-selection or layout-neighborhood for layout intent, never write node coordinates.',
      'ORDERED CONTENT: Use move-dialogue-line and move-choice-option to reorder existing items while preserving their stable IDs. Omit the anchor to append, use null to move to the front, or use an existing sibling ID to insert after it.',
      'Preserve stable IDs unless explicitly adding or removing an object.',
      'OPERATION IDS: Give every operation a unique stable operationId within the transaction. When retrying the exact same already-applied transaction, preserve its operationIds and operation contents; when making a new edit, generate a new operationId instead of reusing an old one.',
      `Set baseRevision to ${snapshot.revision}.`,
      ...(scope
        ? [
            `The provided context scope is ${scope.kind}.`,
            `All graph-scoped operations MUST target the active graph: ${scope.activeGraphId === 'root' ? '{ "kind": "root" }' : `{ "kind": "chapter", "chapterId": "${scope.activeGraphId}" }`}. Other graphs are read-only context. Resource-level add-substory does not have a graph field and is allowed when explicitly requested.`,
            scope.kind === 'selection'
              ? `The explicitly selected node IDs are: ${scope.selectedNodeIds.join(', ')}. Neighbor nodes are included only to show connection boundaries.`
              : '',
          ].filter(Boolean)
        : []),
      ...(multiTurnBlock ? ['', multiTurnBlock] : []),
      '',
      'BLUEPRINT COMMAND JSON SCHEMA:',
      JSON.stringify(BLUEPRINT_COMMAND_JSON_SCHEMA, null, 2),
      '',
      'BUILT-IN NODE CATALOG:',
      JSON.stringify(BLUEPRINT_NODE_CATALOG, null, 2),
      '',
      'VALID TRANSACTION EXAMPLE:',
      JSON.stringify(example, null, 2),
      '',
      compacted
        ? 'CURRENT SEMANTIC SNAPSHOT (COMPACTED): Long text was truncated for context budget. Stable IDs, types, speakers, and structure are preserved; ask for the exact node text when needed.'
        : 'CURRENT SEMANTIC SNAPSHOT:',
      JSON.stringify(contextSnapshot, null, 2),
    ].join('\n');
  if (mode === 'manifest-first') {
    return `${build(manifestAISnapshot(snapshot), true)}\n\nCONTEXT MODE: manifest-first. The manifest intentionally omits node data. Use the read-only context tools to retrieve exact content before proposing an edit.`;
  }
  const full = build(snapshot, false);
  if (mode === 'compact') {
    return `${build(compactAISnapshot(snapshot), true)}\n\nCONTEXT MODE: compact. Long text may be truncated; use read-only tools for exact content.`;
  }
  if (full.length <= AI_CONTEXT_CHAR_BUDGET) return full;
  const compacted = compactAISnapshot(snapshot);
  const compactedText = build(compacted, true);
  if (compactedText.length <= AI_CONTEXT_CHAR_BUDGET) return compactedText;
  return `${build(manifestAISnapshot(snapshot), true)}\n\nCONTEXT NOTE: This is a node manifest because the Story exceeds the context budget. Ask for the exact node data before editing a node.`;
}

async function readClipboard(): Promise<string> {
  if (window.electronAPI?.readClipboardText) return window.electronAPI.readClipboardText();
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error('Clipboard is unavailable');
}

function diagnosticText(result: BlueprintTransactionResult | undefined): string {
  if (!result || result.ok) return '';
  return result.diagnostics
    .map((diagnostic) => {
      const location = [
        diagnostic.operationId && `operation=${diagnostic.operationId}`,
        diagnostic.operationIndex !== undefined && `index=${diagnostic.operationIndex}`,
        diagnostic.path && `path=${diagnostic.path}`,
      ]
        .filter(Boolean)
        .join(' ');
      return `${diagnostic.code}${location ? ` ${location}` : ''}: ${diagnostic.message}`;
    })
    .join('\n');
}

interface DiagnosticAnalysis {
  reasons: string[];
}

function analyzeDiagnostics(text: string): DiagnosticAnalysis | undefined {
  if (!text || !text.trim()) return undefined;
  const reasons: string[] = [];
  if (/position|parentId|nodeType|properties/i.test(text)) {
    reasons.push(
      '模型混淆了其他通用图引擎（如 Unreal / Unity 蓝图）的属性字段（如 position / properties / nodeType），未能严格遵循本软件的蓝图契约。',
    );
  }
  if (/baseRevision|the supplied revision/i.test(text)) {
    reasons.push(
      '模型未填入有效的当前工程版本号（baseRevision），可能照抄了提示词中的占位符。',
    );
  }
  if (/operationId/i.test(text)) {
    reasons.push('模型遗漏了原子操作的唯一标识符（operationId）。');
  }
  if (/invalid graph target|graph/i.test(text)) {
    reasons.push('模型未正确指定蓝图目标图（需为 { "kind": "root" } 或指定 chapterId）。');
  }
  if (/must match pattern "\^n_/i.test(text)) {
    reasons.push('模型生成的节点 ID 不合规（节点 ID 必须以 n_ 开头）。');
  }
  if (/must match pattern "\^c_/i.test(text)) {
    reasons.push('模型指定的角色 ID 不合规（角色 ID 必须以 c_ 开头）。');
  }
  if (/RELATIVE_VARIABLE_OVERWRITE/i.test(text)) {
    reasons.push('用户请求的是相对调整（如增加/减少），但模型错误输出了绝对值覆盖。');
  }
  if (reasons.length === 0) {
    reasons.push(
      '模型输出的操作指令未能通过沙盒完整性校验，可能存在缺失必填字段或类型不匹配。',
    );
  }
  return { reasons };
}

function runAIContextTool(
  snapshot: StorySemanticSnapshot,
  request: { name: string; arguments: Record<string, unknown> },
  validateCommand: (command: unknown) => BlueprintTransactionResult,
): unknown {
  const args = request.arguments;
  if (request.name === 'story.search') {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    if (!query) return { error: 'story.search requires a non-empty query' };
    const results: Array<Record<string, unknown>> = [];
    for (const character of snapshot.characters) {
      const haystack = JSON.stringify(character).toLowerCase();
      if (haystack.includes(query))
        results.push({
          kind: 'character',
          id: character.id,
          name: character.name,
          displayName: character.displayName,
        });
    }
    for (const graph of snapshot.graphs) {
      for (const node of graph.nodes) {
        const haystack = JSON.stringify(node).toLowerCase();
        if (haystack.includes(query))
          results.push({
            kind: 'node',
            graph:
              graph.kind === 'root'
                ? { kind: 'root' }
                : { kind: 'chapter', chapterId: graph.chapterId },
            id: node.id,
            type: node.type,
            name: node.name,
          });
      }
    }
    return { query, results: results.slice(0, 50) };
  }
  if (request.name === 'story.get_characters') {
    const ids = Array.isArray(args.ids)
      ? args.ids.filter((id): id is string => typeof id === 'string')
      : [];
    return { characters: snapshot.characters.filter((character) => ids.includes(character.id)) };
  }
  if (request.name === 'story.get_nodes') {
    const ids = Array.isArray(args.ids)
      ? args.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const nodes = snapshot.graphs.flatMap((graph) =>
      graph.nodes
        .filter((node) => ids.includes(node.id))
        .map((node) => ({
          graph:
            graph.kind === 'root'
              ? { kind: 'root' }
              : { kind: 'chapter', chapterId: graph.chapterId },
          node,
        })),
    );
    return { nodes };
  }
  if (request.name === 'story.get_graph') {
    const graphId = typeof args.graphId === 'string' ? args.graphId : 'root';
    const graph = snapshot.graphs.find((candidate) =>
      graphId === 'root'
        ? candidate.kind === 'root'
        : candidate.kind === 'chapter' && candidate.chapterId === graphId,
    );
    return graph ? { graph } : { error: `Unknown graph: ${graphId}` };
  }
  if (request.name === 'story.validate_command') {
    if (!('command' in args)) return { error: 'story.validate_command requires command' };
    const result = validateCommand(args.command);
    return result.ok
      ? { valid: true, diagnostics: [] }
      : {
          valid: false,
          diagnostics: result.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            message: diagnostic.message,
            operationId: diagnostic.operationId,
            operationIndex: diagnostic.operationIndex,
            path: diagnostic.path,
          })),
        };
  }
  return { error: `Unknown read-only AI tool: ${request.name}` };
}

function boundedToolResult(value: unknown): { text: string; truncated: boolean } {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= AI_TOOL_RESULT_CHAR_BUDGET) return { text, truncated: false };
  return {
    text: JSON.stringify(
      {
        truncated: true,
        message: `Tool result exceeded ${AI_TOOL_RESULT_CHAR_BUDGET.toLocaleString()} characters. Narrow the request with story.search or story.get_nodes.`,
        preview: text.slice(0, AI_TOOL_RESULT_CHAR_BUDGET),
      },
      null,
      2,
    ),
    truncated: true,
  };
}

export function AICommands() {
  const {
    hasActiveStory,
    activeStoryId,
    workspace,
    semanticSnapshot,
    executeBlueprintCommands,
    aiProposal,
    applyAIProposal,
    discardAIProposal,
    activeGraphId,
    nodes,
  } = useStoryGraphStore();
  const aiCommandProposal = aiProposal?.origin === 'ai' ? aiProposal : undefined;
  const [commandText, setCommandText] = useState(() => commandTemplate(semanticSnapshot.revision));
  const [result, setResult] = useState<BlueprintTransactionResult>();
  const [previewBase, setPreviewBase] = useState<StorySemanticSnapshot>();
  const [dryRunToken, setDryRunToken] = useState<string>();
  const [clipboardError, setClipboardError] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [attachments, setAttachments] = useState<AIFileAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragCounterRef = useRef(0);
  const [contextScope, setContextScope] = useState<AIContextScope>('story');
  const [providerRegistry, setProviderRegistry] = useState<AIProviderRegistry>();
  const [instructionsStatus, setInstructionsStatus] = useState<AIInstructionsStatus>();
  const [providerDraft, setProviderDraft] = useState<AIProviderDraft>();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [providerError, setProviderError] = useState<string>();
  const [providerStatus, setProviderStatus] = useState<string>();
  const [modelReasoning, setModelReasoning] = useState<string>();
  const [streamedContent, setStreamedContent] = useState('');
  const [rawAIResponse, setRawAIResponse] = useState<string>();
  const [toolTrace, setToolTrace] = useState<
    Array<{ name: string; arguments: Record<string, unknown>; result: string }>
  >([]);
  const [conversation, setConversation] = useState<AIConversationMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<AIConversationMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<AIChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState('');
  const [chatTitle, setChatTitle] = useState('');
  const [loadedChatScope, setLoadedChatScope] = useState('');
  const [lastUserRequest, setLastUserRequest] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showDiffDetails, setShowDiffDetails] = useState(false);
  const requestIdRef = useRef<string>();
  const conversationRef = useRef<HTMLDivElement>(null);
  const chatCreatedAtRef = useRef(new Date().toISOString());
  const skipNextChatSaveRef = useRef(false);
  const activeProvider = useMemo(
    () =>
      providerRegistry?.providers.find(
        (profile) => profile.id === providerRegistry.activeProviderId,
      ),
    [providerRegistry],
  );
  const editingProvider = useMemo(
    () =>
      providerDraft?.id
        ? providerRegistry?.providers.find((profile) => profile.id === providerDraft.id)
        : undefined,
    [providerDraft?.id, providerRegistry],
  );
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );
  const scopedSemanticSnapshot = useMemo(
    () => scopedSnapshot(semanticSnapshot, contextScope, activeGraphId, selectedNodeIds),
    [activeGraphId, contextScope, selectedNodeIds, semanticSnapshot],
  );
  const snapshotText = useMemo(() => JSON.stringify(semanticSnapshot, null, 2), [semanticSnapshot]);
  const selectedNodeDetails = useMemo<SelectedNodeDetail[]>(() => {
    return nodes
      .filter((node) => node.selected)
      .map((node) => ({
        id: node.id,
        type: node.type as StoryNodeType,
        data: node.data,
        title: (node.data as any)?.title,
      }));
  }, [nodes]);
  const multiTurnContextText = useMemo(() => {
    return buildMultiTurnContextBlock({
      selectedNodes: selectedNodeDetails,
      characters: semanticSnapshot.characters,
      pendingProposal: (aiCommandProposal?.transaction as BlueprintCommandTransaction | undefined) ?? undefined,
      currentStoryRevision: semanticSnapshot.revision,
    });
  }, [
    selectedNodeDetails,
    semanticSnapshot.characters,
    aiCommandProposal?.transaction,
    semanticSnapshot.revision,
  ]);
  const contextText = useMemo(
    () =>
      aiContext(
        scopedSemanticSnapshot,
        { kind: contextScope, activeGraphId, selectedNodeIds },
        activeProvider?.tools === 'disabled' && activeProvider.contextMode === 'manifest-first'
          ? 'compact'
          : (activeProvider?.contextMode ?? 'full'),
        activeProvider?.tools !== 'disabled',
        multiTurnContextText,
      ),
    [
      activeGraphId,
      activeProvider?.contextMode,
      activeProvider?.tools,
      contextScope,
      multiTurnContextText,
      scopedSemanticSnapshot,
      selectedNodeIds,
    ],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashMenuMatch, setSlashMenuMatch] = useState<SlashMatchResult | null>(null);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const applySlashCommand = (cmd: AISlashCommand) => {
    const firstSelected = nodes.find((n) => n.selected);
    const template = cmd.buildTemplate({
      selectedNodeId: firstSelected?.id,
      selectedNodeType: firstSelected?.type as StoryNodeType | undefined,
      hasAttachments: attachments.length > 0,
    });

    if (cmd.recommendedScope) {
      if (cmd.recommendedScope === 'selection') {
        if (selectedNodeIds.length > 0) {
          setContextScope('selection');
        } else {
          setContextScope('graph');
        }
      } else {
        setContextScope(cmd.recommendedScope);
      }
    }

    if (slashMenuMatch) {
      const { newText, newCursorPos } = applySlashCommandToText(
        instruction,
        slashMenuMatch.startIndex,
        slashMenuMatch.endIndex,
        template,
      );
      setInstruction(newText);
      setSlashMenuMatch(null);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    } else {
      const newText = instruction.trim() ? `${template}${instruction}` : template;
      setInstruction(newText);
      setSlashMenuMatch(null);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newText.length, newText.length);
        }
      }, 0);
    }
  };
  const followUpSuggestions = useMemo(() => {
    if (generating || conversation.length === 0) return [];
    const lastMsg = conversation[conversation.length - 1];
    if (lastMsg.role !== 'assistant') return [];

    const suggestions: string[] = [];
    if (aiCommandProposal) {
      const tx = aiCommandProposal.transaction as BlueprintCommandTransaction | undefined;
      const ops = tx?.operations ?? [];
      const hasChoice = ops.some(
        (op: any) =>
          (op.kind === 'add-node' && op.node?.type === StoryNodeType.Choice) ||
          op.kind === 'update-choice-option' ||
          op.kind === 'add-choice-option',
      );
      const hasDialogue = ops.some(
        (op: any) =>
          (op.kind === 'add-node' && op.node?.type === StoryNodeType.Dialogue) ||
          op.kind === 'update-dialogue-line' ||
          op.kind === 'add-dialogue-line',
      );

      if (hasChoice) {
        suggestions.push('把第3个选项改得更委婉一些');
        suggestions.push('增加一个冷静理智的备选分支');
        suggestions.push('为各选项生成后续剧情对白');
      } else if (hasDialogue) {
        suggestions.push('将台词语气修改得更具角色个性');
        suggestions.push('在此处增加一个关键剧情选择分支');
        suggestions.push('继续向下顺承续写 3 句对白');
      } else {
        suggestions.push('检查是否有漏连或断开的引脚');
        suggestions.push('将修改微调得更符合剧情上下文');
      }
    } else if (selectedNodeDetails.length > 0) {
      const firstSelected = selectedNodeDetails[0];
      if (firstSelected.type === StoryNodeType.Choice) {
        suggestions.push('把选中的第三个选项改得更委婉一些');
        suggestions.push('为选中的选择节点增加一个中立选项');
      } else if (firstSelected.type === StoryNodeType.Dialogue) {
        suggestions.push('将选中节点的第二句台词语气改得更警惕');
        suggestions.push('为选中对白节点续写后续对白');
      }
    }
    return suggestions.slice(0, 3);
  }, [conversation, generating, aiCommandProposal, selectedNodeDetails]);
  const schemaText = useMemo(() => JSON.stringify(BLUEPRINT_COMMAND_JSON_SCHEMA, null, 2), []);
  const chatScopeKey = activeStoryId
    ? `${workspace?.rootPath ?? 'standalone'}::${activeStoryId}`
    : '';
  const currentToken = `${semanticSnapshot.revision}\n${commandText}`;
  const isDryRunCurrent = dryRunToken === currentToken;
  const diff = result?.ok && previewBase ? semanticDiff(previewBase, result.snapshot) : undefined;
  const diffCounts = diff
    ? {
        added: diff.addedVariables.length + diff.addedNodes.length + diff.addedConnections.length,
        changed: diff.changedVariables.length + diff.changedNodes.length,
        removed:
          diff.removedVariables.length + diff.removedNodes.length + diff.removedConnections.length,
      }
    : undefined;
  const diffChangeCount = diffCounts
    ? diffCounts.added + diffCounts.changed + diffCounts.removed
    : 0;
  const layoutNodeIds = result?.ok && aiCommandProposal ? aiCommandProposal.layoutNodeIds : [];
  const reviewChangeCount = diffChangeCount + layoutNodeIds.length;
  const errors = [providerError, clipboardError, localError, diagnosticText(result)]
    .filter(Boolean)
    .join('\n');
  const retryContext = errors
    ? [
        'Your previous Story Blueprint command was rejected.',
        'Return a complete corrected JSON transaction only. Do not explain the correction.',
        `Use the current baseRevision ${semanticSnapshot.revision}.`,
        '',
        'VALIDATION DIAGNOSTICS:',
        errors,
        '',
        'REJECTED RESPONSE:',
        commandText,
        '',
        contextText,
      ].join('\n')
    : '';

  useEffect(() => {
    setDryRunToken(undefined);
  }, [semanticSnapshot.revision]);

  useEffect(() => {
    let disposed = false;
    const newSessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    setLoadedChatScope('');
    setChatSessions([]);
    setActiveChatSessionId(newSessionId);
    chatCreatedAtRef.current = createdAt;
    setChatTitle('');
    setConversation([]);
    setConversationHistory([]);
    setAttachments([]);
    setLastUserRequest('');
    setModelReasoning(undefined);
    setResult(undefined);
    setPreviewBase(undefined);
    setDryRunToken(undefined);
    if (!chatScopeKey || !window.electronAPI) {
      setLoadedChatScope(chatScopeKey);
      return () => {
        disposed = true;
      };
    }
    void window.electronAPI
      .listAIChatSessions(chatScopeKey)
      .then((sessions) => {
        if (disposed) return;
        setChatSessions(sessions);
        const latest = sessions[0];
        if (latest) {
          skipNextChatSaveRef.current = true;
          setActiveChatSessionId(latest.id);
          chatCreatedAtRef.current = latest.createdAt;
          setChatTitle(latest.title);
          setConversation([...latest.messages]);
          setConversationHistory([...latest.history]);
          setLastUserRequest(
            [...latest.messages].reverse().find((message) => message.role === 'user')?.content ??
              '',
          );
        }
        setLoadedChatScope(chatScopeKey);
      })
      .catch((error) => {
        if (disposed) return;
        setProviderError(error instanceof Error ? error.message : String(error));
        setLoadedChatScope(chatScopeKey);
      });
    return () => {
      disposed = true;
    };
  }, [chatScopeKey]);

  useEffect(() => {
    if (chatTitle.trim() || conversation.length === 0) return;
    const firstUserMessage = conversation.find((message) => message.role === 'user')?.content;
    if (firstUserMessage) setChatTitle(compactText(firstUserMessage, 64));
  }, [chatTitle, conversation]);

  useEffect(() => {
    if (
      !window.electronAPI ||
      !chatScopeKey ||
      loadedChatScope !== chatScopeKey ||
      !activeChatSessionId ||
      conversation.length === 0
    ) {
      return;
    }
    if (skipNextChatSaveRef.current) {
      skipNextChatSaveRef.current = false;
      return;
    }
    const now = new Date().toISOString();
    const title = compactText(chatTitle, 120) || 'New conversation';
    const session: AIChatSession = {
      id: activeChatSessionId,
      scopeKey: chatScopeKey,
      title,
      createdAt: chatCreatedAtRef.current,
      updatedAt: now,
      messages: conversation,
      history: conversationHistory,
    };
    setChatSessions((sessions) => [
      session,
      ...sessions.filter((candidate) => candidate.id !== session.id),
    ]);
    void window.electronAPI
      .saveAIChatSession(session)
      .catch((error) => setProviderError(error instanceof Error ? error.message : String(error)));
  }, [
    activeChatSessionId,
    chatScopeKey,
    conversation,
    conversationHistory,
    loadedChatScope,
    chatTitle,
  ]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation, generating, pendingUserMessage]);

  useEffect(() => {
    let disposed = false;
    void window.electronAPI
      ?.getAIProviderRegistry()
      .then((registry) => {
        if (disposed) return;
        const active = registry.providers.find(
          (profile) => profile.id === registry.activeProviderId,
        );
        setProviderRegistry(registry);
        if (active) setProviderDraft(draftFromProvider(active));
        setShowProviderSettings(!active?.model);
      })
      .catch((error) => {
        if (!disposed) setProviderError(error instanceof Error ? error.message : String(error));
      });
    void window.electronAPI
      ?.getAIInstructionsStatus()
      .then((status) => {
        if (!disposed) setInstructionsStatus(status);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (requestIdRef.current) window.electronAPI?.cancelAICommand(requestIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    return window.electronAPI.onAIStreamProgress((progress: AIStreamProgress) => {
      if (progress.requestId !== requestIdRef.current) return;
      if (progress.reasoningDelta) {
        setModelReasoning((current) => `${current ?? ''}${progress.reasoningDelta}`);
      }
      if (progress.contentDelta) {
        setStreamedContent((current) => current + progress.contentDelta);
      }
      if (progress.phase === 'connecting') setProviderStatus('Connecting to provider…');
      else if (progress.phase === 'thinking') setProviderStatus('Thinking…');
      else if (progress.phase === 'writing') {
        setProviderStatus('Writing response…');
      } else if (progress.phase === 'completed') setProviderStatus('Finalizing response…');
    });
  }, []);

  const dryRunText = (text: string): BlueprintTransactionResult | undefined => {
    setLocalError(undefined);
    let command: unknown;
    try {
      command = JSON.parse(text) as unknown;
    } catch (error) {
      setLocalError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      setShowTechnicalDetails(true);
      return undefined;
    }
    if (command === undefined) return undefined;
    const normalizedCommand = normalizeAIBlueprintCommand(command, semanticSnapshot.revision);
    const wasNormalized = JSON.stringify(normalizedCommand) !== JSON.stringify(command);
    const normalizedText = wasNormalized ? JSON.stringify(normalizedCommand, null, 2) : text;
    if (wasNormalized) setCommandText(normalizedText);
    const relativeOverwrites = relativeVariableOverwriteOperations(
      normalizedCommand,
      lastUserRequest || instruction,
    );
    if (relativeOverwrites.length > 0) {
      setLocalError(
        `RELATIVE_VARIABLE_OVERWRITE: ${relativeOverwrites.join(', ')} assigns a numeric literal even though the request describes a relative change. Use add-variable-adjustment with variableId and signed delta.`,
      );
      setShowTechnicalDetails(true);
      setResult(undefined);
      setDryRunToken(undefined);
      return undefined;
    }
    const next = executeBlueprintCommands(normalizedCommand, { dryRun: true, stage: true });
    setResult(next);
    setPreviewBase(semanticSnapshot);
    setDryRunToken(next.ok ? `${semanticSnapshot.revision}\n${normalizedText}` : undefined);
    setShowDiffDetails(false);
    return next;
  };

  const dryRun = () => dryRunText(commandText);

  const apply = () => {
    if (dryRunToken !== currentToken) return;
    const next = applyAIProposal();
    if (!next) return;
    setResult(next);
    setDryRunToken(undefined);
  };

  const discardPreview = () => {
    discardAIProposal();
    setDryRunToken(undefined);
    setProviderStatus('Proposal discarded · Story unchanged');
  };

  const saveProviderSettings = async (apiKey?: string) => {
    if (!providerDraft || !window.electronAPI) return;
    setProviderError(undefined);
    try {
      const registry = await window.electronAPI.saveAIProviderProfile({
        ...(providerDraft.id ? { id: providerDraft.id } : {}),
        name: providerDraft.name,
        endpoint: providerDraft.endpoint,
        model: providerDraft.model,
        timeoutMs: Math.round(providerDraft.timeoutSeconds * 1_000),
        temperature: providerDraft.temperature,
        maxTokens: providerDraft.maxTokens,
        structuredOutput: providerDraft.structuredOutput,
        thinkingMode: providerDraft.thinkingMode,
        reasoningEffort: providerDraft.reasoningEffort,
        streaming: providerDraft.streaming,
        tools: providerDraft.tools,
        contextMode: providerDraft.contextMode,
        ...(apiKey === undefined ? {} : { apiKey }),
      });
      const saved = registry.providers.find((profile) => profile.id === registry.activeProviderId);
      setProviderRegistry(registry);
      if (saved) setProviderDraft(draftFromProvider(saved));
      setApiKeyDraft('');
      setProviderStatus(apiKey === '' ? 'API Key removed' : 'Provider settings saved');
      if (saved?.model) setShowProviderSettings(false);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const selectProvider = async (providerId: string) => {
    if (!window.electronAPI) return;
    try {
      const registry = await window.electronAPI.selectAIProvider(providerId);
      const active = registry.providers.find((profile) => profile.id === registry.activeProviderId);
      setProviderRegistry(registry);
      if (active) setProviderDraft(draftFromProvider(active));
      setApiKeyDraft('');
      setProviderError(undefined);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteProvider = async () => {
    if (!providerDraft?.id || !window.electronAPI) return;
    if (
      !window.confirm(
        `Delete AI provider "${providerDraft.name}"? Its saved API key will also be removed.`,
      )
    ) {
      return;
    }
    try {
      const registry = await window.electronAPI.deleteAIProviderProfile(providerDraft.id);
      const active = registry.providers.find((profile) => profile.id === registry.activeProviderId);
      setProviderRegistry(registry);
      if (active) setProviderDraft(draftFromProvider(active));
      setApiKeyDraft('');
      setProviderStatus('Provider removed');
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const addProvider = () => {
    setProviderDraft(createProviderDraft());
    setApiKeyDraft('');
    setProviderError(undefined);
    setShowProviderSettings(true);
  };

  const generate = async (retry = false, customInstruction?: string) => {
    if (!window.electronAPI) {
      setProviderError('AI generation is available only in the desktop editor');
      return;
    }
    if (!activeProvider?.model) {
      setProviderError('Configure an AI provider and model before generating commands');
      setShowProviderSettings(true);
      return;
    }
    const requestInstruction = retry
      ? lastUserRequest
      : (customInstruction !== undefined ? customInstruction.trim() : instruction.trim());
    if (!requestInstruction) {
      setProviderError(retry ? 'There is no previous request to retry' : 'Enter a message first');
      return;
    }
    if (contextScope === 'selection' && selectedNodeIds.length === 0) {
      setProviderError('Select one or more nodes, or choose Current Graph / Whole Story');
      return;
    }
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setGenerating(true);
    setPendingUserMessage(
      retry
        ? 'Please correct the proposed change using the validation diagnostics.'
        : requestInstruction,
    );
    setModelReasoning(undefined);
    setStreamedContent('');
    setRawAIResponse(undefined);
    setToolTrace([]);
    setProviderError(undefined);
    setProviderStatus(retry ? 'Retrying with validation diagnostics…' : 'Working…');
    if (!retry) setLastUserRequest(requestInstruction);
    try {
      let response: { content: string; model: string; reasoning?: string } | undefined;
      let assistant: ReturnType<typeof parseAIAssistantResponse> | undefined;
      let toolContext = '';
      for (let toolRound = 0; toolRound < 4; toolRound += 1) {
        if (toolRound > 0) setProviderStatus(`Reading Story context · tool ${toolRound}/3…`);
        response = await window.electronAPI.generateAICommand({
          requestId,
          providerId: activeProvider?.id ?? '',
          instruction: retry
            ? `Correct the rejected command for this request: ${requestInstruction}`
            : requestInstruction,
          context: `${retry && retryContext ? retryContext : contextText}${toolContext}`,
          schema: AI_ASSISTANT_RESPONSE_SCHEMA,
          history: conversationHistory,
          attachments,
        });
        assistant = parseAIAssistantResponse(response.content, semanticSnapshot.revision);
        if (!assistant.toolRequest || activeProvider.tools === 'disabled') break;
        if (toolRound === 3) throw new Error('AI requested too many context tool calls');
        const toolResult = runAIContextTool(semanticSnapshot, assistant.toolRequest, (command) =>
          executeBlueprintCommands(command, { dryRun: true }),
        );
        const boundedResult = boundedToolResult(toolResult);
        setToolTrace((trace) => [
          ...trace,
          {
            name: assistant!.toolRequest!.name,
            arguments: assistant!.toolRequest!.arguments,
            result: boundedResult.text,
          },
        ]);
        toolContext += `\n\nREAD-ONLY TOOL RESULT (${assistant.toolRequest.name})${boundedResult.truncated ? ' · truncated' : ''}:\n${boundedResult.text}\n\nUse this result to answer the original request. Do not request another tool unless essential.`;
      }
      if (!response || !assistant) throw new Error('AI provider returned no final response');
      setRawAIResponse(response.content);
      const userMessage = retry
        ? 'Please correct the proposed change using the validation diagnostics.'
        : requestInstruction;
      setConversation((messages) => {
        const next: AIConversationMessage[] = [
          ...messages,
          { role: 'user', content: userMessage },
          {
            role: 'assistant',
            content: assistant.reply,
            ...(response.reasoning ? { reasoning: response.reasoning } : {}),
          },
        ];
        return next.slice(-40);
      });
      setConversationHistory((messages) => {
        const next: AIConversationMessage[] = [
          ...messages,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: response.content },
        ];
        return next.slice(-40);
      });
      setModelReasoning(response.reasoning);
      setStreamedContent('');
      setInstruction('');
      if (assistant.command) {
        const command = JSON.stringify(
          normalizeAIBlueprintCommand(assistant.command, semanticSnapshot.revision),
          null,
          2,
        );
        setCommandText(command);
        const dryRunResult = dryRunText(command);
        setProviderStatus(
          dryRunResult?.ok
            ? `Proposed${response.model ? ` by ${response.model}` : ''}${assistant.jsonRepaired ? ' · repaired unescaped quotes' : ''} · preview ready`
            : `Proposal from ${response.model || 'AI'} was rejected (model format mismatch) · see diagnostics`,
        );
      } else {
        discardAIProposal();
        setResult(undefined);
        setPreviewBase(undefined);
        setDryRunToken(undefined);
        setProviderStatus(
          assistant.needsClarification
            ? 'Clarification needed before proposing an edit'
            : assistant.unstructured
              ? `Response from ${response.model || 'provider'} was not a Blueprint JSON command`
              : `Answered${response.model ? ` by ${response.model}` : ''}`,
        );
      }
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
      setProviderStatus(undefined);
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = undefined;
      setPendingUserMessage(undefined);
      setGenerating(false);
    }
  };

  const addAttachments = async () => {
    if (!window.electronAPI) return;
    setProviderError(undefined);
    try {
      const selected = await window.electronAPI.pickAIContextFiles();
      setAttachments((current) => {
        const ids = new Set(current.map((attachment) => attachment.id));
        return [...current, ...selected.filter((attachment) => !ids.has(attachment.id))].slice(
          0,
          8,
        );
      });
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingFiles(false);
      }
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFiles(false);

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) return;

    void (async () => {
      try {
        const result = await processDroppedAIContextFiles(droppedFiles, attachments);
        if (result.attachments.length > 0) {
          setAttachments((current) => [...current, ...result.attachments].slice(0, 8));
        }
        if (result.warnings.length > 0) {
          setProviderError(result.warnings.join(' '));
        }
      } catch (error) {
        setProviderError(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const clearProposal = () => {
    discardAIProposal();
    setResult(undefined);
    setPreviewBase(undefined);
    setDryRunToken(undefined);
    setModelReasoning(undefined);
    setRawAIResponse(undefined);
    setProviderStatus(undefined);
    setLocalError(undefined);
    setToolTrace([]);
  };

  const activateChatSession = (session: AIChatSession) => {
    skipNextChatSaveRef.current = true;
    setActiveChatSessionId(session.id);
    chatCreatedAtRef.current = session.createdAt;
    setChatTitle(session.title);
    setConversation([...session.messages]);
    setConversationHistory([...session.history]);
    setAttachments([]);
    setLastUserRequest(
      [...session.messages].reverse().find((message) => message.role === 'user')?.content ?? '',
    );
    setInstruction('');
    clearProposal();
  };

  const startNewChat = () => {
    setActiveChatSessionId(crypto.randomUUID());
    chatCreatedAtRef.current = new Date().toISOString();
    setChatTitle('');
    setConversation([]);
    setConversationHistory([]);
    setAttachments([]);
    setLastUserRequest('');
    setInstruction('');
    clearProposal();
  };

  const deleteActiveChat = async () => {
    const session = chatSessions.find((candidate) => candidate.id === activeChatSessionId);
    if (!session || !window.electronAPI) return;
    if (!window.confirm(`Delete conversation "${session.title}"? This cannot be undone.`)) return;
    try {
      await window.electronAPI.deleteAIChatSession(chatScopeKey, session.id);
      const remaining = chatSessions.filter((candidate) => candidate.id !== session.id);
      setChatSessions(remaining);
      if (remaining[0]) activateChatSession(remaining[0]);
      else startNewChat();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!hasActiveStory) {
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>Open a Story to use AI Commands</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <section
        className={styles.requestPane}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className={styles.dropOverlay}>
            <div className={styles.dropOverlayTitle}>Drop files to attach</div>
            <div className={styles.dropOverlayHint}>
              Add text, script, or markdown files to AI reference context
            </div>
          </div>
        )}
        <div className={styles.requestHeader}>
          <div className={styles.assistantTitle}>
            <strong>Story Assistant</strong>
            <span>
              {semanticSnapshot.story.displayName} · {semanticSnapshot.revision}
            </span>
          </div>
          <input
            className={styles.chatTitleInput}
            aria-label="Conversation name"
            value={chatTitle}
            maxLength={120}
            placeholder="Conversation name"
            disabled={generating}
            onChange={(event) => setChatTitle(event.target.value)}
            onBlur={(event) => setChatTitle(event.target.value.trim())}
          />
          {chatSessions.length > 0 && (
            <select
              className={styles.sessionPicker}
              value={activeChatSessionId}
              disabled={generating}
              title="Conversation history"
              onChange={(event) => {
                const session = chatSessions.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (session) activateChatSession(session);
              }}
            >
              {!chatSessions.some((session) => session.id === activeChatSessionId) && (
                <option value={activeChatSessionId}>New conversation</option>
              )}
              {chatSessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={startNewChat} disabled={generating}>
            New Chat
          </button>
          {chatSessions.some((session) => session.id === activeChatSessionId) && (
            <button
              type="button"
              className={styles.deleteChatButton}
              onClick={() => void deleteActiveChat()}
              disabled={generating}
            >
              Delete
            </button>
          )}
          {providerRegistry && (
            <select
              className={styles.providerPicker}
              aria-label="Active AI provider"
              value={providerRegistry.activeProviderId}
              disabled={generating}
              onChange={(event) => void selectProvider(event.target.value)}
              title="Active AI provider"
            >
              {providerRegistry.providers.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={styles.providerButton}
            onClick={() => setShowProviderSettings((visible) => !visible)}
          >
            {showProviderSettings ? 'Hide Provider' : 'Provider Settings'}
          </button>
        </div>
        {showProviderSettings && providerDraft && (
          <div className={styles.providerSettings}>
            <label>
              <span>Provider</span>
              <select
                value={providerDraft.id ?? ''}
                disabled={generating}
                onChange={(event) => {
                  if (event.target.value) void selectProvider(event.target.value);
                }}
              >
                {!providerDraft.id && <option value="">New provider</option>}
                {providerRegistry?.providers.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Provider name</span>
              <input
                value={providerDraft.name}
                disabled={generating}
                maxLength={120}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, name: event.target.value })
                }
                placeholder="e.g. DeepSeek"
              />
            </label>
            <label>
              <span>OpenAI-compatible endpoint</span>
              <input
                value={providerDraft.endpoint}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, endpoint: event.target.value })
                }
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={providerDraft.model}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, model: event.target.value })
                }
                placeholder="Provider model ID"
              />
            </label>
            <label>
              <span>Timeout (seconds)</span>
              <input
                type="number"
                min={5}
                max={600}
                value={providerDraft.timeoutSeconds}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    timeoutSeconds: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Temperature · {providerDraft.temperature.toFixed(2)} (0.2~0.3 for blueprints, 0.7 for discussion)</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={providerDraft.temperature}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    temperature: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                  })
                }
              />
            </label>
            <label>
              <span>Max tokens</span>
              <input
                type="number"
                min={512}
                max={65536}
                step={512}
                value={providerDraft.maxTokens}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    maxTokens: Math.max(512, Math.min(65536, Number(event.target.value) || 8192)),
                  })
                }
              />
            </label>
            <label>
              <span>Structured output</span>
              <select
                value={providerDraft.structuredOutput}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    structuredOutput: event.target.value as AIStructuredOutputMode,
                  })
                }
              >
                <option value="json-schema">JSON Schema</option>
                <option value="json-object">JSON Object (compatible)</option>
                <option value="disabled">Disabled (prompt-guided / reasoning models)</option>
              </select>
            </label>
            <label>
              <span>Thinking</span>
              <select
                value={providerDraft.thinkingMode}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    thinkingMode: event.target.value as AIThinkingMode,
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label>
              <span>Reasoning effort · when enabled</span>
              <select
                value={providerDraft.reasoningEffort}
                disabled={providerDraft.thinkingMode !== 'enabled'}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    reasoningEffort: event.target.value as AIReasoningEffort,
                  })
                }
              >
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
            </label>
            <label>
              <span>Streaming</span>
              <select
                value={providerDraft.streaming}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    streaming: event.target.value as AIStreamingMode,
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="required">Required</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label>
              <span>Context loading</span>
              <select
                value={providerDraft.contextMode}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    contextMode: event.target.value as AIContextMode,
                  })
                }
              >
                <option value="full">Full snapshot</option>
                <option value="compact">Compact snapshot</option>
                <option value="manifest-first">Manifest first</option>
              </select>
            </label>
            <label>
              <span>Read-only tools</span>
              <select
                value={providerDraft.tools}
                disabled={generating}
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, tools: event.target.value as AIToolsMode })
                }
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className={styles.apiKeyField}>
              <span>
                API Key {editingProvider?.hasApiKey ? '· securely saved' : '· optional locally'}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder={editingProvider?.hasApiKey ? 'Leave blank to keep saved key' : 'sk-…'}
              />
            </label>
            <div className={styles.providerActions}>
              <button
                type="button"
                onClick={() => void saveProviderSettings(apiKeyDraft || undefined)}
                disabled={generating}
              >
                {providerDraft.id ? 'Save Provider' : 'Add Provider'}
              </button>
              <button type="button" onClick={addProvider} disabled={generating}>
                New Provider
              </button>
              {editingProvider?.hasApiKey && (
                <button
                  type="button"
                  onClick={() => void saveProviderSettings('')}
                  disabled={generating}
                >
                  Remove Key
                </button>
              )}
              {providerDraft.id && providerRegistry && providerRegistry.providers.length > 1 && (
                <button type="button" onClick={() => void deleteProvider()} disabled={generating}>
                  Delete Provider
                </button>
              )}
            </div>
          </div>
        )}
        <div className={styles.conversation} ref={conversationRef}>
          <div className={styles.contextBar}>
            <span>Latest context</span>
            <strong>
              {contextScope === 'story'
                ? 'Whole Story'
                : contextScope === 'graph'
                  ? 'Current Graph'
                  : `${selectedNodeIds.length} selected`}
            </strong>
            {instructionsStatus && (
              <span title={instructionsStatus.projectInstructionsPath}>
                Rules v{instructionsStatus.builtInVersion} · Project AI{' '}
                {instructionsStatus.projectInstructions}
              </span>
            )}
          </div>
          {conversation.length === 0 ? (
            <div className={styles.welcomeMessage}>
              <strong>What would you like to work on?</strong>
              <span>
                Ask about the current story, explore an idea, or request a Blueprint change. I will
                inspect the latest story state before answering.
              </span>
            </div>
          ) : (
            conversation.map((message, index) => (
              <div className={styles.chatMessage} data-role={message.role} key={index}>
                <strong>{message.role === 'user' ? 'You' : 'AI'}</strong>
                <div className={styles.chatMessageBody}>
                  {message.role === 'assistant' && message.reasoning && (
                    <details className={styles.inlineReasoning}>
                      <summary>
                        <span>
                          Thinking process · {message.reasoning.length.toLocaleString()} characters
                        </span>
                        <span
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <CopyButton text={message.reasoning} label="Copy Reasoning" />
                        </span>
                      </summary>
                      <pre>{message.reasoning}</pre>
                    </details>
                  )}
                  <span className={styles.chatMessageText}>{message.content}</span>
                </div>
              </div>
            ))
          )}
          {pendingUserMessage && (
            <div className={styles.chatMessage} data-role="user">
              <strong>You</strong>
              <div className={styles.chatMessageBody}>
                <span className={styles.chatMessageText}>{pendingUserMessage}</span>
              </div>
            </div>
          )}
          {generating && (
            <div className={styles.activityMessage}>
              <span className={styles.activitySpinner} aria-hidden="true" />
              <div className={styles.activityContent}>
                <strong>{providerStatus || 'Working on your request'}</strong>
                <span>
                  Reading the latest{' '}
                  {contextScope === 'story'
                    ? 'Story'
                    : contextScope === 'graph'
                      ? 'Graph'
                      : 'selection'}{' '}
                  and checking the Blueprint contract…
                </span>
                {modelReasoning && (
                  <details className={styles.inlineReasoning} open>
                    <summary>
                      <span>
                        Thinking process · {modelReasoning.length.toLocaleString()} characters
                      </span>
                      <span
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <CopyButton text={modelReasoning} label="Copy Reasoning" />
                      </span>
                    </summary>
                    <pre>{modelReasoning}</pre>
                  </details>
                )}
                {streamedContent && <pre className={styles.streamedContent}>{streamedContent}</pre>}
              </div>
            </div>
          )}
        </div>
        {followUpSuggestions.length > 0 && !generating && (
          <div className={styles.followUpBar}>
            <span className={styles.followUpLabel}>💡 建议追问:</span>
            {followUpSuggestions.map((sug, i) => (
              <button
                key={i}
                type="button"
                className={styles.followUpChip}
                onClick={() => {
                  setInstruction(sug);
                  void generate(false, sug);
                }}
              >
                {sug}
              </button>
            ))}
          </div>
        )}
        <AIQuickActions
          semanticSnapshot={semanticSnapshot}
          activeGraphId={activeGraphId}
          selectedNodes={nodes
            .filter((node) => node.selected)
            .map((node) => ({
              id: node.id,
              type: node.type as StoryNodeType,
              data: node.data,
            }))}
          disabled={generating}
          onSelectCommand={(cmd) => {
            applySlashCommand(cmd);
          }}
          onApplyPrompt={(prompt, autoSend, recommendedScope) => {
            setInstruction(prompt);
            if (recommendedScope) {
              setContextScope(recommendedScope);
            }
            if (autoSend) {
              void generate(false, prompt);
            }
          }}
        />
        <div className={styles.composer}>
          {slashMenuMatch && slashMenuMatch.commands.length > 0 && (
            <div className={styles.slashMenu} role="listbox" aria-label="Slash commands">
              <div className={styles.slashMenuHeader}>
                <span>快捷指令 (按 ↑↓ 选择，Enter 填入)</span>
                <span>ESC 关闭</span>
              </div>
              {slashMenuMatch.commands.map((cmd, idx) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={idx === selectedSlashIndex}
                  className={`${styles.slashMenuItem} ${idx === selectedSlashIndex ? styles.slashMenuItemSelected : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlashCommand(cmd);
                  }}
                  onMouseEnter={() => setSelectedSlashIndex(idx)}
                >
                  <span className={styles.slashMenuIcon}>{cmd.icon}</span>
                  <div className={styles.slashMenuBody}>
                    <div className={styles.slashMenuCommandName}>
                      <span>{cmd.command}</span>
                      <span className={styles.slashMenuLabel}>{cmd.label}</span>
                    </div>
                    <div className={styles.slashMenuDesc}>{cmd.description}</div>
                  </div>
                  <span className={styles.slashMenuBadge}>
                    {cmd.recommendedScope === 'selection' ? 'Context: 选中' : 'Context: 蓝图'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className={styles.instruction}
            value={instruction}
            disabled={generating}
            onChange={(event) => {
              const val = event.target.value;
              setInstruction(val);
              const cursorPos = event.target.selectionStart ?? val.length;
              const match = findMatchingSlashCommands(val, cursorPos);
              setSlashMenuMatch(match);
              setSelectedSlashIndex(0);
            }}
            onClick={(event) => {
              const cursorPos = event.currentTarget.selectionStart ?? instruction.length;
              const match = findMatchingSlashCommands(instruction, cursorPos);
              setSlashMenuMatch(match);
              setSelectedSlashIndex(0);
            }}
            onKeyDown={(event) => {
              if (slashMenuMatch && slashMenuMatch.commands.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedSlashIndex((prev) => (prev + 1) % slashMenuMatch.commands.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedSlashIndex(
                    (prev) => (prev - 1 + slashMenuMatch.commands.length) % slashMenuMatch.commands.length,
                  );
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  if (!event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    const cmd = slashMenuMatch.commands[selectedSlashIndex];
                    if (cmd) {
                      applySlashCommand(cmd);
                      return;
                    }
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSlashMenuMatch(null);
                  return;
                }
              }

              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !generating
              ) {
                event.preventDefault();
                setSlashMenuMatch(null);
                void generate();
              }
            }}
            placeholder="Ask about the story, request a change, or type / for commands…"
          />
          {attachments.length > 0 && (
            <div
              className={styles.attachments}
              aria-label="Attached AI reference files"
              title="Reference files are included with every message in this conversation until removed."
            >
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  title={`${attachment.name} · ${attachment.content.length.toLocaleString()} characters`}
                >
                  {attachment.name}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    disabled={generating}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={styles.requestControls}>
            <label>
              <span>Context</span>
              <select
                value={contextScope}
                disabled={generating}
                onChange={(event) => setContextScope(event.target.value as AIContextScope)}
              >
                <option value="selection">Selection ({selectedNodeIds.length})</option>
                <option value="graph">Current Graph</option>
                <option value="story">Whole Story</option>
              </select>
            </label>
            <button type="button" disabled={generating} onClick={() => void addAttachments()}>
              Attach Files
            </button>
            <span className={styles.composerHint}>Enter to send · Shift+Enter for newline</span>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={generating || !activeProvider?.model || !instruction.trim()}
              onClick={() => void generate()}
            >
              {generating ? 'Thinking…' : 'Send'}
            </button>
            {generating && (
              <button
                type="button"
                onClick={() => {
                  if (requestIdRef.current) {
                    window.electronAPI?.cancelAICommand(requestIdRef.current);
                    setProviderStatus('Canceling…');
                  }
                }}
              >
                Cancel
              </button>
            )}
            {!generating && diagnosticText(result) && (
              <button type="button" onClick={() => void generate(true)}>
                Ask AI to Fix
              </button>
            )}
            <span className={styles.providerStatus}>
              {providerStatus ??
                (!activeProvider?.model ? 'Configure a provider and model to generate' : '')}
            </span>
          </div>
        </div>
      </section>

      {toolTrace.length > 0 && (
        <details className={styles.toolTracePane}>
          <summary>
            Story context tools · {toolTrace.length} call{toolTrace.length === 1 ? '' : 's'}
          </summary>
          <p>Read-only context retrieved for this response. Tool results never modify the Story.</p>
          {toolTrace.map((entry, index) => (
            <details key={`${entry.name}-${index}`} className={styles.toolTraceEntry}>
              <summary>{entry.name}</summary>
              <label>
                <span>Arguments</span>
                <textarea
                  readOnly
                  spellCheck={false}
                  value={JSON.stringify(entry.arguments, null, 2)}
                />
              </label>
              <label>
                <span>Result · {entry.result.length.toLocaleString()} characters</span>
                <textarea readOnly spellCheck={false} value={entry.result} />
              </label>
            </details>
          ))}
        </details>
      )}

      <section className={styles.technicalPane} data-expanded={showTechnicalDetails}>
        <div className={styles.technicalSummary}>
          <button type="button" onClick={() => setShowTechnicalDetails((visible) => !visible)}>
            <span className={styles.disclosure}>{showTechnicalDetails ? '▾' : '▸'}</span>
            Command details
          </button>
          <span>JSON, semantic context and external AI tools</span>
          <code>{semanticSnapshot.revision}</code>
        </div>
        {showTechnicalDetails && (
          <>
            <header className={styles.toolbar}>
              <CopyButton text={contextText} label="Copy AI Context" />
              <CopyButton text={schemaText} label="Copy Schema" />
              <CopyButton text={snapshotText} label="Copy Snapshot" />
              {rawAIResponse && <CopyButton text={rawAIResponse} label="Copy AI Response" />}
              <button
                type="button"
                onClick={() => {
                  discardAIProposal();
                  setCommandText(commandTemplate(semanticSnapshot.revision));
                  setResult(undefined);
                  setPreviewBase(undefined);
                  setDryRunToken(undefined);
                  setLocalError(undefined);
                }}
              >
                New Template
              </button>
              <button
                type="button"
                onClick={() => {
                  setClipboardError(undefined);
                  void readClipboard()
                    .then((text) => {
                      discardAIProposal();
                      setCommandText(text);
                      setResult(undefined);
                      setPreviewBase(undefined);
                      setDryRunToken(undefined);
                      setLocalError(undefined);
                    })
                    .catch((error) =>
                      setClipboardError(error instanceof Error ? error.message : String(error)),
                    );
                }}
              >
                Paste Command
              </button>
            </header>

            <div className={styles.editors}>
              <label className={styles.editorPane}>
                <span>Semantic Snapshot · read only</span>
                <textarea readOnly spellCheck={false} value={snapshotText} />
              </label>
              <label className={styles.editorPane}>
                <span>Blueprint Command JSON</span>
                <textarea
                  spellCheck={false}
                  value={commandText}
                  onChange={(event) => {
                    discardAIProposal();
                    setCommandText(event.target.value);
                    setResult(undefined);
                    setPreviewBase(undefined);
                    setDryRunToken(undefined);
                    setLocalError(undefined);
                  }}
                />
              </label>
              {rawAIResponse && (
                <label className={styles.editorPane}>
                  <span>Raw AI Response · read only</span>
                  <textarea readOnly spellCheck={false} value={rawAIResponse} />
                </label>
              )}
            </div>
          </>
        )}
      </section>

      {(result || errors || showTechnicalDetails) && (
        <section className={styles.resultPane}>
          <div className={styles.actionRow}>
            {result && <strong className={styles.proposalTitle}>Blueprint proposal</strong>}
            {showTechnicalDetails && (
              <button type="button" className={styles.primaryButton} onClick={dryRun}>
                Dry Run
              </button>
            )}
            {result?.ok && !result.committed && aiCommandProposal && (
              <>
                <button
                  type="button"
                  className={styles.applyButton}
                  disabled={!isDryRunCurrent}
                  onClick={apply}
                >
                  Apply Preview
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard
                </button>
              </>
            )}
            <span
              className={styles.resultStatus}
              data-status={result?.ok ? 'ok' : result ? 'error' : 'idle'}
            >
              {result?.ok
                ? result.committed
                  ? 'Applied · Undo available'
                  : isDryRunCurrent
                    ? aiCommandProposal
                      ? 'Preview ready · arrange green nodes on the canvas'
                      : 'Preview discarded'
                    : 'Story changed · run Dry Run again'
                : result
                  ? 'Rejected · no changes applied'
                  : 'Edit or paste a command, then run Dry Run'}
            </span>
            {errors && <CopyButton text={errors} label="Copy Result" />}
            {errors && <CopyButton text={retryContext} label="Copy Retry Context" />}
          </div>

          {diff && (
            <div className={styles.diffSection}>
              <button
                type="button"
                className={styles.diffSummary}
                onClick={() => setShowDiffDetails((visible) => !visible)}
              >
                <span className={styles.disclosure}>{showDiffDetails ? '▾' : '▸'}</span>
                Review changes · {reviewChangeCount}
                {diffCounts && diffCounts.added > 0 && (
                  <span data-tone="added">+{diffCounts.added}</span>
                )}
                {diffCounts && diffCounts.changed > 0 && (
                  <span data-tone="changed">~{diffCounts.changed}</span>
                )}
                {diffCounts && diffCounts.removed > 0 && (
                  <span data-tone="removed">−{diffCounts.removed}</span>
                )}
                {layoutNodeIds.length > 0 && (
                  <span data-tone="changed">Layout {layoutNodeIds.length}</span>
                )}
              </button>
              {showDiffDetails && (
                <div className={styles.diffGrid}>
                  {(
                    [
                      ['Added variables', diff.addedVariables, 'added'],
                      ['Changed variables', diff.changedVariables, 'changed'],
                      ['Removed variables', diff.removedVariables, 'removed'],
                      ['Added nodes', diff.addedNodes, 'added'],
                      ['Changed nodes', diff.changedNodes, 'changed'],
                      ['Removed nodes', diff.removedNodes, 'removed'],
                      ['Added connections', diff.addedConnections, 'added'],
                      ['Removed connections', diff.removedConnections, 'removed'],
                      ['Layout nodes', layoutNodeIds, 'changed'],
                    ] as const
                  )
                    .filter(([, items]) => items.length > 0)
                    .map(([label, items, tone]) => (
                      <div className={styles.diffGroup} data-tone={tone} key={label}>
                        <strong>
                          {label} · {items.length}
                        </strong>
                        {items.map((item) => (
                          <code key={item}>{item}</code>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
          {errors && (
            <div className={styles.diagnosticsContainer}>
              {(() => {
                const analysis = analyzeDiagnostics(errors);
                if (!analysis) return null;
                return (
                  <div className={styles.modelFailureBanner}>
                    <div className={styles.modelFailureHeader}>
                      <span className={styles.modelFailureBadge}>⚠️ 模型指令遵循异常</span>
                      <strong className={styles.modelFailureTitle}>
                        当前模型 ({activeProvider?.model || 'AI'}) 生成的指令格式存在缺陷
                      </strong>
                    </div>
                    <p className={styles.modelFailureDesc}>
                      AI 模型未能完全遵循 StoryBlueprint 的蓝图数据契约。为了防止损坏故事工程，系统已在沙盒校验（Dry Run）中安全拦截，未对项目应用任何更改。
                    </p>
                    {analysis.reasons.length > 0 && (
                      <ul className={styles.modelFailureReasons}>
                        {analysis.reasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    <div className={styles.modelFailureAdvice}>
                      <div>
                        <strong>💡 尝试自动纠错：</strong>
                        <span>点击上方 <strong>“Ask AI to Fix”</strong> 按钮，系统会携带错题本向模型发起自愈重试。</span>
                      </div>
                      <div>
                        <strong>⚙️ 更换模型建议：</strong>
                        <span>若该模型反复出现此类格式错误，通常是因为小参数量或未针对结构化输出微调的模型遵循能力不足。建议在右上角 ⚙️ 设置中切换为更强推理模型（如 DeepSeek-V3 / DeepSeek-R1、Claude 3.5 Sonnet、GPT-4o）。</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <details className={styles.rawErrorsDetails}>
                <summary>查看底层校验诊断详情 (Raw Validation Diagnostics)</summary>
                <pre className={styles.errors}>{errors}</pre>
              </details>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
