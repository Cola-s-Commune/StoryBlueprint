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
import type { AIProviderSettings, AIStructuredOutputMode } from '../../../shared/electronApi';
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
    'Edit this Story Blueprint using only a Blueprint Command transaction.',
    'Return one JSON object and no Markdown fences or explanation.',
    `The response MUST validate against the ${BLUEPRINT_COMMAND_FORMAT}@${BLUEPRINT_COMMAND_VERSION} JSON Schema below.`,
    'The top-level array is named operations, never commands.',
    'A graph is an object such as { "kind": "root" }, never the string "root".',
    'Never emit ports, positions, definitionVersion, UI state, or fields not allowed by the schema.',
    'Use the Node Catalog for add-node data and port IDs; ports are always derived by the editor.',
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
  const { hasActiveStory, semanticSnapshot, executeBlueprintCommands, activeGraphId, nodes } =
    useStoryGraphStore();
  const [commandText, setCommandText] = useState(() => commandTemplate(semanticSnapshot.revision));
  const [result, setResult] = useState<BlueprintTransactionResult>();
  const [previewBase, setPreviewBase] = useState<StorySemanticSnapshot>();
  const [dryRunToken, setDryRunToken] = useState<string>();
  const [clipboardError, setClipboardError] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [contextScope, setContextScope] = useState<AIContextScope>('graph');
  const [providerSettings, setProviderSettings] = useState<AIProviderSettings>();
  const [providerDraft, setProviderDraft] = useState<AIProviderDraft>();
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [providerError, setProviderError] = useState<string>();
  const [providerStatus, setProviderStatus] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const requestIdRef = useRef<string>();
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
  const currentToken = `${semanticSnapshot.revision}\n${commandText}`;
  const isDryRunCurrent = dryRunToken === currentToken;
  const diff = result?.ok && previewBase ? semanticDiff(previewBase, result.snapshot) : undefined;
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

  const parseCommand = (): unknown => {
    setLocalError(undefined);
    try {
      return JSON.parse(commandText) as unknown;
    } catch (error) {
      setLocalError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const dryRunText = (text: string) => {
    setLocalError(undefined);
    let command: unknown;
    try {
      command = JSON.parse(text) as unknown;
    } catch (error) {
      setLocalError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (command === undefined) return;
    const next = executeBlueprintCommands(command, { dryRun: true });
    setResult(next);
    setPreviewBase(semanticSnapshot);
    setDryRunToken(next.ok ? `${semanticSnapshot.revision}\n${text}` : undefined);
  };

  const dryRun = () => dryRunText(commandText);

  const apply = () => {
    if (dryRunToken !== currentToken) return;
    const command = parseCommand();
    if (command === undefined) return;
    const next = executeBlueprintCommands(command);
    setResult(next);
    setDryRunToken(undefined);
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
        ...(apiKey === undefined ? {} : { apiKey }),
      });
      setProviderSettings(settings);
      setProviderDraft({
        endpoint: settings.endpoint,
        model: settings.model,
        timeoutSeconds: settings.timeoutMs / 1_000,
        structuredOutput: settings.structuredOutput,
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
    if (!instruction.trim()) {
      setProviderError('Describe the Story change you want');
      return;
    }
    if (contextScope === 'selection' && selectedNodeIds.length === 0) {
      setProviderError('Select one or more nodes, or choose Current Graph / Whole Story');
      return;
    }
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setGenerating(true);
    setProviderError(undefined);
    setProviderStatus(retry ? 'Retrying with validation diagnostics…' : 'Generating command…');
    try {
      const response = await window.electronAPI.generateAICommand({
        requestId,
        instruction: retry
          ? `Correct the rejected command for this request: ${instruction.trim()}`
          : instruction.trim(),
        context: retry && retryContext ? retryContext : contextText,
        schema: BLUEPRINT_COMMAND_JSON_SCHEMA,
      });
      setCommandText(response.content);
      setProviderStatus(`Generated${response.model ? ` with ${response.model}` : ''} · reviewing`);
      dryRunText(response.content);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
      setProviderStatus(undefined);
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = undefined;
      setGenerating(false);
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
          <strong>Ask AI to edit the Blueprint</strong>
          <button type="button" onClick={() => setShowProviderSettings((visible) => !visible)}>
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
        <textarea
          className={styles.instruction}
          value={instruction}
          disabled={generating}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe the change, for example: Add two lines after the selected Choice, spoken by Alice, then reconnect to the existing ending."
        />
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
          <button
            type="button"
            className={styles.primaryButton}
            disabled={generating || !providerSettings?.model}
            onClick={() => void generate()}
          >
            {generating ? 'Generating…' : 'Generate & Dry Run'}
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
              Retry with Diagnostics
            </button>
          )}
          <span className={styles.providerStatus}>
            {providerStatus ??
              (!providerSettings?.model ? 'Configure a provider and model to generate' : '')}
          </span>
        </div>
      </section>

      <header className={styles.toolbar}>
        <CopyButton text={contextText} label="Copy AI Context" />
        <CopyButton text={schemaText} label="Copy Schema" />
        <CopyButton text={snapshotText} label="Copy Snapshot" />
        <button
          type="button"
          onClick={() => {
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
        <span className={styles.revision}>{semanticSnapshot.revision}</span>
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
              setCommandText(event.target.value);
              setResult(undefined);
              setPreviewBase(undefined);
              setDryRunToken(undefined);
              setLocalError(undefined);
            }}
          />
        </label>
      </div>

      <section className={styles.resultPane}>
        <div className={styles.actionRow}>
          <button type="button" className={styles.primaryButton} onClick={dryRun}>
            Dry Run
          </button>
          <button
            type="button"
            className={styles.applyButton}
            disabled={!isDryRunCurrent}
            onClick={apply}
          >
            Apply
          </button>
          <span
            className={styles.resultStatus}
            data-status={result?.ok ? 'ok' : result ? 'error' : 'idle'}
          >
            {result?.ok
              ? result.committed
                ? 'Applied · Undo available'
                : isDryRunCurrent
                  ? 'Dry Run passed'
                  : 'Story changed · run Dry Run again'
              : result
                ? 'Rejected · no changes applied'
                : 'Dry Run is required before Apply'}
          </span>
          {errors && <CopyButton text={errors} label="Copy Result" />}
          {errors && <CopyButton text={retryContext} label="Copy Retry Context" />}
        </div>

        {diff && (
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
              ] as const
            ).map(([label, items, tone]) => (
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
        {errors && <pre className={styles.errors}>{errors}</pre>}
      </section>
    </div>
  );
}
