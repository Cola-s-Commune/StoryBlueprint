import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIInstructionsStatus } from '../shared/electronApi';

export const AI_INSTRUCTIONS_VERSION = 9;
export const MAX_AI_ATTACHMENT_BYTES = 512 * 1024;

export const DEFAULT_AGENTS_ENTRY_TEMPLATE = `# Narrative Agent Guidelines (AGENTS.md)

This project is an interactive narrative blueprint authored with **Story Blueprint** (a visual, node-based interactive narrative framework for games, interactive fiction, and visual novels).

---

## 🎨 Story Authoring & Editor Review Protocol (在编辑器蓝图中审核与 Apply)

Story Blueprint uses an **Editor Canvas Review** workflow. Modifications proposed by AI are staged directly onto the blueprint graph for visual inspection by the author.

### Recommended Workflow:
1. **Explore & Read**:
   - Inspect existing story context using \`story_read_context\` or \`story_search\`.
2. **Validate in Sandbox**:
   - Construct the Blueprint Command transaction and run \`story_dry_run_command\` to verify graph topology, reachability, and schema compatibility.
3. **Submit to Blueprint Editor**:
   - Call \`story_apply_command\` with your validated transaction to stage your work!
   - 💡 **Canvas Staging Behavior**:
     - By default, \`story_apply_command\` stages the generated nodes directly onto the blueprint canvas in the Story Blueprint editor without modifying the \`.story\` file on disk.
     - The human author will see your new/modified nodes and connections highlighted in green on the canvas, along with an **[Apply]** and **[Discard]** banner at the top of the graph.
     - The author reviews the layout and content in the editor, and clicks **[Apply]** in the editor toolbar to commit the changes to the story file.
     - *(If the author has enabled "允许 AI 自己 apply" in Editor Preferences, the changes are committed directly to disk with a \`.bak\` backup).*
4. **Inform the Author**:
   - Provide a brief summary of the narrative beats, nodes, and choices you created.
   - Let the author know that the nodes have been sent to the editor:
     *"节点与连线已生成并暂存至编辑器蓝图画布中，请在编辑器中查看绿色节点并点击「Apply」确认合入。"*

---

> ⚠️ **FULL FRAMEWORK SPECIFICATION & NODE SCHEMAS**:
> For detailed node schemas, IDs, variable dual-track rules, and operations:
> 👉 **[STORY_BLUEPRINT_AI.md](./STORY_BLUEPRINT_AI.md)**

---

## Project Narrative World & Persona (Author Customization)

<!-- Authors: Customize your narrative tone, characters, world setting, and glossary below. Agents must strictly adhere to these settings. -->

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

export const DEFAULT_FRAMEWORK_AI_INSTRUCTIONS = `<!-- story-blueprint-ai-version: 9 -->
# Story Blueprint Framework Specifications (STORY_BLUEPRINT_AI.md)

This specification defines the core mental model, constraints, node schemas, and MCP collaboration workflows for Story Blueprint.
External AI agents and IDE assistants MUST strictly follow these rules when editing story files.

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

## 2. Critical Constraints (Red Lines & Recovery Protocol)

