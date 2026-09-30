import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStorySource, parseStoryProject } from '@story-blueprint/common';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyInspectProjectTool: ToolDefinition = {
  name: 'story_inspect_project',
  description:
    'Discovers and inspects a StoryBlueprint workspace or project folder. Finds story.project.kdl, scans all .story files, and summarizes characters, global variables, and narrative assets.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Directory path to the StoryBlueprint project root or workspace',
      },
    },
    required: ['projectPath'],
  },
};

export interface InspectProjectArgs {
  projectPath: string;
}

export function handleInspectProject(args: InspectProjectArgs): {
  success: boolean;
  content: string;
} {
  const resolvedDir = path.resolve(process.cwd(), args.projectPath);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    return {
      success: false,
      content: `Error: Directory not found at path: ${resolvedDir}`,
    };
  }

  try {
    const lines: string[] = [`# StoryBlueprint Project Overview`];
    lines.push(`- **Location**: \`${resolvedDir}\``);

    // Look for story.project.kdl
    const projectFilePath = path.join(resolvedDir, 'story.project.kdl');
    if (fs.existsSync(projectFilePath)) {
      try {
        const rawProject = fs.readFileSync(projectFilePath, 'utf-8');
        const project = parseStoryProject(rawProject);
        lines.push(`- **Project Title**: ${project.displayName || project.name || project.id}`);
        lines.push(`- **Project ID**: \`${project.id}\``);
        lines.push(`- **Format Version**: ${project.version}`);
        lines.push(`- **Configured Stories**: ${project.stories.length}`);
        lines.push(`- **Configured Characters**: ${project.characters.length}`);
      } catch (e) {
        lines.push(
          `- **Project File**: \`story.project.kdl\` (error reading: ${e instanceof Error ? e.message : String(e)})`,
        );
      }
    } else {
      lines.push(`- **Project File**: None (standalone story directory)`);
    }

    // Scan for .story files recursively (up to 3 levels)
    const storyFiles: string[] = [];
    function scanDir(dir: string, depth = 0) {
      if (depth > 3) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.story')) {
          storyFiles.push(full);
        }
      }
    }
    scanDir(resolvedDir);

    lines.push(`\n## Story Files Found (${storyFiles.length}):`);
    if (storyFiles.length === 0) {
      lines.push('- No `.story` files found in this directory.');
    } else {
      for (const sf of storyFiles) {
        const rel = path.relative(resolvedDir, sf);
        try {
          const raw = fs.readFileSync(sf, 'utf-8');
          const source = parseStorySource(raw);
          const nodeCount =
            (source.root?.nodes ? source.root.nodes.length : 0) +
            source.chapters.reduce(
              (acc, ch) => acc + (ch.graph?.nodes ? ch.graph.nodes.length : 0),
              0,
            );
          lines.push(
            `- **\`${rel}\`**: Story ID=\`${source.id}\`, Name="${source.displayName || source.name}", Nodes=${nodeCount}, Chapters=${source.chapters.length}`,
          );
        } catch {
          lines.push(`- **\`${rel}\`**: (unparsed or invalid format)`);
        }
      }
    }

    return {
      success: true,
      content: lines.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Project inspection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
