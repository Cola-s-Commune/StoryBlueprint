import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createStableId,
  isStableId,
  serializeStorySource,
  parseStoryProject,
  serializeStoryProject,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  type StorySourceDocument,
  type StoryProjectDocument,
} from '@story-blueprint/common';
import type { ToolDefinition } from '../protocol/mcpTypes';

export const storyCreateTool: ToolDefinition = {
  name: 'story_create',
  description:
    'Creates a new valid StoryBlueprint (.story) file with an initial Start node and valid graph topology. In multi-story projects, automatically discovers the workspace .storyproject file and registers the new story.',
  inputSchema: {
    type: 'object',
    properties: {
      storyPath: {
        type: 'string',
        description:
          'Path for the new .story file (relative to workspacePath or absolute, e.g. "bus.story" or "stories/bus.story")',
      },
      workspacePath: {
        type: 'string',
        description:
          'Optional path to the project root directory or workspace. Defaults to current working directory or story directory.',
      },
      storyId: {
        type: 'string',
        description:
          'Optional unique story ID starting with "s_" (e.g. "s_bus_heist"). If omitted, a stable ID will be automatically generated.',
      },
      name: {
        type: 'string',
        description:
          'Optional machine name for the story (ASCII snake_case, e.g. "bus_heist"). Defaults to the filename without extension.',
      },
      displayName: {
        type: 'string',
        description:
          'Optional human-readable title for the story (e.g. "Bus Heist"). Defaults to name.',
      },
      registerInProject: {
        type: 'boolean',
        description:
          'Whether to register the new story in .storyproject if found in workspace (defaults to true).',
      },
    },
    required: ['storyPath'],
  },
};

export interface CreateStoryArgs {
  storyPath: string;
  workspacePath?: string;
  storyId?: string;
  name?: string;
  displayName?: string;
  registerInProject?: boolean;
}

function findProjectFile(dir: string): string | null {
  let current = dir;
  for (let depth = 0; depth < 3; depth++) {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      const projectEntry = entries.find(
        (e) => e.isFile() && (e.name.endsWith('.storyproject') || e.name === 'story.project.kdl'),
      );
      if (projectEntry) {
        return path.join(current, projectEntry.name);
      }
    } catch {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function handleStoryCreate(args: CreateStoryArgs): {
  success: boolean;
  content: string;
} {
  const workspaceDir = args.workspacePath
    ? path.resolve(process.cwd(), args.workspacePath)
    : process.cwd();

  let rawStoryPath = args.storyPath.trim();
  if (!rawStoryPath.endsWith('.story')) {
    rawStoryPath += '.story';
  }

  const resolvedStoryPath = path.isAbsolute(rawStoryPath)
    ? path.normalize(rawStoryPath)
    : path.resolve(workspaceDir, rawStoryPath);

  if (fs.existsSync(resolvedStoryPath)) {
    return {
      success: false,
      content: `Error: Story file already exists at path: ${resolvedStoryPath}. If you want to modify it, use story_apply_command.`,
    };
  }

  const baseFileName = path.basename(resolvedStoryPath, '.story');
  const normalizedName =
    args.name?.trim() ||
    baseFileName
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() ||
    'story';

  const normalizedStoryId =
    args.storyId && isStableId(args.storyId, 'story')
      ? args.storyId
      : createStableId('story');

  const normalizedDisplayName = args.displayName?.trim() || args.name?.trim() || baseFileName;

  const initialStory: StorySourceDocument = {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: normalizedStoryId,
    name: normalizedName,
    displayName: normalizedDisplayName,
    root: {
      nodes: [
        {
          id: 'n_entry',
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 100, y: 100 },
          name: 'Start',
          data: { title: 'Start' },
        },
        {
          id: 'n_end',
          type: StoryNodeType.End,
          definitionVersion: 1,
          position: { x: 400, y: 100 },
          name: 'End',
          data: { title: 'End' },
        },
      ],
      edges: [
        {
          from: { nodeId: 'n_entry', portId: 'out' },
          to: { nodeId: 'n_end', portId: 'in' },
        },
      ],
    },
    assets: [],
    chapters: [],
    variables: [],
    characters: [],
    conditions: [],
    events: [],
    signals: [],
  };

  try {
    const kdlContent = serializeStorySource(initialStory);
    const targetDir = path.dirname(resolvedStoryPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(resolvedStoryPath, kdlContent, 'utf-8');

    let registeredProjectFile: string | null = null;
    if (args.registerInProject !== false) {
      const projectFilePath = findProjectFile(path.dirname(resolvedStoryPath));
      if (projectFilePath) {
        try {
          const rawProject = fs.readFileSync(projectFilePath, 'utf-8');
          const project = parseStoryProject(rawProject);
          const relPathToProject = path
            .relative(path.dirname(projectFilePath), resolvedStoryPath)
            .replace(/\\/g, '/');

          const stories = project.stories || [];
          const alreadyRegistered = stories.some(
            (s) => s.id === normalizedStoryId || s.path === relPathToProject,
          );
          if (!alreadyRegistered) {
            const updatedProject: StoryProjectDocument = {
              ...project,
              events: project.events || [],
              signals: project.signals || [],
              variables: project.variables || [],
              characters: project.characters || [],
              assets: project.assets || [],
              engineTypes: project.engineTypes || [],
              stories: [
                ...stories,
                {
                  id: normalizedStoryId,
                  path: relPathToProject,
                  name: normalizedName,
                  displayName: normalizedDisplayName,
                },
              ],
            };
            fs.writeFileSync(projectFilePath, serializeStoryProject(updatedProject), 'utf-8');
            registeredProjectFile = path.basename(projectFilePath);
          }
        } catch (projErr) {
          console.warn('[story_create] Failed to update project file:', projErr);
        }
      }
    }

    const relToWorkspace = path.relative(workspaceDir, resolvedStoryPath).replace(/\\/g, '/');
    const resultSummary = [
      `Successfully created new story file:`,
      `- File: \`${relToWorkspace}\``,
      `- Story ID: \`${normalizedStoryId}\``,
      `- Story Name: \`${normalizedName}\``,
      `- Display Name: "${normalizedDisplayName}"`,
      `- Initial Structure: Entry node (n_entry) -> End node (n_end)`,
    ];
    if (registeredProjectFile) {
      resultSummary.push(`- Registered into project manifest: \`${registeredProjectFile}\``);
    }
    resultSummary.push(
      `\nYou can now use \`story_dry_run_command\` and \`story_apply_command\` to add nodes and narrative content to this story.`,
    );

    return {
      success: true,
      content: resultSummary.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      content: `Failed to create story file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
