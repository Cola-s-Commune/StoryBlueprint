import { describe, expect, it } from 'vitest';
import {
  AI_SLASH_COMMANDS,
  findMatchingSlashCommands,
  applySlashCommandToText,
} from '../packages/editor/src/renderer/components/Panels/aiSlashCommands';

describe('aiSlashCommands', () => {
  it('returns all commands when text starts with /', () => {
    const match = findMatchingSlashCommands('/', 1);
    expect(match).not.toBeNull();
    expect(match?.query).toBe('');
    expect(match?.commands.length).toBe(AI_SLASH_COMMANDS.length);
    expect(match?.startIndex).toBe(0);
    expect(match?.endIndex).toBe(1);
  });

  it('filters commands by prefix', () => {
    const matchScript = findMatchingSlashCommands('/sc', 3);
    expect(matchScript).not.toBeNull();
    expect(matchScript?.commands.some((c) => c.command === '/script')).toBe(true);
    expect(matchScript?.commands.some((c) => c.command === '/branch')).toBe(false);

    const matchBranch = findMatchingSlashCommands('/br', 3);
    expect(matchBranch).not.toBeNull();
    expect(matchBranch?.commands.some((c) => c.command === '/branch')).toBe(true);
  });

  it('matches commands by alias', () => {
    const matchAdapt = findMatchingSlashCommands('/ad', 3);
    expect(matchAdapt).not.toBeNull();
    expect(matchAdapt?.commands.some((c) => c.command === '/script')).toBe(true);

    const matchChoice = findMatchingSlashCommands('/ch', 3);
    expect(matchChoice).not.toBeNull();
    expect(matchChoice?.commands.some((c) => c.command === '/branch')).toBe(true);
  });

  it('matches commands by label', () => {
    const matchLabel = findMatchingSlashCommands('/剧本', 3);
    expect(matchLabel).not.toBeNull();
    expect(matchLabel?.commands.some((c) => c.id === 'script')).toBe(true);
  });

  it('matches commands on a new line', () => {
    const text = 'First line\n/po';
    const match = findMatchingSlashCommands(text, text.length);
    expect(match).not.toBeNull();
    expect(match?.query).toBe('po');
    expect(match?.startIndex).toBe(11);
    expect(match?.endIndex).toBe(14);
    expect(match?.commands.some((c) => c.command === '/polish')).toBe(true);
  });

  it('returns null when cursor is not at a slash command prefix', () => {
    expect(findMatchingSlashCommands('hello /script', 5)).toBeNull();
    expect(findMatchingSlashCommands('hello world', 11)).toBeNull();
    expect(findMatchingSlashCommands('', 0)).toBeNull();
  });

  it('applies slash command template cleanly to text', () => {
    const text = '/sc';
    const match = findMatchingSlashCommands(text, 3);
    expect(match).not.toBeNull();
    if (!match) return;

    const cmd = match.commands.find((c) => c.id === 'script')!;
    const template = cmd.buildTemplate({
      selectedNodeId: 'n_prev',
      hasAttachments: true,
    });

    const result = applySlashCommandToText(text, match.startIndex, match.endIndex, template);
    expect(result.newText).toBe(template);
    expect(result.newText).toContain('/script');
    expect(result.newText).toContain('附带的剧本文件');
    expect(result.newText).toContain('n_prev');
    expect(result.newCursorPos).toBe(template.length);
  });

  it('verifies recommended context scopes for all slash commands', () => {
    const scriptCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'script')!;
    expect(scriptCmd.recommendedScope).toBe('graph');

    const branchCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'branch')!;
    expect(branchCmd.recommendedScope).toBe('selection');

    const polishCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'polish')!;
    expect(polishCmd.recommendedScope).toBe('selection');

    const continueCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'continue')!;
    expect(continueCmd.recommendedScope).toBe('selection');

    const fixCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'fix')!;
    expect(fixCmd.recommendedScope).toBe('graph');

    const discussCmd = AI_SLASH_COMMANDS.find((c) => c.id === 'discuss')!;
    expect(discussCmd.recommendedScope).toBe('graph');
    expect(discussCmd.command).toBe('/discuss');
    expect(discussCmd.aliases).toContain('/chat');
  });
});
