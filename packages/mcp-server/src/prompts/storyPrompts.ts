import type { PromptDefinition, GetPromptResult } from '../protocol/mcpTypes';

export const storyPrompts: PromptDefinition[] = [
  {
    name: 'edit_dialogue',
    description: 'Prompts the AI to read a story node, propose dialogue lines or branch choices, and validate via dry-run before applying.',
    arguments: [
      {
        name: 'storyPath',
        description: 'Path to the .story file',
        required: true,
      },
      {
        name: 'nodeId',
        description: 'Node ID to modify or continue from',
        required: false,
      },
      {
        name: 'instructions',
        description: 'Specific authoring instructions (e.g. "Add a tense interrogation branching into two outcomes")',
        required: true,
      },
    ],
  },
  {
    name: 'review_story_integrity',
    description: 'Guides the AI to compile a story, analyze compiler diagnostics, and fix broken ports, cycles, or orphan nodes.',
    arguments: [
      {
        name: 'storyPath',
        description: 'Path to the .story file to check',
        required: true,
      },
    ],
  },
];

export function handleGetPrompt(name: string, args: Record<string, string> = {}): GetPromptResult | undefined {
  if (name === 'edit_dialogue') {
    return {
      description: 'Dialogue authoring and expansion workflow',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `You are an expert game narrative designer using StoryBlueprint.`,
              `Target Story: ${args.storyPath}`,
              args.nodeId ? `Target Node: ${args.nodeId}` : '',
              `Task Instructions: ${args.instructions || 'Review dialogue flow'}`,
              ``,
              `Recommended Workflow:`,
              `1. Call \`story_read_context\` to inspect the current node, dialogue lines, choices, and variables.`,
              `2. Propose new dialogue lines or choices that adhere to character voices and world lore.`,
              `3. Call \`story_dry_run_command\` to verify the generated operations against StoryBlueprint's sandbox rules.`,
              `4. Once dry-run passes with 0 errors, call \`story_apply_command\` to commit the changes.`,
              `5. Call \`story_compile\` to verify the entire story builds with 0 compiler errors.`,
            ].filter(Boolean).join('\n'),
          },
        },
      ],
    };
  }

  if (name === 'review_story_integrity') {
    return {
      description: 'Story integrity and compiler diagnosis workflow',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `You are reviewing the structural integrity and compiler health of StoryBlueprint project.`,
              `Target Story: ${args.storyPath}`,
              ``,
              `Recommended Workflow:`,
              `1. Call \`story_compile\` with \`storyPath: "${args.storyPath}"\` to run the compiler and inspect all diagnostics.`,
              `2. If any compilation errors or warnings are found, use \`story_read_context\` to inspect the offending nodes.`,
              `3. Prepare a Blueprint Command transaction to fix the invalid connections or conditions.`,
              `4. Run \`story_dry_run_command\` followed by \`story_apply_command\` to fix the story.`,
              `5. Re-run \`story_compile\` to confirm the story is 100% clean and runnable.`,
            ].join('\n'),
          },
        },
      ],
    };
  }

  return undefined;
}
