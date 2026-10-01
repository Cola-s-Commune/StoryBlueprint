import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { findWorkspaceRoot } from '../packages/mcp-server/src/tools/storyApply';

describe('Workspace Proposal Resolution', () => {
  it('locates workspace root via .storyblueprint or .storyproject and falls back to dirname', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-root-'));
    try {
      const nestedDir = path.join(tmpDir, 'nested', 'sub');
      fs.mkdirSync(nestedDir, { recursive: true });
      const storyFile = path.join(nestedDir, 'test.story');
      fs.writeFileSync(storyFile, 'story {}\n');

      // Without any marker, falls back to dirname of story file
      expect(findWorkspaceRoot(storyFile)).toBe(nestedDir);

      // With .storyblueprint at tmpDir, finds tmpDir
      const configDir = path.join(tmpDir, '.storyblueprint');
      fs.mkdirSync(configDir, { recursive: true });
      expect(findWorkspaceRoot(storyFile)).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('matches targetFilePath and storyPath regardless of path separators', () => {
    const currentPath = 'c:/users/qwe/documents/teststory/bus.story';
    const targetPathBackslash = 'C:\\Users\\qwe\\Documents\\TestStory\\bus.story';
    const relPath = 'bus.story';

    const normCurrent = currentPath.toLowerCase().replace(/\\/g, '/');
    const normTarget = targetPathBackslash.toLowerCase().replace(/\\/g, '/');
    const normRel = relPath.toLowerCase().replace(/\\/g, '/');

    const isMatch =
      Boolean(
        normTarget &&
          (normCurrent === normTarget ||
            normCurrent.endsWith(normTarget) ||
            normTarget.endsWith(normCurrent)),
      ) ||
      Boolean(
        normRel &&
          (normCurrent === normRel ||
            normCurrent.endsWith(normRel) ||
            normRel.endsWith(normCurrent)),
      );

    expect(isMatch).toBe(true);
  });
});
