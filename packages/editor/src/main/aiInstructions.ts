import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIInstructionsStatus } from '../shared/electronApi';

export const AI_INSTRUCTIONS_VERSION = 6;
export const MAX_AI_ATTACHMENT_BYTES = 512 * 1024;

export const DEFAULT_PROJECT_AI_INSTRUCTIONS = `# Narrative Agent Guidelines (AGENTS.md)

This project is an interactive narrative blueprint authored with Story Blueprint.
These guidelines define narrative conventions, visual blueprint rules, and MCP agent workflows.

---

## 1. Core Narrative & Blueprint Rules

- **Executable Control Flow**: Stories are modeled as directed control-flow graphs with typed nodes and explicit pin connections, not flat prose synopses.
- **Dialogue vs. Narration**:
  - \`Dialogue\` nodes: Spoken lines delivered by an identified character (\`speakerId\`). NEVER include quotation marks, stage directions, scene descriptions, or inner thoughts in spoken dialogue.
  - \`Narration\` nodes: Standalone narration for scene descriptions, sensory details, environmental atmosphere, actions, and unvoiced inner thoughts.
- **Choice & Branching**:
  - Player-facing interactive decisions belong in \`Choice\` nodes.
  - Logical conditions belong in \`Branch\` nodes or reusable condition resources.
- **Variable Mutations**:
  - Relative changes (e.g. "Increase affection by 1") must be read-modify-write expressions (\`X + 1\`), NEVER raw assignments (\`X = 1\`). Prefer incremental adjustments to avoid stomping variables.
- **Single Story Invariant**:
  - Each \`*.story\` is compiled as an independent execution unit. Cross-story shared state is managed through External Functions or project-level resources.

---

## 2. MCP Collaboration Workflow (Claude / Cursor / Codex)

When collaborating via the Story Blueprint MCP Server:
1. **Explore & Read**:
   - Use \`story_read_context\` to inspect story blueprint structures, nodes, variables, and character rosters.
   - Use \`story_search\` to locate specific dialogue lines, choices, or variable references.
2. **Plan & Sandbox**:
   - Always prepare changes as Blueprint Command transactions (\`command.operations\`).
   - Use \`story_dry_run_command\` first to simulate changes, check pin connectivity, and detect potential variable conflicts without touching disk files.
3. **Apply & Verify**:
   - Commit validated changes with \`story_apply_command\` (automatically creates \`.bak\` safety snapshots).
   - Verify story integrity with \`story_compile\`.

---

## 3. Project Narrative World & Persona (Author Customization)

<!-- Authors: Customize your narrative tone, characters, and glossary below. Agents must strictly adhere to these settings. -->

### World Setting & Tone
- **Genre & Tone**: (e.g. Urban Fantasy, Hard Sci-Fi, Slice-of-life Mystery, etc.)
- **Dialogue Style**: (e.g. Fast-paced, poetic, naturalistic modern, distinct dialect)

### Key Characters & Voice
- **Protagonist**: Personality traits, verbal tics, speaking rhythm.
- **Key Cast**: Unique speaking styles, relationships, emotional dynamics.

### Glossary & Canon Constraints
- **Key Terminology**: (Special nouns, factions, world lore terms)
- **Hard Constraints**: (Taboos, plot constraints, rules that must never be broken)
`;

export async function findFileCaseInsensitive(
  dir: string,
  targetName: string,
): Promise<string | undefined> {
  try {
    const entries = await readdir(dir);
    const lower = targetName.toLowerCase();
    const match = entries.find((name) => name.toLowerCase() === lower);
    return match ? join(dir, match) : undefined;
  } catch {
    return undefined;
  }
}

export async function readProjectAIInstructions(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return DEFAULT_PROJECT_AI_INSTRUCTIONS;
  try {
    const agentsMdPath = await findFileCaseInsensitive(workspaceRoot, 'AGENTS.md');
    const blueprintAiPath = await findFileCaseInsensitive(workspaceRoot, 'STORY_BLUEPRINT_AI.md');

    const sections: string[] = [DEFAULT_PROJECT_AI_INSTRUCTIONS];

    if (agentsMdPath) {
      try {
        const content = await readFile(agentsMdPath, 'utf8');
        if (Buffer.byteLength(content, 'utf8') <= MAX_AI_ATTACHMENT_BYTES) {
          const trimmed = content.trim();
          if (trimmed && trimmed !== DEFAULT_PROJECT_AI_INSTRUCTIONS.trim()) {
            sections.push(`## Project Agent Guidelines (AGENTS.md)\n\n${trimmed}`);
          }
        }
      } catch {
        // Silently skip unreadable file
      }
    }

    if (blueprintAiPath && blueprintAiPath !== agentsMdPath) {
      try {
        const content = await readFile(blueprintAiPath, 'utf8');
        if (Buffer.byteLength(content, 'utf8') <= MAX_AI_ATTACHMENT_BYTES) {
          const trimmed = content.trim();
          if (trimmed && trimmed !== DEFAULT_PROJECT_AI_INSTRUCTIONS.trim()) {
            sections.push(`## Project-Specific AI Instructions (STORY_BLUEPRINT_AI.md)\n\n${trimmed}`);
          }
        }
      } catch {
        // Silently skip unreadable file
      }
    }

    return sections.length > 1 ? sections.join('\n\n') : DEFAULT_PROJECT_AI_INSTRUCTIONS;
  } catch {
    return DEFAULT_PROJECT_AI_INSTRUCTIONS;
  }
}

export async function readAIInstructionsStatus(
  workspaceRoot?: string,
): Promise<AIInstructionsStatus> {
  if (!workspaceRoot)
    return { builtInVersion: AI_INSTRUCTIONS_VERSION, projectInstructions: 'missing' };
  try {
    const agentsMdPath = await findFileCaseInsensitive(workspaceRoot, 'AGENTS.md');
    const blueprintAiPath = await findFileCaseInsensitive(workspaceRoot, 'STORY_BLUEPRINT_AI.md');
    const targetPath = agentsMdPath ?? blueprintAiPath ?? join(workspaceRoot, 'AGENTS.md');
    try {
      const metadata = await stat(targetPath);
      return {
        builtInVersion: AI_INSTRUCTIONS_VERSION,
        projectInstructions: metadata.size > MAX_AI_ATTACHMENT_BYTES ? 'oversized' : 'loaded',
        projectInstructionsPath: targetPath,
      };
    } catch {
      return {
        builtInVersion: AI_INSTRUCTIONS_VERSION,
        projectInstructions: 'missing',
        projectInstructionsPath: targetPath,
      };
    }
  } catch {
    return {
      builtInVersion: AI_INSTRUCTIONS_VERSION,
      projectInstructions: 'missing',
      projectInstructionsPath: join(workspaceRoot, 'AGENTS.md'),
    };
  }
}
