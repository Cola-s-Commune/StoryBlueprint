import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStorySource,
  createStorySemanticSnapshot,
  StoryNodeType,
  type StorySemanticSnapshot,
  type DialogueNodeData,
  type ChoiceNodeData,
} from '@story-blueprint/common';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyReadContextTool: ToolDefinition = {
  name: 'story_read_context',
  description:
    'Reads a StoryBlueprint (.story) file and returns its structured semantic snapshot, including chapters/graphs, nodes, dialogue lines, choices, variables, and connections. Can filter by nodeId to focus on a local neighborhood.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'Absolute or relative file path to the .story file',
      },
      chapterId: {
        type: 'string',
        description: 'Optional chapter ID to filter nodes within a specific chapter',
      },
      nodeId: {
        type: 'string',
        description:
          'Optional node ID to focus on. When provided, returns detailed info for this node and its immediate neighbors.',
      },
    },
    required: ['storyPath'],
  },
};

export interface ReadStoryContextArgs {
  storyPath: string;
  chapterId?: string;
  nodeId?: string;
}

export function handleReadStoryContext(args: ReadStoryContextArgs): {
  success: boolean;
  content: string;
} {
  const resolvedPath = path.resolve(process.cwd(), args.storyPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      content: `Error: File not found at path: ${resolvedPath}. To create a new story file, use the "story_create" tool.`,
    };
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
    const source = parseStorySource(rawContent);
    const snapshot = createStorySemanticSnapshot(source);

    if (args.nodeId) {
      return {
        success: true,
        content: formatNodeNeighborhood(snapshot, args.nodeId),
      };
    }

    return {
      success: true,
      content: formatSemanticSnapshotSummary(snapshot, args.chapterId),
    };
  } catch (error) {
    const backupPath = `${resolvedPath}.bak`;
    const hasBackup = fs.existsSync(backupPath);
    const backupHint = hasBackup ? ` A backup file exists at "${backupPath}".` : '';
    return {
      success: false,
      content: `Failed to parse story file: ${error instanceof Error ? error.message : String(error)}.${backupHint} If the .story file has syntax errors or is corrupted, you may ask the user for permission and attempt to inspect and repair it.`,
    };
  }
}

function formatSemanticSnapshotSummary(
  snapshot: StorySemanticSnapshot,
  targetChapterId?: string,
): string {
  const lines: string[] = [];
  lines.push(`# Story Semantic Snapshot: ${snapshot.story.displayName || snapshot.story.id}`);
  lines.push(`- **ID**: \`${snapshot.story.id}\``);
  lines.push(`- **Revision**: \`${snapshot.revision}\``);
  lines.push(`- **Format Version**: ${snapshot.version}`);

  // Characters
  if (snapshot.characters && snapshot.characters.length > 0) {
    lines.push('\n## Characters');
    for (const c of snapshot.characters) {
      const namePart = c.name && c.displayName !== c.name ? ` (${c.name})` : '';
      lines.push(`- \`${c.id}\`: ${c.displayName || c.name}${namePart}`);
    }
  }

  // Variables
  if (snapshot.variables && snapshot.variables.length > 0) {
    lines.push('\n## Variables');
    for (const v of snapshot.variables) {
      const typeStr =
        typeof v.valueType === 'object' && v.valueType && 'kind' in v.valueType
          ? (v.valueType as { kind: string }).kind
          : String(v.valueType);
      lines.push(
        `- \`${v.id}\` (${v.name}): type=\`${typeStr}\`, default=\`${JSON.stringify(v.defaultValue)}\``,
      );
    }
  }

  // Graphs (root and chapters)
  const graphs = targetChapterId
    ? snapshot.graphs.filter((g) => g.chapterId === targetChapterId)
    : snapshot.graphs;

  lines.push(`\n## Graphs (${graphs.length})`);
  for (const graph of graphs) {
    const title = graph.displayName || graph.name || graph.chapterId || graph.kind;
    lines.push(`\n### Graph: ${title} (${graph.kind}${graph.chapterId ? ` · chapterId: \`${graph.chapterId}\`` : ''})`);
    lines.push(`- Nodes: ${graph.nodes.length}, Connections: ${graph.connections.length}`);

    lines.push('\n#### Nodes:');
    for (const node of graph.nodes) {
      const parts: string[] = [`- **[${node.type}]** \`${node.id}\` "${node.name || ''}"`];

      if (node.type === StoryNodeType.Dialogue) {
        const data = node.data as DialogueNodeData;
        if (data.lines && data.lines.length > 0) {
          parts.push(
            `  - Dialogue (${data.lines.length} lines): ` +
              data.lines
                .map((dl) => `${dl.speakerId || 'Narrator'}: "${dl.text?.source?.slice(0, 50) || ''}"`)
                .join(' | '),
          );
        }
      }

      if (node.type === StoryNodeType.Choice) {
        const data = node.data as ChoiceNodeData;
        if (data.options && data.options.length > 0) {
          parts.push(
            `  - Choices: ` +
              data.options.map((c) => `[${c.text?.source || ''}] (id: ${c.id})`).join(', '),
          );
        }
      }

      lines.push(parts.join('\n'));
    }

    if (graph.connections.length > 0) {
      lines.push('\n#### Flow Connections:');
      for (const conn of graph.connections) {
        lines.push(`- \`${conn.from.nodeId}\`:${conn.from.portId} -> \`${conn.to.nodeId}\`:${conn.to.portId}`);
      }
    }
  }

  return lines.join('\n');
}