- 🚫 **NEVER directly edit or handwrite \`*.story\` files during normal workflow**:
  \`.story\` files contain graph topology, pin UUIDs, and layout geometry. Direct text/JSON edits will corrupt pin connections and cause runtime parser crashes.
- ✅ **ALL normal mutations must be performed via the Story Blueprint MCP Server**:
  Use \`story_dry_run_command\` to validate in sandbox, then \`story_apply_command\` to persist changes atomically.
- 🆕 **Creating New \`.story\` Files**:
  To create a new story file in multi-story projects, call the MCP tool \`story_create\` (e.g. \`storyPath: "bus.story"\`). This automatically generates a valid \`.story\` skeleton (with entry node, valid topology) and registers the story in \`.storyproject\`. **Never handwrite a new \`.story\` file from scratch.**
- 🛠️ **File Corruption & Syntax Error Recovery Protocol**:
  If a \`.story\` file is damaged, has syntax errors, or fails to parse (e.g. MCP reports \`Failed to parse story file\`):
  1. **Ask the user for permission**: Clearly explain the error and ask if they would like you to attempt a file repair or restore from backup.
  2. If the user agrees:
     - Check if \`<story>.story.bak\` exists. If present and valid, you can restore from the backup.
     - Alternatively, inspect the corrupted KDL source and repair syntax defects (e.g. unclosed nodes, invalid attributes, corrupted quotes).
     - Immediately verify the fix with \`story_read_context\` and \`story_compile\` to ensure the story is fully valid and executable.

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
   - Accepts: \`nodeId\` (or \`id\`, or \`node: { id }\`).
   - ⚡ **Cascading Behavior**: \`remove-node\` **automatically deletes all connected incoming & outgoing edges**. You do NOT need to call \`disconnect\` before removing a node. To remove a link while keeping both nodes, use \`disconnect\`.
3. **\`update-node\`**: Updates an existing node's data or name (e.g. modify narration text, dialogue text, or choice prompt).
   - Format: \`{ "operationId": "op_update", "kind": "update-node", "graph": { "kind": "root" }, "nodeId": "n_intro", "patch": { "data": { "text": { "source": "新旁白文本" } } } }\`
   - Lenient aliases supported: \`{ "nodeId": "n_intro", "data": { ... } }\` or \`{ "node": { "id": "n_intro", "data": { ... } } }\`.
4. **\`connect\`**: Connects two nodes via their ports.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`from: { nodeId, portId }\`, \`to: { nodeId, portId }\`.
   - *Note*: Connecting from a \`Choice\` node requires \`from.portId\` to match the target \`option.id\` (e.g. \`"o_alarm"\`).
5. **\`disconnect\`**: Removes a specific edge between two ports.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`from: { nodeId, portId }\`, \`to: { nodeId, portId }\`.
6. **\`add-variable-adjustment\`**: Creates a dedicated node that adjusts an existing numeric variable.
   - Requires: \`operationId\`, \`graph: { "kind": "root" }\`, \`node: { id, name? }\`, \`variableId\`, \`delta\` (e.g. \`1\` or \`-1\`).
7. **\`add-character\`**: Registers a character in the story roster.
   - Requires: \`operationId\`, \`character: { id, name, displayName, emotions?: {} }\`.
8. **\`add-variable\`**: Declares a story state variable.
   - Requires: \`operationId\`, \`variable: { id, name, displayName, scope: "story", valueType: { kind: "number"|"boolean"|"string" }, defaultValue }\`.
   - ⚠️ *Note*: If a variable or character already exists in \`story_read_context\`, **DO NOT** call \`add-variable\` / \`add-character\` again, or it will throw \`DUPLICATE_VARIABLE_ID\`.
9. **Granular Operations (Appending Details to Existing Nodes)**:
   - **\`add-dialogue-line\`**: Appends a spoken line to an existing Dialogue node without recreating it.
     - Format: \`{ "operationId": "op_add_line", "kind": "add-dialogue-line", "graph": { "kind": "root" }, "nodeId": "n_dialogue", "line": { "id": "ln_2", "textId": "t_2", "text": { "source": "新台词" }, "speakerId": "c_robber" } }\`
   - **\`add-choice-option\`**: Appends an option to an existing Choice node without recreating it.
     - Format: \`{ "operationId": "op_add_opt", "kind": "add-choice-option", "graph": { "kind": "root" }, "nodeId": "n_choice", "option": { "id": "o_new", "text": { "source": "新选项" } } }\`

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

## 6. Standard Story Authoring Workflow

0. **Step 0: Initialize Story (For New Stories)**:
   - When building a new standalone story (e.g. \`bus.story\`), call \`story_create\` with \`storyPath: "bus.story"\`.
   - The server will generate the valid initial skeleton (Start & End nodes) and register it in \`.storyproject\`.
1. **Step 1: Explore & Read**:
   - Call \`story_read_context\` to inspect existing nodes, variables, and character roster.
   - Call \`story_search\` to check existing line keywords or plot beats.
2. **Step 2: Plan & Outline**:
   - Draft branch logic, options, and consequences before formulating operations.
3. **Step 3: Sandbox Validation & Editor Proposal (Human-in-the-Loop Protocol)**:
   - Call \`story_dry_run_command\` with the prepared transaction to catch connectivity, dangling nodes, or schema issues.
   - 🛑 **MANDATORY HUMAN REVIEW PROTOCOL**:
     - **Do NOT** assume changes take effect on disk without author confirmation.
     - You **MUST** first present your planned changes (outline, narrative summary, newly written dialogue lines, choice options, and branch connections) to the user in chat.
     - Wait for the user's explicit confirmation or review feedback.
   - Once confirmed by the user in dialogue, call \`story_apply_command\` with \`{ userConfirmed: true }\`:
     - **Default Editor Review Mode** (when "允许 AI 自己 apply" is off): The transaction is validated and staged as a pending visual proposal in the Story Blueprint editor. The human author sees the changes highlighted in green on the canvas graph and clicks **[Apply]** in the editor toolbar to commit the changes to the story file (or **[Discard]** to reject).
     - **Direct Auto-Apply Mode** (when "允许 AI 自己 apply" is enabled by the author in Editor Preferences > 实验性与协作设置): The server directly commits the changes to the \`.story\` file on disk with an automatic \`.bak\` backup.
4. **Step 4: Verify**:
   - Call \`story_compile\` to verify narrative flow, port compatibility, and compile diagnostics.
`;

