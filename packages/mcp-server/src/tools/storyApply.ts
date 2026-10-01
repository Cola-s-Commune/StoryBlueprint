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
  type StoryBlueprintWorkspaceSettings,
  type PendingAIProposal,
  WORKSPACE_SETTINGS_RELATIVE_PATH,
  PENDING_PROPOSAL_RELATIVE_PATH,
} from '@story-blueprint/common';
import { relativeVariableOverwriteOperations } from './variableValidation';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyApplyTool: ToolDefinition = {
  name: 'story_apply_command',
  description:
    'Atomically applies a validated Blueprint Command transaction to a .story file. If the editor setting "allowAiAutoApply" is off (the default), changes are staged as a pending proposal in the editor for the human author to review and click [Apply]. When "allowAiAutoApply" is enabled, changes are directly committed to disk.',
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
      userConfirmed: {
        type: 'boolean',
        description:
          'Mandatory human review confirmation flag. Must be set to true. Confirms that you have presented the planned outline, dialogue lines, choices, and graph structure to the human author in a previous turn and received their explicit approval to apply.',
      },
      autoApply: {
        type: 'boolean',
        description:
          'Request direct apply to disk without staging in editor (only takes effect if permitted by workspace setting "allowAiAutoApply").',
      },
    },
    required: ['storyPath', 'command', 'userConfirmed'],
  },
};

export interface ApplyCommandArgs {
  storyPath: string;
  command: unknown;
  intent?: string;
  createBackup?: boolean;
  userConfirmed?: boolean;
  autoApply?: boolean;
}

export function findWorkspaceRoot(storyFilePath: string): string {
  let current = path.dirname(path.resolve(process.cwd(), storyFilePath));
  for (let depth = 0; depth < 5; depth++) {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      const hasProject = entries.some(
        (e) => e.isFile() && (e.name.endsWith('.storyproject') || e.name === 'story.project.kdl'),
      );
      const hasConfig = entries.some((e) => e.isDirectory() && e.name === '.storyblueprint');
      if (hasProject || hasConfig) {
        return current;
      }
    } catch {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.dirname(path.resolve(process.cwd(), storyFilePath));
}

export function readWorkspaceSettings(workspaceRoot: string): StoryBlueprintWorkspaceSettings {
  try {
    const settingsPath = path.join(workspaceRoot, WORKSPACE_SETTINGS_RELATIVE_PATH);
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(raw) as StoryBlueprintWorkspaceSettings;
    }
  } catch {
    // fallback
  }
  return { allowAiAutoApply: false };
}

export function handleStoryApply(args: ApplyCommandArgs): {
  success: boolean;
  content: string;
} {
  if (args.userConfirmed !== true) {
    return {
      success: false,
      content:
        `🛑 Review Gatekeeper Blocked: "userConfirmed" is missing or false.\n\n` +
        `StoryBlueprint protocol strictly requires human author approval before modifying files on disk.\n` +
        `1. You must first present your planned narrative design, detailed dialogue lines, choices, and graph links to the user in your response text.\n` +
        `2. Ask the user for confirmation and STOP calling tools.\n` +
        `3. Only after the user confirms in their next reply, call story_apply_command with { userConfirmed: true }.`,
    };
  }

  const resolvedPath = path.resolve(process.cwd(), args.storyPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      content: `Error: Story file not found at path: ${resolvedPath}. To create a new story file, use the "story_create" tool.`,
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

    const workspaceRoot = findWorkspaceRoot(resolvedPath);
    const workspaceSettings = readWorkspaceSettings(workspaceRoot);
    const canAutoApply = workspaceSettings.allowAiAutoApply === true;
    const tx = transaction as BlueprintCommandTransaction;

    // When auto-apply is disabled in editor settings (default), stage proposal for human author review
    if (!canAutoApply) {
      const proposalId = `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const pendingProposal: PendingAIProposal = {
        id: proposalId,
        storyPath: args.storyPath,
        targetFilePath: resolvedPath,
        command: transaction,
        intent: args.intent,
        createdAt: new Date().toISOString(),
      };

      const pendingDir = path.join(workspaceRoot, '.storyblueprint');
      if (!fs.existsSync(pendingDir)) {
        fs.mkdirSync(pendingDir, { recursive: true });
      }
      const pendingPath = path.join(workspaceRoot, PENDING_PROPOSAL_RELATIVE_PATH);
      fs.writeFileSync(pendingPath, JSON.stringify(pendingProposal, null, 2), 'utf-8');

      return {
        success: true,
        content: [
          `# 📋 Staged for Author Review in Editor!`,
          `- **File**: \`${resolvedPath}\``,
          `- **Revision**: \`${snapshot.revision}\``,
          `- **Operations Staged**: ${tx.operations?.length ?? 0}`,
          `- **Editor Mode**: Manual Review (Editor switch "允许 AI 自己 apply" is off)`,
          ``,
          `> **Action Required**: The changes have been validated and staged as a pending proposal in the Story Blueprint editor.`,
          `> The human author will see the changes highlighted on canvas and can click **[Apply]** in the editor toolbar to commit them, or **[Discard]** to reject.`,
          ``,
          `*(Tip: To enable direct file writes without manual Apply button confirmation in the editor, turn on "允许 AI 自己 apply" in Editor Preferences).*`,
        ].join('\n'),
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

    // Clean up any pending proposal file if it matches this story
    try {
      const pendingPath = path.join(workspaceRoot, PENDING_PROPOSAL_RELATIVE_PATH);
      if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
      }
    } catch {
      // ignore
    }

    // Re-parse from persisted KDL to guarantee identical revision with subsequent read operations
    const persistedSource = parseStorySource(newKdl);
    const updatedSnapshot = createStorySemanticSnapshot(persistedSource);

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
    const backupPath = `${resolvedPath}.bak`;
    const hasBackup = fs.existsSync(backupPath);
    const backupHint = hasBackup ? ` A backup file exists at "${backupPath}".` : '';
    return {
      success: false,
      content: `Failed to apply command: ${error instanceof Error ? error.message : String(error)}.${backupHint} If the .story file has syntax errors or is corrupted, you may ask the user for permission and attempt to inspect and repair it.`,
    };
  }
}