function formatNodeNeighborhood(snapshot: StorySemanticSnapshot, nodeId: string): string {
  let targetNode = null;
  let targetGraph = null;

  for (const graph of snapshot.graphs) {
    const found = graph.nodes.find((n) => n.id === nodeId);
    if (found) {
      targetNode = found;
      targetGraph = graph;
      break;
    }
  }

  if (!targetNode || !targetGraph) {
    return `Node with ID \`${nodeId}\` not found in any graph of this story.`;
  }

  const incoming = targetGraph.connections.filter((c) => c.to.nodeId === nodeId);
  const outgoing = targetGraph.connections.filter((c) => c.from.nodeId === nodeId);

  const lines: string[] = [];
  lines.push(`# Node Detail: \`${targetNode.id}\``);
  lines.push(`- **Type**: \`${targetNode.type}\``);
  lines.push(`- **Name**: "${targetNode.name || ''}"`);
  lines.push(`- **Graph**: \`${targetGraph.displayName || targetGraph.name}\``);
  lines.push(`- **Revision**: \`${snapshot.revision}\``);

  if (targetNode.type === StoryNodeType.Dialogue) {
    const data = targetNode.data as DialogueNodeData;
    if (data.lines && data.lines.length > 0) {
      lines.push('\n## Dialogue Lines:');
      for (const dl of data.lines) {
        lines.push(`- **${dl.speakerId || 'Narrator'}**: ${dl.text?.source || ''}`);
      }
    }
  }

  if (targetNode.type === StoryNodeType.Choice) {
    const data = targetNode.data as ChoiceNodeData;
    if (data.options && data.options.length > 0) {
      lines.push('\n## Choice Options:');
      for (const choice of data.options) {
        lines.push(`- [${choice.text?.source || ''}] (optionId: \`${choice.id}\`)`);
      }
    }
  }

  lines.push('\n## Incoming Connections:');
  if (incoming.length === 0) lines.push('- (None - entry point or disconnected)');
  else {
    for (const c of incoming) {
      lines.push(`- From \`${c.from.nodeId}\`:${c.from.portId} -> ${c.to.portId}`);
    }
  }

  lines.push('\n## Outgoing Connections:');
  if (outgoing.length === 0) lines.push('- (None - leaf node)');
  else {
    for (const c of outgoing) {
      lines.push(`- Port \`${c.from.portId}\` -> to \`${c.to.nodeId}\`:${c.to.portId}`);
    }
  }

  return lines.join('\n');
}
