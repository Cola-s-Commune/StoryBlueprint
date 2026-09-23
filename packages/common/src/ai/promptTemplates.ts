import { StoryNodeType } from '../types/nodes';

export interface CharacterPromptContext {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  dialogueStyle?: string;
  tags?: readonly string[];
  emotions?: readonly string[];
}

export interface NodePromptContext {
  id: string;
  type: StoryNodeType;
  text?: string;
  speakerName?: string;
  speakerId?: string;
}

export interface DialogueContinuationOptions {
  /** The primary speaker for this dialogue continuation. */
  targetCharacter?: CharacterPromptContext;
  /** Secondary character if this is an alternating dialogue between two characters. */
  secondCharacter?: CharacterPromptContext;
  /** Whether the lines are spoken by a single character or alternating dialogue. */
  speakerMode?: 'single' | 'alternating';
  /** Desired emotion for the primary speaker. */
  emotion?: string;
  /** Additional narrative direction, topic, or dramatic tone. */
  toneOrDirection?: string;
  /** Approximate number of lines to generate (default 2 to 4). */
  lineCount?: number;
  /** Preceding node in the graph to continue from. */
  sourceNode?: NodePromptContext;
  /** Whether to automatically connect the source node's 'out' port to the new node's 'in' port. */
  autoConnect?: boolean;
  /** Target graph (default root). */
  targetGraph?: { kind: 'root' | 'chapter'; chapterId?: string };
}

export interface BranchSuggestionOptions {
  /** Preceding node in the graph where the decision occurs. */
  sourceNode?: NodePromptContext;
  /** The prompt or dilemma question shown to the player. */
  choicePrompt?: string;
  /** Number of choice options to generate (default: 2 or 3). */
  branchCount?: number;
  /** Presets for dramatic conflict type. */
  conflictType?:
    | 'dilemma'
    | 'emotional'
    | 'rational_vs_impulsive'
    | 'accept_vs_reject'
    | 'truth_vs_lie'
    | 'custom';
  /** Custom description when conflictType is 'custom'. */
  customConflictDescription?: string;
  /**
   * When true, generates a follow-up Dialogue node for each branch option,
   * with distinct reactions, connected to each option's output port.
   */
  includeConsequenceNodes?: boolean;
  /** Key character reacting in the consequence branches. */
  reactingCharacter?: CharacterPromptContext;
  /** Whether to connect the source node to the Choice node. */
  autoConnect?: boolean;
  /** Target graph (default root). */
  targetGraph?: { kind: 'root' | 'chapter'; chapterId?: string };
}

export interface DialoguePolishOptions {
  /** The dialogue lines to polish. */
  lines: readonly {
    id: string;
    text: string;
    speakerName?: string;
    speakerId?: string;
    emotion?: string;
  }[];
  /** The target character whose tone and voice should be applied. */
  targetCharacter?: CharacterPromptContext;
  /** The target emotion. */
  targetEmotion?: string;
  /** Polish intent. */
  polishGoal?: 'in_character' | 'more_dramatic' | 'more_concise' | 'subtle_hint' | 'custom';
  /** Custom instruction or direction for the polish. */
  customDirection?: string;
}

export interface ScriptAdaptationOptions {
  /** Raw prose or screenplay excerpt to adapt into Blueprint nodes. */
  scriptText: string;
  /** Existing story characters that the AI should prioritize binding. */
  knownCharacters?: readonly CharacterPromptContext[];
  /** Preceding node to append this adapted section to. */
  sourceNode?: NodePromptContext;
  /** Whether to automatically connect from sourceNode. */
  autoConnect?: boolean;
  /** Target graph (default root). */
  targetGraph?: { kind: 'root' | 'chapter'; chapterId?: string };
}

function formatCharacterProfile(character: CharacterPromptContext): string {
  const parts = [`${character.displayName} (${character.name}, ID: ${character.id})`];
  if (character.description) parts.push(`Description: "${character.description}"`);
  if (character.dialogueStyle) parts.push(`Speaking Style: "${character.dialogueStyle}"`);
  if (character.tags?.length) parts.push(`Personality Tags: [${character.tags.join(', ')}]`);
  if (character.emotions?.length) parts.push(`Available Emotions: [${character.emotions.join(', ')}]`);
  return parts.join(' | ');
}

