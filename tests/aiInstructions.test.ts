import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_PROJECT_AI_INSTRUCTIONS,
  findFileCaseInsensitive,
  readAIInstructionsStatus,
  readProjectAIInstructions,
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

  it('safely migrates legacy AGENTS.md starting with legacy header to STORY_BLUEPRINT_AI.md', async () => {
    const dir = await createTempDir();
    const legacyContent = '# Story Blueprint AI Instructions\n\nLegacy generated instructions.';
    await writeFile(join(dir, 'AGENTS.md'), legacyContent);

    const instructions = await readProjectAIInstructions(dir);
    expect(instructions).toContain('Legacy generated instructions');

    // Verify file was migrated
    const migratedFile = await findFileCaseInsensitive(dir, 'STORY_BLUEPRINT_AI.md');
    expect(migratedFile).toBeDefined();
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
});
