import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStorySource,
  executeBlueprintCommandTransaction,
  validateBlueprintCommandTransaction,
  compileCompactActionsToTransaction,
  extractCompactActionsFromMarkdown,
  createStorySemanticSnapshot,
  type BlueprintCommandTransaction,
} from '@story-blueprint/common';
import { relativeVariableOverwriteOperations } from './variableValidation';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyDryRunTool: ToolDefinition = {
  name: 'story_dry_run_command',
  description:
    'Dry-runs and validates a Blueprint Command transaction in sandbox without modifying the story file. Returns validation status, diagnostics, and visual diff preview.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'File path to the .story file',
      },
      command: {
        description:
          'Blueprint Command transaction object or JSON string, or compact actions markdown block',
      },
      intent: {
        type: 'string',
        description:
          'Optional description of what the change intends to do, used to check for relative overwrite violations',
      },
    },
    required: ['storyPath', 'command'],
  },
};

export interface DryRunArgs {
  storyPath: string;
  command: unknown;
  intent?: string;
}

export function handleStoryDryRun(args: DryRunArgs): {
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
        // Try compact actions parsing
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

    // Check shape diagnostics
    const shapeDiagnostics = validateBlueprintCommandTransaction(transaction);
    if (shapeDiagnostics.length > 0) {
      return {
        success: false,
        content:
          `Command validation failed:\n` +
          shapeDiagnostics.map((d) => `- [${d.code}] ${d.message} (path: ${d.path})`).join('\n'),
      };
    }

    // Check relative variable overwrites if intent is given
    const relativeOverwrites = relativeVariableOverwriteOperations(transaction, args.intent || '');
    if (relativeOverwrites.length > 0) {
      return {
        success: false,
        content: `Error: RELATIVE_VARIABLE_OVERWRITE detected.\n${relativeOverwrites.join(', ')} sets an absolute value even though the intent describes a relative change. Use add-variable-adjustment or increment/decrement expressions instead.`,
      };
    }

    // Execute dry run
    const result = executeBlueprintCommandTransaction(source, transaction, { dryRun: true });
    if (!result.ok) {
      const diagMessages = result.diagnostics.map((d) => `- [${d.code}] ${d.message}`).join('\n');
      return {
        success: false,
        content: `Dry run execution failed with diagnostics:\n${diagMessages}`,
      };
    }

    const tx = transaction as BlueprintCommandTransaction;
    const lines: string[] = [
      `# Dry Run Succeeded!`,
      `- **Status**: Valid & Compatible`,
      `- **Operations Tested**: ${tx.operations?.length ?? 0}`,
      `- **Base Revision**: \`${tx.baseRevision}\``,
      `- **Current Revision**: \`${snapshot.revision}\``,
    ];

    lines.push('\n## Summary of Operations:');
    for (const op of tx.operations || []) {
      lines.push(`- \`${op.kind}\` (ID: \`${op.operationId}\`)`);
    }

    return {
      success: true,
      content: lines.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Dry run error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