export const DEFAULT_PROJECT_AI_INSTRUCTIONS = DEFAULT_FRAMEWORK_AI_INSTRUCTIONS;

export function extractAIInstructionsVersion(content: string): number | undefined {
  const match = /<!--\s*story-blueprint-ai-version:\s*(\d+)\s*-->/i.exec(content);
  return match ? Number(match[1]) : undefined;
}

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

export async function syncProjectAIInstructions(
  workspaceRoot: string,
): Promise<AIInstructionsStatus> {
  const agentsMdPath =
    (await findFileCaseInsensitive(workspaceRoot, 'AGENTS.md')) ?? join(workspaceRoot, 'AGENTS.md');
  const blueprintAiPath =
    (await findFileCaseInsensitive(workspaceRoot, 'STORY_BLUEPRINT_AI.md')) ??
    join(workspaceRoot, 'STORY_BLUEPRINT_AI.md');

  // 1. Ensure AGENTS.md exists (never overwrite existing AGENTS.md to protect author's customization)
  try {
    await stat(agentsMdPath);
  } catch {
    await writeFile(agentsMdPath, DEFAULT_AGENTS_ENTRY_TEMPLATE, 'utf8');
  }

  // 2. Ensure STORY_BLUEPRINT_AI.md exists and is up to date
  let needFrameworkWrite = false;
  try {
    const existingContent = await readFile(blueprintAiPath, 'utf8');
    const existingVersion = extractAIInstructionsVersion(existingContent);
    if (existingVersion === undefined || existingVersion < AI_INSTRUCTIONS_VERSION) {
      needFrameworkWrite = true;
    }
  } catch {
    needFrameworkWrite = true;
  }

  if (needFrameworkWrite) {
    await writeFile(blueprintAiPath, DEFAULT_FRAMEWORK_AI_INSTRUCTIONS, 'utf8');
  }

  return readAIInstructionsStatus(workspaceRoot);
}

