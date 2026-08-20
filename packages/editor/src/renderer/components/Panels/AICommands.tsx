import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_EXAMPLE,
  BLUEPRINT_COMMAND_JSON_SCHEMA,
  BLUEPRINT_NODE_CATALOG,
  BLUEPRINT_COMMAND_VERSION,
  StoryNodeType,
  type BlueprintTransactionResult,
  type StoryNodeDataMap,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import type {
  AIChatSession,
  AIConversationMessage,
  AIFileAttachment,
  AIProviderSettings,
  AIReasoningEffort,
  AIStructuredOutputMode,
  AIThinkingMode,
} from '../../../shared/electronApi';
import { normalizeAIBlueprintCommand, parseAIAssistantResponse } from '../../../shared/aiProvider';
import { CopyButton } from './CopyButton';
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
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  structuredOutput: AIStructuredOutputMode;
  thinkingMode: AIThinkingMode;
  reasoningEffort: AIReasoningEffort;
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
  },
} as const;

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
  } else if (node.type === StoryNodeType.Choice) {
    content = (node.data as StoryNodeDataMap[StoryNodeType.Choice]).prompt.source;
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
): string {
  const example = { ...BLUEPRINT_COMMAND_EXAMPLE, baseRevision: snapshot.revision };
  return [
    'Use this semantic Story Blueprint state to answer the author or propose an edit.',
    'Answer questions normally. Ask for clarification instead of guessing important story intent.',
    `Any proposed command MUST validate against the ${BLUEPRINT_COMMAND_FORMAT}@${BLUEPRINT_COMMAND_VERSION} JSON Schema below.`,
    'The top-level array is named operations, never commands.',
    'A graph is an object such as { "kind": "root" }, never the string "root".',
    'Never emit ports, positions, definitionVersion, UI state, or fields not allowed by the schema.',
    'Use the Node Catalog for add-node data and port IDs; ports are always derived by the editor.',
    'IMPORTANT TEXT SHAPES: add-node data uses { "source": "text" } as shown in the Node Catalog, but add-dialogue-line, update-dialogue-line, add-choice-option, and update-choice-option use a plain string for text.',
    'Use replaceExisting: true on connect only when replacing an occupied compatible port.',
    'Preserve stable IDs unless explicitly adding or removing an object.',
    `Set baseRevision to ${snapshot.revision}.`,
    ...(scope
      ? [
          `The provided context scope is ${scope.kind}.`,
          `All operations MUST target the active graph: ${scope.activeGraphId === 'root' ? '{ "kind": "root" }' : `{ "kind": "chapter", "chapterId": "${scope.activeGraphId}" }`}. Other graphs are read-only context.`,
          scope.kind === 'selection'
            ? `The explicitly selected node IDs are: ${scope.selectedNodeIds.join(', ')}. Neighbor nodes are included only to show connection boundaries.`
            : '',
        ].filter(Boolean)
      : []),
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
    'CURRENT SEMANTIC SNAPSHOT:',
    JSON.stringify(snapshot, null, 2),
  ].join('\n');
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
  const [contextScope, setContextScope] = useState<AIContextScope>('story');
  const [providerSettings, setProviderSettings] = useState<AIProviderSettings>();
  const [providerDraft, setProviderDraft] = useState<AIProviderDraft>();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [providerError, setProviderError] = useState<string>();
  const [providerStatus, setProviderStatus] = useState<string>();
  const [modelReasoning, setModelReasoning] = useState<string>();
  const [conversation, setConversation] = useState<AIConversationMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<AIConversationMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<AIChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState('');
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
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );
  const scopedSemanticSnapshot = useMemo(
    () => scopedSnapshot(semanticSnapshot, contextScope, activeGraphId, selectedNodeIds),
    [activeGraphId, contextScope, selectedNodeIds, semanticSnapshot],
  );
  const snapshotText = useMemo(() => JSON.stringify(semanticSnapshot, null, 2), [semanticSnapshot]);
  const contextText = useMemo(
    () => aiContext(scopedSemanticSnapshot, { kind: contextScope, activeGraphId, selectedNodeIds }),
    [activeGraphId, contextScope, scopedSemanticSnapshot, selectedNodeIds],
  );
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
    setConversation([]);
    setConversationHistory([]);
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
    const firstUserMessage = conversation.find((message) => message.role === 'user')?.content ?? '';
    const title = compactText(firstUserMessage, 64) || 'New conversation';
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
  }, [activeChatSessionId, chatScopeKey, conversation, conversationHistory, loadedChatScope]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation, generating, pendingUserMessage]);

  useEffect(() => {
    let disposed = false;
    void window.electronAPI
      ?.getAIProviderSettings()
      .then((settings) => {
        if (disposed) return;
        setProviderSettings(settings);
        setProviderDraft({
          endpoint: settings.endpoint,
          model: settings.model,
          timeoutSeconds: settings.timeoutMs / 1_000,
          structuredOutput: settings.structuredOutput,
          thinkingMode: settings.thinkingMode,
          reasoningEffort: settings.reasoningEffort,
        });
        setShowProviderSettings(!settings.model);
      })
      .catch((error) => {
        if (!disposed) setProviderError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      disposed = true;
      if (requestIdRef.current) window.electronAPI?.cancelAICommand(requestIdRef.current);
    };
  }, []);

  const dryRunText = (text: string) => {
    setLocalError(undefined);
    let command: unknown;
    try {
      command = JSON.parse(text) as unknown;
    } catch (error) {
      setLocalError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      setShowTechnicalDetails(true);
      return;
    }
    if (command === undefined) return;
    const normalizedCommand = normalizeAIBlueprintCommand(command);
    const wasNormalized = JSON.stringify(normalizedCommand) !== JSON.stringify(command);
    const normalizedText = wasNormalized ? JSON.stringify(normalizedCommand, null, 2) : text;
    if (wasNormalized) setCommandText(normalizedText);
    const next = executeBlueprintCommands(normalizedCommand, { dryRun: true, stage: true });
    setResult(next);
    setPreviewBase(semanticSnapshot);
    setDryRunToken(next.ok ? `${semanticSnapshot.revision}\n${normalizedText}` : undefined);
    setShowDiffDetails(false);
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
      const settings = await window.electronAPI.updateAIProviderSettings({
        endpoint: providerDraft.endpoint,
        model: providerDraft.model,
        timeoutMs: Math.round(providerDraft.timeoutSeconds * 1_000),
        structuredOutput: providerDraft.structuredOutput,
        thinkingMode: providerDraft.thinkingMode,
        reasoningEffort: providerDraft.reasoningEffort,
        ...(apiKey === undefined ? {} : { apiKey }),
      });
      setProviderSettings(settings);
      setProviderDraft({
        endpoint: settings.endpoint,
        model: settings.model,
        timeoutSeconds: settings.timeoutMs / 1_000,
        structuredOutput: settings.structuredOutput,
        thinkingMode: settings.thinkingMode,
        reasoningEffort: settings.reasoningEffort,
      });
      setApiKeyDraft('');
      setProviderStatus(apiKey === '' ? 'API Key removed' : 'Provider settings saved');
      if (settings.model) setShowProviderSettings(false);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const generate = async (retry = false) => {
    if (!window.electronAPI) {
      setProviderError('AI generation is available only in the desktop editor');
      return;
    }
    const requestInstruction = retry ? lastUserRequest : instruction.trim();
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
    setProviderError(undefined);
    setProviderStatus(retry ? 'Retrying with validation diagnostics…' : 'Working…');
    if (!retry) setLastUserRequest(requestInstruction);
    try {
      const response = await window.electronAPI.generateAICommand({
        requestId,
        instruction: retry
          ? `Correct the rejected command for this request: ${requestInstruction}`
          : requestInstruction,
        context: retry && retryContext ? retryContext : contextText,
        schema: AI_ASSISTANT_RESPONSE_SCHEMA,
        history: conversationHistory,
        attachments,
      });
      const assistant = parseAIAssistantResponse(response.content);
      const userMessage = retry
        ? 'Please correct the proposed change using the validation diagnostics.'
        : requestInstruction;
      setConversation((messages) => {
        const next: AIConversationMessage[] = [
          ...messages,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistant.reply },
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
      setInstruction('');
      setAttachments([]);
      if (assistant.command) {
        const command = JSON.stringify(normalizeAIBlueprintCommand(assistant.command), null, 2);
        setCommandText(command);
        setProviderStatus(`Proposed${response.model ? ` by ${response.model}` : ''} · reviewing`);
        dryRunText(command);
      } else {
        discardAIProposal();
        setResult(undefined);
        setPreviewBase(undefined);
        setDryRunToken(undefined);
        setProviderStatus(`Answered${response.model ? ` by ${response.model}` : ''}`);
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
        return [...current, ...selected.filter((attachment) => !ids.has(attachment.id))].slice(0, 8);
      });
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearProposal = () => {
    discardAIProposal();
    setResult(undefined);
    setPreviewBase(undefined);
    setDryRunToken(undefined);
    setModelReasoning(undefined);
    setProviderStatus(undefined);
    setLocalError(undefined);
  };

  const activateChatSession = (session: AIChatSession) => {
    skipNextChatSaveRef.current = true;
    setActiveChatSessionId(session.id);
    chatCreatedAtRef.current = session.createdAt;
    setConversation([...session.messages]);
    setConversationHistory([...session.history]);
    setLastUserRequest(
      [...session.messages].reverse().find((message) => message.role === 'user')?.content ?? '',
    );
    setInstruction('');
    clearProposal();
  };

  const startNewChat = () => {
    setActiveChatSessionId(crypto.randomUUID());
    chatCreatedAtRef.current = new Date().toISOString();
    setConversation([]);
    setConversationHistory([]);
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
      <section className={styles.requestPane}>
        <div className={styles.requestHeader}>
          <div className={styles.assistantTitle}>
            <strong>Story Assistant</strong>
            <span>
              {semanticSnapshot.story.displayName} · {semanticSnapshot.revision}
            </span>
          </div>
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
              <span>OpenAI-compatible endpoint</span>
              <input
                value={providerDraft.endpoint}
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
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    timeoutSeconds: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Structured output</span>
              <select
                value={providerDraft.structuredOutput}
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    structuredOutput: event.target.value as AIStructuredOutputMode,
                  })
                }
              >
                <option value="json-schema">JSON Schema</option>
                <option value="json-object">JSON Object (compatible)</option>
              </select>
            </label>
            <label>
              <span>Thinking</span>
              <select
                value={providerDraft.thinkingMode}
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
            <label className={styles.apiKeyField}>
              <span>
                API Key {providerSettings?.hasApiKey ? '· securely saved' : '· optional locally'}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder={providerSettings?.hasApiKey ? 'Leave blank to keep saved key' : 'sk-…'}
              />
            </label>
            <div className={styles.providerActions}>
              <button
                type="button"
                onClick={() => void saveProviderSettings(apiKeyDraft || undefined)}
              >
                Save Settings
              </button>
              {providerSettings?.hasApiKey && (
                <button type="button" onClick={() => void saveProviderSettings('')}>
                  Remove Key
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
                <span>{message.content}</span>
              </div>
            ))
          )}
          {pendingUserMessage && (
            <div className={styles.chatMessage} data-role="user">
              <strong>You</strong>
              <span>{pendingUserMessage}</span>
            </div>
          )}
          {generating && (
            <div className={styles.activityMessage}>
              <span className={styles.activitySpinner} aria-hidden="true" />
              <div>
                <strong>Working on your request</strong>
                <span>
                  Reading the latest{' '}
                  {contextScope === 'story'
                    ? 'Story'
                    : contextScope === 'graph'
                      ? 'Graph'
                      : 'selection'}{' '}
                  and checking the Blueprint contract…
                </span>
              </div>
            </div>
          )}
        </div>
        <div className={styles.composer}>
          <textarea
            className={styles.instruction}
            value={instruction}
            disabled={generating}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !generating
              ) {
                event.preventDefault();
                void generate();
              }
            }}
            placeholder="Ask about the story, discuss an idea, or request a change…"
          />
          {attachments.length > 0 && (
            <div className={styles.attachments} aria-label="Attached AI reference files">
              {attachments.map((attachment) => (
                <span key={attachment.id} title={`${attachment.name} · ${attachment.content.length.toLocaleString()} characters`}>
                  {attachment.name}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    disabled={generating}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
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
              disabled={generating || !providerSettings?.model || !instruction.trim()}
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
                (!providerSettings?.model ? 'Configure a provider and model to generate' : '')}
            </span>
          </div>
        </div>
      </section>

      {modelReasoning && (
        <details className={styles.reasoningPane}>
          <summary>
            <span>Model reasoning · {modelReasoning.length.toLocaleString()} characters</span>
            <CopyButton text={modelReasoning} label="Copy Reasoning" />
          </summary>
          <p>Provider-supplied reasoning for reference; Dry Run remains the source of truth.</p>
          <pre>{modelReasoning}</pre>
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
          {errors && <pre className={styles.errors}>{errors}</pre>}
        </section>
      )}
    </div>
  );
}
