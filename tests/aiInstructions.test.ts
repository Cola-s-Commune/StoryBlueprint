import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import {
  AI_INSTRUCTIONS_VERSION,
  DEFAULT_AGENTS_ENTRY_TEMPLATE,
  DEFAULT_FRAMEWORK_AI_INSTRUCTIONS,
  DEFAULT_PROJECT_AI_INSTRUCTIONS,
  extractAIInstructionsVersion,
  findFileCaseInsensitive,
  readAIInstructionsStatus,
  readProjectAIInstructions,
  syncProjectAIInstructions,
} from '../packages/editor/src/main/aiInstructions';

describe('aiInstructions', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    while (temporaryDirectories.length > 0) {
      const dir = temporaryDirectories.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function createTempDir(): Promise<string> {
    const dir = join(tmpdir(), `sb_test_ai_inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    await mkdir(dir, { recursive: true });
    temporaryDirectories.push(dir);
    return dir;
  }

  it('finds files case-insensitively', async () => {
    const dir = await createTempDir();
    await writeFile(join(dir, 'Agents.md'), '# Galgame Rules\nAlways convert text to blueprint nodes.');
    const found = await findFileCaseInsensitive(dir, 'AGENTS.MD');
    expect(found).toBeDefined();
    expect(found?.toLowerCase()).toContain('agents.md');
  });

  it('returns default instructions if workspaceRoot is undefined', async () => {
    const result = await readProjectAIInstructions(undefined);
    expect(result).toBe(DEFAULT_PROJECT_AI_INSTRUCTIONS);
  });

  it('reads user Agents.md guidelines and includes them in prompt instructions', async () => {
    const dir = await createTempDir();
    const customRules = '# Galgame Adaptation Guidelines\nThis is a galgame project. Convert source prose to dialogue and narration nodes.';
    await writeFile(join(dir, 'Agents.md'), customRules);

    const instructions = await readProjectAIInstructions(dir);
    expect(instructions).toContain(DEFAULT_PROJECT_AI_INSTRUCTIONS);
    expect(instructions).toContain('## Project Agent Guidelines (AGENTS.md)');
    expect(instructions).toContain(customRules);
  });

  it('reads both STORY_BLUEPRINT_AI.md and Agents.md when both exist', async () => {
    const dir = await createTempDir();
    const blueprintRules = 'Custom story blueprint rules here.';
    const agentRules = 'Special galgame characters and pacing here.';
    await writeFile(join(dir, 'STORY_BLUEPRINT_AI.md'), blueprintRules);
    await writeFile(join(dir, 'Agents.md'), agentRules);

    const instructions = await readProjectAIInstructions(dir);
    expect(instructions).toContain('## Project-Specific AI Instructions (STORY_BLUEPRINT_AI.md)');
    expect(instructions).toContain(blueprintRules);
    expect(instructions).toContain('## Project Agent Guidelines (AGENTS.md)');
    expect(instructions).toContain(agentRules);
  });

  it('reads legacy STORY_BLUEPRINT_AI.md and incorporates it into prompt instructions', async () => {
    const dir = await createTempDir();
    const legacyContent = 'Legacy generated story blueprint instructions.';
    await writeFile(join(dir, 'STORY_BLUEPRINT_AI.md'), legacyContent);

    const instructions = await readProjectAIInstructions(dir);
    expect(instructions).toContain('## Project-Specific AI Instructions (STORY_BLUEPRINT_AI.md)');
    expect(instructions).toContain('Legacy generated story blueprint instructions.');
  });

  it('reports instructions status correctly for Agents.md and STORY_BLUEPRINT_AI.md', async () => {
    const dir = await createTempDir();

    // Initially missing
    let status = await readAIInstructionsStatus(dir);
    expect(status.projectInstructions).toBe('missing');

    // With Agents.md, status becomes loaded
    await writeFile(join(dir, 'Agents.md'), '# Galgame Rules');
    status = await readAIInstructionsStatus(dir);
    expect(status.projectInstructions).toBe('loaded');
  });

  it('extracts framework version correctly from header comment', () => {
    expect(extractAIInstructionsVersion('<!-- story-blueprint-ai-version: 8 -->\n# Specs')).toBe(8);
    expect(extractAIInstructionsVersion('<!--story-blueprint-ai-version:12-->\n# Specs')).toBe(12);
    expect(extractAIInstructionsVersion('# No version header')).toBeUndefined();
  });

  it('syncs project AI instructions by generating AGENTS.md and STORY_BLUEPRINT_AI.md', async () => {
    const dir = await createTempDir();
    const status = await syncProjectAIInstructions(dir);

    expect(status.frameworkVersion).toBe(AI_INSTRUCTIONS_VERSION);
    expect(status.needsUpdate).toBe(false);

    // Verify AGENTS.md was created with reference to STORY_BLUEPRINT_AI.md
    const agentsContent = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsContent).toContain('STORY_BLUEPRINT_AI.md');
    expect(agentsContent).toContain('Project Narrative World & Persona');

    // Verify STORY_BLUEPRINT_AI.md was created with version header
    const frameworkContent = await readFile(join(dir, 'STORY_BLUEPRINT_AI.md'), 'utf8');
    expect(frameworkContent).toContain(`<!-- story-blueprint-ai-version: ${AI_INSTRUCTIONS_VERSION} -->`);
  });

  it('updates outdated STORY_BLUEPRINT_AI.md while strictly preserving author custom AGENTS.md', async () => {
    const dir = await createTempDir();

    // User has custom AGENTS.md
    const customUserStoryRules = '# My Epic Game Rules\nProtagonist is named Alex. Never kill him.';
    await writeFile(join(dir, 'AGENTS.md'), customUserStoryRules);

    // Outdated STORY_BLUEPRINT_AI.md (v2)
    const outdatedFramework = '<!-- story-blueprint-ai-version: 2 -->\n# Old Framework Specs';
    await writeFile(join(dir, 'STORY_BLUEPRINT_AI.md'), outdatedFramework);

    // Verify status flags update requirement
    const beforeStatus = await readAIInstructionsStatus(dir);
    expect(beforeStatus.frameworkVersion).toBe(2);
    expect(beforeStatus.needsUpdate).toBe(true);

    // Perform sync
    const afterStatus = await syncProjectAIInstructions(dir);
    expect(afterStatus.frameworkVersion).toBe(AI_INSTRUCTIONS_VERSION);
    expect(afterStatus.needsUpdate).toBe(false);

    // Crucial check: User AGENTS.md is 100% UNTOUCHED
    const agentsContent = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsContent).toBe(customUserStoryRules);

    // Framework file was upgraded
    const updatedFramework = await readFile(join(dir, 'STORY_BLUEPRINT_AI.md'), 'utf8');
    expect(updatedFramework).toContain(`<!-- story-blueprint-ai-version: ${AI_INSTRUCTIONS_VERSION} -->`);
  });
});
