import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStorySource,
  serializeStorySource,
  executeBlueprintCommandTransaction,
  validateBlueprintCommandTransaction,
  compileCompactActionsToTransaction,
  extractCompactActionsFromMarkdown,
  createStorySemanticSnapshot,
  type BlueprintCommandTransaction,
} from '@story-blueprint/common';
import { relativeVariableOverwriteOperations } from './variableValidation';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyApplyTool: ToolDefinition = {
  name: 'story_apply_command',
  description:
    'Atomically applies a validated Blueprint Command transaction to a .story file. Performs sandbox dry-run validation first, creates a backup, and persists the modified story to disk.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'File path to the .story file',
      },
      command: {
        description:
          'Blueprint Command transaction object { version: 1, operations: [...] }. Each operation requires "operationId", "kind" (e.g. "add-node", "update-node", "remove-node", "connect", "disconnect", "add-variable-adjustment", "add-dialogue-line", "add-choice-option", "add-character", "add-variable"), and "graph": { "kind": "root" }. Node types: "dialogue", "narration", "choice", "branch", "story-entry", "end-story". All IDs must follow lowercase prefix rules: n_ for node, o_ for option (MUST be o_ not opt_), v_ for variable, c_ for character. In expressions/conditions (branch/visibleIf), use variable "name" (e.g. gold >= 400), not ID. Connect operation: { from: { nodeId, portId }, to: { nodeId, portId } } where portId is "in"/"out" or option ID. remove-node automatically cascades and removes all connected edges. Compact action markdown lines also supported.',
      },
      intent: {
        type: 'string',
        description:
          'Optional user request or intent description, checked for relative variable overwrite violations',
      },
      createBackup: {
        type: 'boolean',
        description: 'Whether to create a backup file (.bak) before saving (default: true)',
      },
    },
    required: ['storyPath', 'command'],
  },
};

export interface ApplyCommandArgs {
  storyPath: string;
  command: unknown;
  intent?: string;
  createBackup?: boolean;
}

export function handleStoryApply(args: ApplyCommandArgs): {
  success: boolean;
  content: string;
} {
  const resolvedPath = path.resolve(process.cwd(), args.storyPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      content: `Error: File not found at path: ${resolvedPath}`,
    };
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
    const source = parseStorySource(rawContent);
    const snapshot = createStorySemanticSnapshot(source);

    let transaction: unknown = args.command;
    if (typeof transaction === 'string') {
      const trimmed = transaction.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          transaction = JSON.parse(trimmed) as unknown;
        } catch (err) {
          return {
            success: false,
            content: `Invalid JSON in command parameter: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      } else {
        const actions = extractCompactActionsFromMarkdown(trimmed);
        if (actions.length > 0) {
          transaction = compileCompactActionsToTransaction(actions, {
            snapshot,
            activeGraphId: snapshot.graphs[0]?.chapterId ?? 'root',
          });
        } else {
          return {
            success: false,
            content: `Command string is neither valid JSON nor valid compact action lines.`,
          };
        }
      }
    }

    // Normalize transaction shape if agent omitted envelope fields
    if (Array.isArray(transaction)) {
      transaction = {
        format: 'story-blueprint-commands',
        version: 1,
        baseRevision: snapshot.revision,
        operations: transaction,
      };
    } else if (transaction && typeof transaction === 'object') {
      const rec = transaction as Record<string, unknown>;
      if (!rec.format) rec.format = 'story-blueprint-commands';
      if (!rec.version) rec.version = 1;
      if (
        !rec.baseRevision ||
        rec.baseRevision === 'auto' ||
        rec.baseRevision === 'latest' ||
        rec.baseRevision === 'rev_initial'
      ) {
        rec.baseRevision = snapshot.revision;
      }
    }

    // Validate shape
    const shapeDiagnostics = validateBlueprintCommandTransaction(transaction);
    if (shapeDiagnostics.length > 0) {
      return {
        success: false,
        content:
          `Validation failed: Transaction shape is invalid:\n` +
          shapeDiagnostics.map((d) => `- [${d.code}] ${d.message} (path: ${d.path})`).join('\n'),
      };
    }

    // Relative overwrite check
    const relativeOverwrites = relativeVariableOverwriteOperations(transaction, args.intent || '');
    if (relativeOverwrites.length > 0) {
      return {
        success: false,
        content: `Abort: RELATIVE_VARIABLE_OVERWRITE violation detected:\n${relativeOverwrites.join(', ')} sets an absolute value even though the intent describes a relative change. Use add-variable-adjustment instead.`,
      };
    }

    // Execute dry run first
    const dryRunResult = executeBlueprintCommandTransaction(source, transaction, { dryRun: true });
    if (!dryRunResult.ok) {
      return {
        success: false,
        content:
          `Validation failed: Transaction cannot be applied to this story state:\n` +
          dryRunResult.diagnostics.map((d) => `- [${d.code}] ${d.message}`).join('\n'),
      };
    }

    // Execute commit
    const commitResult = executeBlueprintCommandTransaction(source, transaction, { dryRun: false });
    if (!commitResult.ok || !commitResult.document) {
      return {
        success: false,
        content:
          `Commit failed during execution:\n` +
          commitResult.diagnostics.map((d) => `- [${d.code}] ${d.message}`).join('\n'),
      };
    }

    // Optional backup
    if (args.createBackup !== false) {
      const backupPath = `${resolvedPath}.bak`;
      fs.writeFileSync(backupPath, rawContent, 'utf-8');
    }

    // Serialize and write to disk
    const newKdl = serializeStorySource(commitResult.document);
    fs.writeFileSync(resolvedPath, newKdl, 'utf-8');

    const updatedSnapshot = createStorySemanticSnapshot(commitResult.document);
    const tx = transaction as BlueprintCommandTransaction;

    return {
      success: true,
      content: [
        `# Successfully Applied Changes to Story!`,
        `- **File**: \`${resolvedPath}\``,
        `- **Previous Revision**: \`${snapshot.revision}\``,
        `- **New Revision**: \`${updatedSnapshot.revision}\``,
        `- **Operations Committed**: ${tx.operations?.length ?? 0}`,
        `- **Total Nodes in Story**: ${updatedSnapshot.graphs.reduce((sum, g) => sum + g.nodes.length, 0)}`,
        `- **Backup Created**: ${args.createBackup !== false ? `${path.basename(resolvedPath)}.bak` : 'no'}`,
      ].join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Failed to apply command: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
