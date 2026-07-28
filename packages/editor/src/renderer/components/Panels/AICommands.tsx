import { useEffect, useMemo, useState } from 'react';
import {
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  type BlueprintTransactionResult,
  type StorySemanticSnapshot,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import { CopyButton } from './CopyButton';
import panelStyles from './Panel.module.css';
import styles from './AICommands.module.css';

interface SemanticDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedConnections: string[];
  removedConnections: string[];
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

function semanticDiff(before: StorySemanticSnapshot, after: StorySemanticSnapshot): SemanticDiff {
  const beforeNodes = new Map(
    before.graphs.flatMap((graph) =>
      graph.nodes.map((node) => [`${graphKey(graph)}:${node.id}`, JSON.stringify(node)] as const),
    ),
  );
  const afterNodes = new Map(
    after.graphs.flatMap((graph) =>
      graph.nodes.map((node) => [`${graphKey(graph)}:${node.id}`, JSON.stringify(node)] as const),
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
    addedNodes: [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)),
    removedNodes: [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)),
    changedNodes: [...afterNodes.keys()].filter(
      (id) => beforeNodes.has(id) && beforeNodes.get(id) !== afterNodes.get(id),
    ),
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

function aiContext(snapshot: StorySemanticSnapshot): string {
  return [
    'Edit this Story Blueprint using only a Blueprint Command transaction.',
    'Return one JSON object and no Markdown fences or explanation.',
    `Use format ${BLUEPRINT_COMMAND_FORMAT} version ${BLUEPRINT_COMMAND_VERSION}.`,
    'Every operation requires a unique operationId and graph target.',
    'Supported kinds:',
    '- add-node: { operationId, kind, graph, node: { id, type, name?, data } }',
    '- update-node: { operationId, kind, graph, nodeId, patch: { name?, data? } }',
    '- remove-node: { operationId, kind, graph, nodeId }',
    '- connect/disconnect: { operationId, kind, graph, from: { nodeId, portId }, to: { nodeId, portId } }',
    'Use replaceExisting: true on connect only when replacing an occupied compatible port.',
    'Preserve stable IDs unless explicitly adding or removing an object.',
    `Set baseRevision to ${snapshot.revision}.`,
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
  const { hasActiveStory, semanticSnapshot, executeBlueprintCommands } = useStoryGraphStore();
  const [commandText, setCommandText] = useState(() => commandTemplate(semanticSnapshot.revision));
  const [result, setResult] = useState<BlueprintTransactionResult>();
  const [previewBase, setPreviewBase] = useState<StorySemanticSnapshot>();
  const [dryRunToken, setDryRunToken] = useState<string>();
  const [clipboardError, setClipboardError] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const snapshotText = useMemo(() => JSON.stringify(semanticSnapshot, null, 2), [semanticSnapshot]);
  const contextText = useMemo(() => aiContext(semanticSnapshot), [semanticSnapshot]);
  const currentToken = `${semanticSnapshot.revision}\n${commandText}`;
  const isDryRunCurrent = dryRunToken === currentToken;
  const diff = result?.ok && previewBase ? semanticDiff(previewBase, result.snapshot) : undefined;
  const errors = [clipboardError, localError, diagnosticText(result)].filter(Boolean).join('\n');

  useEffect(() => {
    setDryRunToken(undefined);
  }, [semanticSnapshot.revision]);

  const parseCommand = (): unknown => {
    setLocalError(undefined);
    try {
      const command: unknown = JSON.parse(commandText);
      if (
        typeof command !== 'object' ||
        command === null ||
        !('baseRevision' in command) ||
        command.baseRevision !== semanticSnapshot.revision
      ) {
        setLocalError(
          `Command baseRevision must match the current revision ${semanticSnapshot.revision}`,
        );
        return undefined;
      }
      return command;
    } catch (error) {
      setLocalError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const dryRun = () => {
    const command = parseCommand();
    if (command === undefined) return;
    const next = executeBlueprintCommands(command, { dryRun: true });
    setResult(next);
    setPreviewBase(semanticSnapshot);
    setDryRunToken(next.ok ? currentToken : undefined);
  };

  const apply = () => {
    if (dryRunToken !== currentToken) return;
    const command = parseCommand();
    if (command === undefined) return;
    const next = executeBlueprintCommands(command);
    setResult(next);
    setDryRunToken(undefined);
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
      <header className={styles.toolbar}>
        <CopyButton text={contextText} label="Copy AI Context" />
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
        </div>

        {diff && (
          <div className={styles.diffGrid}>
            {(
              [
                ['Added nodes', diff.addedNodes],
                ['Changed nodes', diff.changedNodes],
                ['Removed nodes', diff.removedNodes],
                ['Added connections', diff.addedConnections],
                ['Removed connections', diff.removedConnections],
              ] as const
            ).map(([label, items]) => (
              <div className={styles.diffGroup} key={label}>
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
