import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStorySource,
  createStorySemanticSnapshot,
  StoryNodeType,
  type DialogueNodeData,
  type NarrationNodeData,
  type ChoiceNodeData,
} from '@story-blueprint/common';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyExportInkTool: ToolDefinition = {
  name: 'story_export_ink',
  description:
    'Exports dialogue nodes, narrator text, and choice branches from a .story file into human- and LLM-friendly Ink dialogue script format.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'File path to the .story file',
      },
      chapterId: {
        type: 'string',
        description: 'Optional chapter ID to export (exports all graphs if omitted)',
      },
    },
    required: ['storyPath'],
  },
};

export interface ExportInkArgs {
  storyPath: string;
  chapterId?: string;
}

export function handleStoryExportInk(args: ExportInkArgs): {
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

    const graphs = args.chapterId
      ? snapshot.graphs.filter((g) => g.chapterId === args.chapterId)
      : snapshot.graphs;

    if (graphs.length === 0) {
      return {
        success: false,
        content: `No graphs found matching chapterId "${args.chapterId}".`,
      };
    }

    const lines: string[] = [];
    lines.push(`// ==========================================`);
    lines.push(`// Story: ${snapshot.story.displayName || snapshot.story.id}`);
    lines.push(`// Revision: ${snapshot.revision}`);
    lines.push(`// Exported as Ink Narrative Script`);
    lines.push(`// ==========================================\n`);

    // Global variables
    if (snapshot.variables.length > 0) {
      lines.push(`// ---- Variables ----`);
      for (const v of snapshot.variables) {
        lines.push(`VAR ${v.name || v.id} = ${JSON.stringify(v.defaultValue)}`);
      }
      lines.push('');
    }

    // Graphs
    for (const graph of graphs) {
      const graphTitle = graph.displayName || graph.name || graph.chapterId || graph.kind;
      lines.push(`// ==========================================`);
      lines.push(`// Graph: ${graphTitle}`);
      lines.push(`// ==========================================\n`);

      const connectionsByFrom = new Map<string, Array<{ fromPort: string; toNode: string; toPort: string }>>();
      for (const conn of graph.connections) {
        const list = connectionsByFrom.get(conn.from.nodeId) ?? [];
        list.push({ fromPort: conn.from.portId, toNode: conn.to.nodeId, toPort: conn.to.portId });
        connectionsByFrom.set(conn.from.nodeId, list);
      }

      for (const node of graph.nodes) {
        lines.push(`=== ${node.id} ===`);
        if (node.name) lines.push(`// Name: ${node.name}`);

        if (node.type === StoryNodeType.Dialogue) {
          const data = node.data as DialogueNodeData;
          if (data.lines && data.lines.length > 0) {
            for (const dl of data.lines) {
              const speakerTag = dl.speakerId ? ` #speaker: ${dl.speakerId}` : '';
              lines.push(`${dl.text?.source || ''}${speakerTag}`);
            }
          }
        } else if (node.type === StoryNodeType.Narration) {
          const data = node.data as NarrationNodeData;
          if (data.text?.source) {
            lines.push(data.text.source);
          }
        }

        // Check choice options
        if (node.type === StoryNodeType.Choice) {
          const data = node.data as ChoiceNodeData;
          const outgoing = connectionsByFrom.get(node.id) ?? [];
          if (data.options && data.options.length > 0) {
            for (const opt of data.options) {
              const targetConn = outgoing.find((c) => c.fromPort === opt.id || c.fromPort === `option_${opt.id}`);
              const divert = targetConn ? ` -> ${targetConn.toNode}` : '';
              lines.push(`* [${opt.text?.source || ''}]${divert}`);
            }
          }
        } else {
          // Normal linear outgoing connection
          const outgoing = connectionsByFrom.get(node.id) ?? [];
          const flowOut = outgoing.find((c) => c.fromPort === 'flow_out' || c.fromPort === 'out');
          if (flowOut) {
            lines.push(`-> ${flowOut.toNode}`);
          } else if (outgoing.length > 0) {
            lines.push(`-> ${outgoing[0]!.toNode}`);
          } else {
            lines.push(`-> END`);
          }
        }
        lines.push('');
      }
    }

    return {
      success: true,
      content: lines.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Export to Ink failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
