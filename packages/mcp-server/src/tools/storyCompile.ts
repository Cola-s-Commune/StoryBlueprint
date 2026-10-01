import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStorySource, nodeRegistry } from '@story-blueprint/common';
import { compileStory } from '@story-blueprint/compiler';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyCompileTool: ToolDefinition = {
  name: 'story_compile',
  description:
    'Compiles a .story file using the StoryBlueprint compiler. Validates narrative flow integrity, type consistency, condition graphs, and builds a runnable runtime program. Returns compiler diagnostics and program statistics.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description: 'File path to the .story file to compile',
      },
    },
    required: ['storyPath'],
  },
};

export interface CompileStoryArgs {
  storyPath: string;
}

export function handleStoryCompile(args: CompileStoryArgs): {
  success: boolean;
  content: string;
} {
  nodeRegistry.registerBuiltins();
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
    const result = compileStory(source);

    const lines: string[] = [];
    if (result.ok) {
      const blockCount = Object.keys(result.program.blocks || {}).length;
      let totalInstructions = 0;
      if (result.program.blocks) {
        for (const block of Object.values(result.program.blocks)) {
          totalInstructions +=
            (block as { instructions?: readonly unknown[] }).instructions?.length ?? 0;
        }
      }
      lines.push(`# Compilation Succeeded!`);
      lines.push(`- **Status**: Valid & Executable`);
      lines.push(`- **Story ID**: \`${source.id}\``);
      lines.push(`- **Compiled Program ID**: \`${result.program.id}\``);
      lines.push(`- **Total Blocks**: ${blockCount}`);
      lines.push(`- **Total Instructions**: ${totalInstructions}`);
      lines.push(`- **Entry Block**: \`${result.program.entryBlockId ?? 'none'}\``);

      if (result.diagnostics.length > 0) {
        lines.push(`\n## Compiler Warnings (${result.diagnostics.length}):`);
        for (const d of result.diagnostics) {
          lines.push(`- [${d.severity.toUpperCase()} ${d.code}] ${d.message} (node: ${d.sourceNodeId ?? 'global'})`);
        }
      }
      return {
        success: true,
        content: lines.join('\n'),
      };
    } else {
      lines.push(`# Compilation Failed!`);
      lines.push(`The story graph contains errors that prevent it from compiling into a runnable program:\n`);
      for (const d of result.diagnostics) {
        lines.push(`- **[${d.severity.toUpperCase()} ${d.code}]**: ${d.message}${d.sourceNodeId ? ` (node: \`${d.sourceNodeId}\`)` : ''}`);
      }
      return {
        success: false,
        content: lines.join('\n'),
      };
    }
  } catch (error) {
    return {
      success: false,
      content: `Compiler error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