/** Builds an author-directed prompt for AI dialogue continuation. */
export function buildDialogueContinuationPrompt(options: DialogueContinuationOptions): string {
  const linesCount = options.lineCount ?? 3;
  const graphKind = options.targetGraph?.kind ?? 'root';
  const chapterId = options.targetGraph?.chapterId;
  const graphTarget =
    graphKind === 'chapter' && chapterId
      ? `in chapter "${chapterId}"`
      : 'in the root graph';

  const instructions: string[] = [
    `TASK: Generate continuation dialogue ${graphTarget}.`,
  ];

  if (options.sourceNode) {
    instructions.push(
      `CONTINUE AFTER NODE: "${options.sourceNode.id}" (${options.sourceNode.type})${
        options.sourceNode.speakerName ? ` spoken by ${options.sourceNode.speakerName}` : ''
      }${options.sourceNode.text ? `: "${options.sourceNode.text}"` : ''}`,
    );
  }

  if (options.speakerMode === 'alternating' && options.targetCharacter && options.secondCharacter) {
    instructions.push(
      'CONVERSATION MODE: Alternating dialogue between two characters:',
      `1. Primary: ${formatCharacterProfile(options.targetCharacter)}`,
      `2. Interlocutor: ${formatCharacterProfile(options.secondCharacter)}`,
    );
  } else if (options.targetCharacter) {
    instructions.push(`PRIMARY SPEAKER: ${formatCharacterProfile(options.targetCharacter)}`);
    if (options.emotion) {
      instructions.push(`EMOTION: ${options.emotion}`);
    }
  }

  if (options.toneOrDirection) {
    instructions.push(`NARRATIVE DIRECTION & TONE: ${options.toneOrDirection}`);
  }

  instructions.push(
    `LENGTH: Generate approximately ${linesCount} lines of spoken dialogue or narration.`,
    'RULES:',
    '- Propose a Blueprint Command transaction with format "story-blueprint-commands".',
    '- Add a new Dialogue node (e.g. ID "n_ai_dialogue_...") with the lines array.',
    '- Each line in "lines" must have a unique stable ID (e.g. "ln_ai_..."), "textId" (e.g. "t_ai_..."), and "text: { source: ... }".',
    '- Spoken lines MUST bind "speakerId" to the character ID. Do NOT include quotes around speech.',
    '- Narration lines must omit "speakerId".',
  );

  if (options.autoConnect && options.sourceNode) {
    instructions.push(
      `- Connect predecessor node "${options.sourceNode.id}" port "out" to the new Dialogue node port "in".`,
    );
  }

  return instructions.join('\n');
}

/** Builds an author-directed prompt for AI branch and choice suggestion. */
export function buildBranchSuggestionPrompt(options: BranchSuggestionOptions): string {
  const branchCount = Math.max(2, Math.min(4, options.branchCount ?? 3));
  const graphKind = options.targetGraph?.kind ?? 'root';
  const chapterId = options.targetGraph?.chapterId;
  const graphTarget =
    graphKind === 'chapter' && chapterId
      ? `in chapter "${chapterId}"`
      : 'in the root graph';

  const instructions: string[] = [
    `TASK: Generate an interactive decision branch with ${branchCount} distinct options ${graphTarget}.`,
  ];

  if (options.sourceNode) {
    instructions.push(
      `PRECEDING SCENE / BEAT: Node "${options.sourceNode.id}" (${options.sourceNode.type})${
        options.sourceNode.speakerName ? ` by ${options.sourceNode.speakerName}` : ''
      }${options.sourceNode.text ? `: "${options.sourceNode.text}"` : ''}`,
    );
  }

  if (options.choicePrompt) {
    instructions.push(`CHOICE PROMPT: "${options.choicePrompt}"`);
  }

  const conflictDescriptions: Record<string, string> = {
    dilemma: 'A morally difficult dilemma where both choices have trade-offs.',
    emotional: 'An emotional crossroad testing trust, vulnerability, or loyalty.',
    rational_vs_impulsive: 'A contrast between a calm, logical approach and an impulsive, passion-driven one.',
    accept_vs_reject: 'A pivotal decision to accept or reject an offer, challenge, or confession.',
    truth_vs_lie: 'A choice between telling a harsh truth or concealing it with a protective lie.',
    custom: options.customConflictDescription ?? 'A dramatic choice reflecting contrasting attitudes.',
  };

  const conflictStyle = conflictDescriptions[options.conflictType ?? 'dilemma'];
  instructions.push(`CONFLICT & CHOICE NATURE: ${conflictStyle}`);

  if (options.includeConsequenceNodes) {
    instructions.push(
      'EXPAND BRANCH CONSEQUENCES: For each choice option, create a follow-up Dialogue node representing the immediate character reaction or consequence.',
    );
    if (options.reactingCharacter) {
      instructions.push(`REACTING CHARACTER: ${formatCharacterProfile(options.reactingCharacter)}`);
    }
  }

  instructions.push(
    'RULES:',
    '- Propose a Blueprint Command transaction with format "story-blueprint-commands".',
    `- Add one Choice node (e.g. ID "n_ai_choice_...") with prompt and ${branchCount} options (IDs "o_ai_opt_1", "o_ai_opt_2", etc.).`,
  );

  if (options.autoConnect && options.sourceNode) {
    instructions.push(
      `- Connect predecessor node "${options.sourceNode.id}" port "out" to Choice node port "in".`,
    );
  }

  if (options.includeConsequenceNodes) {
    instructions.push(
      `- For each option "o_ai_opt_X", create a separate Dialogue node (e.g. "n_ai_branch_X").`,
      `- Add a "connect" operation from the Choice node port "o_ai_opt_X" to the corresponding Dialogue node port "in".`,
    );
  }

  return instructions.join('\n');
}

