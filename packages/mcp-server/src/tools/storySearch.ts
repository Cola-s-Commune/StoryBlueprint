import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStorySource,
  createStorySemanticSnapshot,
  StoryNodeType,
  type DialogueNodeData,
  type ChoiceNodeData,
} from '@story-blueprint/common';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storySearchTool: ToolDefinition = {
  name: 'story_search',
  description:
    'Searches across all dialogue lines, choices, speakers, variables, and node titles in a .story file. Returns matching nodes and contextual text.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'File path to the .story file',
      },
      query: {
        type: 'string',
        description: 'Keyword or phrase to search for (case-insensitive)',
      },
      filter: {
        type: 'string',
        enum: ['all', 'dialogue', 'speaker', 'variable', 'choice'],
        description: 'Optional filter by content type (default: all)',
      },
    },
    required: ['storyPath', 'query'],
  },
};

export interface SearchStoryArgs {
  storyPath: string;
  query: string;
  filter?: 'all' | 'dialogue' | 'speaker' | 'variable' | 'choice';
}

export function handleStorySearch(args: SearchStoryArgs): {
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
    const q = args.query.toLowerCase();
    const filter = args.filter || 'all';

    const matches: string[] = [];

    // Search variables
    if (filter === 'all' || filter === 'variable') {
      for (const v of snapshot.variables) {
        if (v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q)) {
          matches.push(`- **[Variable]** \`${v.id}\` ("${v.name}"), type=\`${v.valueType}\`, default=\`${JSON.stringify(v.defaultValue)}\``);
        }
      }
    }

    // Search nodes in graphs
    for (const graph of snapshot.graphs) {
      const graphName = graph.displayName || graph.name || graph.chapterId || graph.kind;
      for (const node of graph.nodes) {
        // Node title / name
        if (filter === 'all' && (node.name?.toLowerCase().includes(q) || node.id.toLowerCase().includes(q))) {
          matches.push(`- **[Node Name]** \`${node.id}\` (${node.type}) in graph \`${graphName}\`: "${node.name || ''}"`);
        }

        // Dialogue lines
        if ((filter === 'all' || filter === 'dialogue' || filter === 'speaker') && node.type === StoryNodeType.Dialogue) {
          const data = node.data as DialogueNodeData;
          if (data.lines) {
            for (const dl of data.lines) {
              const speakerMatch = dl.speakerId?.toLowerCase().includes(q);
              const textMatch = dl.text?.source?.toLowerCase().includes(q);
              if (
                (filter === 'speaker' && speakerMatch) ||
                (filter === 'dialogue' && textMatch) ||
                (filter === 'all' && (speakerMatch || textMatch))
              ) {
                matches.push(
                  `- **[Dialogue in Node \`${node.id}\`]** ${dl.speakerId || 'Narrator'}: "${dl.text?.source || ''}" (graph: \`${graphName}\`)`,
                );
              }
            }
          }
        }

        // Choices
        if ((filter === 'all' || filter === 'choice') && node.type === StoryNodeType.Choice) {
          const data = node.data as ChoiceNodeData;
          if (data.options) {
            for (const c of data.options) {
              if (c.text?.source?.toLowerCase().includes(q)) {
                matches.push(
                  `- **[Choice in Node \`${node.id}\`]** [${c.text?.source || ''}] (id: \`${c.id}\`, graph: \`${graphName}\`)`,
                );
              }
            }
          }
        }
      }
    }

    if (matches.length === 0) {
      return {
        success: true,
        content: `No matches found for query "${args.query}" (filter: ${filter}).`,
      };
    }

    return {
      success: true,
      content: `# Search Results for "${args.query}" (${matches.length} matches):\n\n` + matches.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Search error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
