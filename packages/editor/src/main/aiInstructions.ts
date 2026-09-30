import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIInstructionsStatus } from '../shared/electronApi';

export const AI_INSTRUCTIONS_VERSION = 6;
export const MAX_AI_ATTACHMENT_BYTES = 512 * 1024;

export const DEFAULT_PROJECT_AI_INSTRUCTIONS = `# Narrative Agent Guidelines (AGENTS.md)

This project is an interactive narrative blueprint authored with **Story Blueprint** (a visual, node-based interactive narrative framework for games, interactive fiction, and visual novels).
These guidelines define the mental model, negative constraints, node schemas, and MCP collaboration workflows.

---

## 1. Mental Model & Core Narrative Principles

- **Executable Control Flow (Not Flat Prose)**:
  Stories are modeled as **directed control-flow graphs** with typed nodes and explicit pin connections, intended for execution in a game engine or interactive player. Each node represents a distinct interactive moment (dialogue, scene narration, player decision, or state mutation).
- **Separation of Spoken Dialogue vs. Narration**:
  - \`Dialogue\` (\`type: "dialogue"\`): Spoken lines delivered by an identified character (\`speakerId\`).
    - 🚫 **NEVER** include quotation marks, stage directions, actor brackets (e.g. \`（冷笑）\` or \`[angry]\`), or inner thoughts inside spoken dialogue text. Text-to-speech / dubbing and subtitles render dialogue directly.
  - \`Narration\` (\`type: "narration"\`): Standalone narrative text for scene setting, environmental descriptions, sensory details, physical actions, and unvoiced inner thoughts.
- **Player Decisions & Branching**:
  - Player choices belong strictly in \`Choice\` (\`type: "choice"\`) nodes. Each option maps to an outgoing execution pin.
  - Logic checks (e.g. checking flags, inventory, or stats) belong in \`Branch\` (\`type: "branch"\`) nodes or reusable conditions.
- **Variable Mutation Invariant**:
  - Relative changes (e.g. increasing alert level or affection) must be incremental read-modify-write expressions or \`add-variable-adjustment\` commands (delta: \`+1\`), **NEVER** raw overwrites (like \`X = 1\`).

---

## 2. Critical Constraints (Red Lines)

- 🚫 **NEVER directly edit or handwrite \`*.story\` files**:
  \`.story\` files contain graph topology, pin UUIDs, and layout geometry. Direct text/JSON edits will corrupt pin connections and cause runtime parser crashes.
- ✅ **ALL mutations must be performed via the Story Blueprint MCP Server**:
  Use \`story_dry_run_command\` to validate in sandbox, then \`story_apply_command\` to persist changes atomically.

---

## 3. Node Type & Pin Port Reference

| Node Type | \`type\` enum | Input Ports | Output Ports | Typical Data Payload |
|---|---|---|---|---|
| **Entry Point** | \`"story-entry"\` | *None* | \`"out"\` | \`{ "title": "Opening" }\` |
| **Dialogue** | \`"dialogue"\` | \`"in"\` | \`"out"\` | \`{ "lines": [{ "id": "ln_1", "textId": "t_1", "text": { "source": "Hands up!" }, "speakerId": "c_robber" }] }\` |
| **Narration** | \`"narration"\` | \`"in"\` | \`"out"\` | \`{ "textId": "t_1", "text": { "source": "Screams echo across the bank lobby." } }\` |
| **Choice** | \`"choice"\` | \`"in"\` | **Option IDs** (e.g. \`"opt_alarm"\`) | \`{ "prompt": { "source": "What do you do?" }, "options": [{ "id": "opt_alarm", "text": { "source": "Hit alarm" } }] }\` |
| **Branch** | \`"branch"\` | \`"in"\` | \`"true"\`, \`"false"\` | \`{ "condition": { "source": "alert_level >= 2", "bindings": {} } }\` |
| **End** | \`"end-story"\` | \`"in"\` | *None* | \`{ "title": "Ending" }\` |
| **Adjust Variable** | (Action) | \`"in"\` | \`"out"\` | Uses \`add-variable-adjustment\` command (requires \`node.id\`, \`variableId\`, and \`delta\`). |

> ⚠️ **Mandatory ID Prefix Rules (Stable IDs)**:
> All IDs in operations must follow these prefix rules (or validation will reject them):
> - Node ID: starts with \`n_\` (e.g. \`n_intro\`, \`n_choice_1\`)
> - Variable ID: starts with \`v_\` (e.g. \`v_alert\`, \`v_gold\`)
> - Character ID: starts with \`c_\` (e.g. \`c_robber\`, \`c_guard\`)
> - Choice Option ID: starts with \`o_\` (e.g. \`o_surrender\`, \`o_alarm\` — **MUST be \`o_\`, NOT \`opt_\`**)
> - Dialogue Line ID: starts with \`ln_\` (e.g. \`ln_shout_01\`)
> - Text ID: starts with \`t_\` (e.g. \`t_intro_01\`)

---

## 4. MCP Command Transaction Specification

A Blueprint Command transaction is an object containing an \`operations\` array:
\`\`\`json
{
  "version": 1,
  "operations": [ /* ... */ ]
}
\`\`\`

### Common \`operation\` Kinds (Kebab-Case)

1. **\`add-node\`**: Adds a new graph node.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`node: { id, type, name?, data }\`.
2. **\`remove-node\`**: Deletes a node.
   - ⚡ **Cascading Behavior**: \`remove-node\` **automatically deletes all connected incoming & outgoing edges**. You do NOT need to call \`disconnect\` before removing a node. To remove a link while keeping both nodes, use \`disconnect\`.
3. **\`connect\`**: Connects two nodes via their ports.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`from: { nodeId, portId }\`, \`to: { nodeId, portId }\`.
   - *Note*: Connecting from a \`Choice\` node requires \`from.portId\` to match the target \`option.id\` (e.g. \`"o_alarm"\`).
4. **\`disconnect\`**: Removes a specific edge between two ports.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`from: { nodeId, portId }\`, \`to: { nodeId, portId }\`.
5. **\`add-variable-adjustment\`**: Creates a dedicated node that adjusts an existing numeric variable.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`node: { id, name? }\`, \`variableId\`, \`delta\` (e.g. \`1\` or \`-1\`).
6. **\`add-character\`**: Registers a character in the story roster.
   - Requires: \`operationId\`, \`character: { id, name, displayName, emotions?: {} }\`.
7. **\`add-variable\`**: Declares a story state variable.
   - Requires: \`operationId\`, \`variable: { id, name, displayName, scope: "story", valueType: { kind: "number"|"boolean"|"string" }, defaultValue }\`.
   - ⚠️ *Note*: If a variable or character already exists in \`story_read_context\`, **DO NOT** call \`add-variable\` / \`add-character\` again, or it will throw \`DUPLICATE_VARIABLE_ID\`.
8. **Granular Operations**: \`add-dialogue-line\`, \`update-dialogue-line\`, \`add-choice-option\`, \`update-node\`.

### ⚠️ Variable Naming Dual-Track Rule (ID vs. Name)
- **In Operations & Commands**: Reference variables by their stable **ID** (e.g. \`variableId: "v_alert"\`).
- **In Expressions & Conditions** (Branch \`condition.source\`, Choice \`visibleIf\`): Reference variables by their human **name** (e.g. \`alert_level >= 2\` or \`gold >= 400\`), **NEVER** write \`v_alert\` or \`v_gold\` inside expressions!
- **Strict ASCII Format**: IDs, variable names, and ports must be strictly lowercase alphanumeric with underscores (\`snake_case\`). Never use Chinese characters or uppercase camelCase in machine IDs.

---

## 5. End-to-End One-Shot Reference Example (Bank Heist)

The following valid transaction demonstrates declaring a new variable (\`heist_heat\`), creating nodes, adjusting variables, and linking ports:

\`\`\`json
{
  "version": 1,
  "operations": [
    {
      "operationId": "op_reg_char",
      "kind": "add-character",
      "character": { "id": "c_robber", "name": "Robber Leader", "displayName": "劫匪头目", "emotions": {} }
    },
    {
      "operationId": "op_reg_var",
      "kind": "add-variable",
      "variable": { "id": "v_heat", "name": "heist_heat", "displayName": "通缉热度", "scope": "story", "valueType": { "kind": "number" }, "defaultValue": 0 }
    },
    {
      "operationId": "op_add_intro",
      "kind": "add-node",
      "graph": { "kind": "root" },
      "node": {
        "id": "n_bank_intro",
        "type": "narration",
        "name": "bank_intro",
        "data": { "textId": "t_intro", "text": { "source": "刺耳的刹车声划破正午的寂静，一辆黑色防弹面包车停在市中心银行门前。" } }
      }
    },
    {
      "operationId": "op_add_shout",
      "kind": "add-node",
      "graph": { "kind": "root" },
      "node": {
        "id": "n_robber_shout",
        "type": "dialogue",
        "name": "robber_shout",
        "data": {
          "lines": [
            { "id": "ln_shout_01", "textId": "t_shout_01", "text": { "source": "所有人把头低下！保安，手从腰上拿开！" }, "speakerId": "c_robber" }
          ]
        }
      }
    },
    {
      "operationId": "op_add_choice",
      "kind": "add-node",
      "graph": { "kind": "root" },
      "node": {
        "id": "n_player_choice",
        "type": "choice",
        "name": "heist_first_choice",
        "data": {
          "prompt": { "source": "子弹击碎头顶吊灯，火花四溅。你此时的反应是：" },
          "options": [
            { "id": "o_surrender", "text": { "source": "顺从地趴在排椅下方，暗中观察劫匪人数与武器" } },
            { "id": "o_alarm", "text": { "source": "趁乱踢翻垃圾桶制造声响，伸手摸向柜台暗处的报警按钮" } }
          ]
        }
      }
    },
    {
      "operationId": "op_add_alarm_action",
      "kind": "add-variable-adjustment",
      "graph": { "kind": "root" },
      "node": { "id": "n_inc_heat", "name": "trigger_alarm" },
      "variableId": "v_heat",
      "delta": 1
    },
    {
      "operationId": "op_link_intro_to_shout",
      "kind": "connect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_bank_intro", "portId": "out" },
      "to": { "nodeId": "n_robber_shout", "portId": "in" }
    },
    {
      "operationId": "op_link_shout_to_choice",
      "kind": "connect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_robber_shout", "portId": "out" },
      "to": { "nodeId": "n_player_choice", "portId": "in" }
    },
    {
      "operationId": "op_link_choice_alarm",
      "kind": "connect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_player_choice", "portId": "o_alarm" },
      "to": { "nodeId": "n_inc_heat", "portId": "in" }
    }
  ]
}
\`\`\`

---

## 6. Standard 4-Step Agent Workflow

1. **Step 1: Explore & Read**:
   - Call \`story_read_context\` to inspect existing nodes, variables, and character roster.
   - Call \`story_search\` to check existing line keywords or plot beats.
2. **Step 2: Plan & Outline**:
   - Draft branch logic, options, and consequences before formulating operations.
3. **Step 3: Sandbox Validation & Commit**:
   - Call \`story_dry_run_command\` with the prepared transaction to catch connectivity or schema issues.
   - Call \`story_apply_command\` to atomically persist the changes to disk.
4. **Step 4: Verify**:
   - Call \`story_compile\` to verify narrative flow, port compatibility, and compile diagnostics.

---

## 7. Project Narrative World & Persona (Author Customization)

<!-- Authors: Customize your narrative tone, characters, and glossary below. Agents must strictly adhere to these settings. -->

### World Setting & Tone
- **Genre & Tone**: (e.g. Modern Crime Thriller, Urban Fantasy, Hard Sci-Fi, Slice-of-life Mystery)
- **Dialogue Style**: (e.g. Fast-paced, gritty, snappy, poetic, naturalistic modern)

### Key Characters & Voice
- **Protagonist**: Personality traits, verbal tics, speaking rhythm.
- **Key Cast**: Unique speaking styles, relationships, emotional dynamics.

### Glossary & Canon Constraints
- **Key Terminology**: (Special nouns, factions, locations, world lore terms)
- **Hard Constraints**: (Taboos, plot rules, timeline rules that must never be broken)
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