/** Builds an author-directed prompt for polishing existing dialogue lines in character voice. */
export function buildDialoguePolishPrompt(options: DialoguePolishOptions): string {
  const instructions: string[] = [
    'TASK: Polish and rewrite the following dialogue lines to elevate quality and character authenticity.',
  ];

  if (options.targetCharacter) {
    instructions.push(`TARGET CHARACTER VOICE: ${formatCharacterProfile(options.targetCharacter)}`);
  }
  if (options.targetEmotion) {
    instructions.push(`TARGET EMOTION: ${options.targetEmotion}`);
  }

  const goalDescriptions: Record<string, string> = {
    in_character: 'Strengthen character persona, speech habits, and distinctive catchphrases or cadence.',
    more_dramatic: 'Heighten the dramatic tension, emotional impact, and stakes.',
    more_concise: 'Make lines punchier and more concise without losing key meaning.',
    subtle_hint: 'Add subtext, subtlety, and implicit emotional nuances.',
    custom: options.customDirection ?? 'Refine style and quality.',
  };

  instructions.push(`POLISH GOAL: ${goalDescriptions[options.polishGoal ?? 'in_character']}`);
  if (options.customDirection) {
    instructions.push(`ADDITIONAL INSTRUCTIONS: ${options.customDirection}`);
  }

  instructions.push('ORIGINAL LINES TO POLISH:');
  for (const line of options.lines) {
    instructions.push(
      `- Line ID "${line.id}"${line.speakerName ? ` [${line.speakerName}]` : ''}${
        line.emotion ? ` (${line.emotion})` : ''
      }: "${line.text}"`,
    );
  }

  instructions.push(
    'RULES:',
    '- Propose a Blueprint Command transaction using "update-dialogue-line" operations for the modified line IDs.',
    '- Preserve the existing line IDs and text IDs.',
    '- Deliver pure spoken words without external quotation marks.',
  );

  return instructions.join('\n');
}

/** Builds an author-directed prompt for adapting prose or screenplay text into Blueprint nodes. */
export function buildScriptAdaptationPrompt(options: ScriptAdaptationOptions): string {
  const instructions: string[] = [
    'TASK: Adapt the following prose/screenplay script into executable Story Blueprint nodes.',
  ];

  if (options.knownCharacters?.length) {
    instructions.push(
      'AVAILABLE CHARACTERS IN STORY (prioritize matching speakers to these existing IDs):',
    );
    for (const char of options.knownCharacters) {
      instructions.push(`- ${formatCharacterProfile(char)}`);
    }
  }

  if (options.sourceNode) {
    instructions.push(
      `CONTINUE AFTER NODE: "${options.sourceNode.id}" (${options.sourceNode.type})`,
    );
  }

  instructions.push(
    'ADAPTATION RULES:',
    '- Preserve narrative pacing, spoken words, inner thoughts, and scene beats.',
    '- Split mixed prose into separate Dialogue Lines: Narration lines (without speakerId) vs Spoken lines (with speakerId bound to the character).',
    '- Spoken dialogue text must NOT contain quotation marks.',
    '- Create Dialogue nodes and connect them in sequential execution order.',
    '- Return a valid "story-blueprint-commands" transaction.',
  );

  if (options.autoConnect && options.sourceNode) {
    instructions.push(
      `- Connect predecessor node "${options.sourceNode.id}" port "out" to the first adapted node port "in".`,
    );
  }

  instructions.push(
    'SOURCE SCRIPT TEXT TO ADAPT:',
    '```text',
    options.scriptText.trim(),
    '```',
  );

  return instructions.join('\n');
}