export async function readProjectAIInstructions(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return DEFAULT_FRAMEWORK_AI_INSTRUCTIONS;
  try {
    const agentsMdPath = await findFileCaseInsensitive(workspaceRoot, 'AGENTS.md');
    const blueprintAiPath = await findFileCaseInsensitive(workspaceRoot, 'STORY_BLUEPRINT_AI.md');

    const sections: string[] = [DEFAULT_FRAMEWORK_AI_INSTRUCTIONS];

    if (blueprintAiPath) {
      try {
        const content = await readFile(blueprintAiPath, 'utf8');
        if (Buffer.byteLength(content, 'utf8') <= MAX_AI_ATTACHMENT_BYTES) {
          const trimmed = content.trim();
          if (trimmed && trimmed !== DEFAULT_FRAMEWORK_AI_INSTRUCTIONS.trim()) {
            sections.push(`## Project-Specific AI Instructions (STORY_BLUEPRINT_AI.md)\n\n${trimmed}`);
          }
        }
      } catch {
        // Silently skip unreadable file
      }
    }

    if (agentsMdPath) {
      try {
        const content = await readFile(agentsMdPath, 'utf8');
        if (Buffer.byteLength(content, 'utf8') <= MAX_AI_ATTACHMENT_BYTES) {
          const trimmed = content.trim();
          if (
            trimmed &&
            trimmed !== DEFAULT_FRAMEWORK_AI_INSTRUCTIONS.trim() &&
            trimmed !== DEFAULT_AGENTS_ENTRY_TEMPLATE.trim()
          ) {
            sections.push(`## Project Agent Guidelines (AGENTS.md)\n\n${trimmed}`);
          }
        }
      } catch {
        // Silently skip unreadable file
      }
    }

    return sections.length > 1 ? sections.join('\n\n') : DEFAULT_FRAMEWORK_AI_INSTRUCTIONS;
  } catch {
    return DEFAULT_FRAMEWORK_AI_INSTRUCTIONS;
  }
}

export async function readAIInstructionsStatus(
  workspaceRoot?: string,
): Promise<AIInstructionsStatus> {
  if (!workspaceRoot) {
    return { builtInVersion: AI_INSTRUCTIONS_VERSION, projectInstructions: 'missing' };
  }
  try {
    const agentsMdPath = await findFileCaseInsensitive(workspaceRoot, 'AGENTS.md');
    const blueprintAiPath = await findFileCaseInsensitive(workspaceRoot, 'STORY_BLUEPRINT_AI.md');
    const targetPath = blueprintAiPath ?? agentsMdPath ?? join(workspaceRoot, 'AGENTS.md');

    let frameworkVersion: number | undefined;
    if (blueprintAiPath) {
      try {
        const bpContent = await readFile(blueprintAiPath, 'utf8');
        frameworkVersion = extractAIInstructionsVersion(bpContent);
      } catch {
        // Silently skip
      }
    }

    const needsUpdate =
      frameworkVersion !== undefined
        ? frameworkVersion < AI_INSTRUCTIONS_VERSION
        : Boolean(agentsMdPath && !blueprintAiPath);

    try {
      const metadata = await stat(targetPath);
      return {
        builtInVersion: AI_INSTRUCTIONS_VERSION,
        projectInstructions: metadata.size > MAX_AI_ATTACHMENT_BYTES ? 'oversized' : 'loaded',
        projectInstructionsPath: targetPath,
        frameworkVersion,
        needsUpdate,
      };
    } catch {
      return {
        builtInVersion: AI_INSTRUCTIONS_VERSION,
        projectInstructions: 'missing',
        projectInstructionsPath: targetPath,
        frameworkVersion,
        needsUpdate,
      };
    }
  } catch {
    return {
      builtInVersion: AI_INSTRUCTIONS_VERSION,
      projectInstructions: 'missing',
      projectInstructionsPath: join(workspaceRoot, 'AGENTS.md'),
      needsUpdate: false,
    };
  }
}
