import { describe, expect, it } from 'vitest';
import {
  processDroppedAIContextFiles,
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_ATTACHMENTS,
} from '../packages/editor/src/renderer/graph/aiAttachmentDrop';

describe('aiAttachmentDrop - Drag and Drop Files to AI AttachFile', () => {
  it('successfully processes valid text files', async () => {
    const mockFiles = [
      {
        name: 'plot_outline.md',
        size: 100,
        text: async () => '# Chapter 1: The Encounter\nHero meets mentor in the tavern.',
      },
      {
        name: 'characters.json',
        size: 80,
        text: async () => '{"hero": "Alex", "mentor": "Eldrin"}',
      },
    ];

    const result = await processDroppedAIContextFiles(mockFiles);
    expect(result.warnings).toEqual([]);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].name).toBe('plot_outline.md');
    expect(result.attachments[0].content).toContain('Hero meets mentor');
    expect(result.attachments[1].name).toBe('characters.json');
    expect(result.attachments[1].content).toContain('"hero": "Alex"');
  });

  it('rejects files exceeding the individual file limit', async () => {
    const oversizedFile = {
      name: 'large_lore.txt',
      size: MAX_AI_ATTACHMENT_BYTES + 10,
      text: async () => 'x'.repeat(MAX_AI_ATTACHMENT_BYTES + 10),
    };

    const result = await processDroppedAIContextFiles([oversizedFile]);
    expect(result.attachments).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('exceeds the 512 KB limit');
  });

  it('rejects binary files containing null bytes', async () => {
    const binaryFile = {
      name: 'avatar.png',
      size: 500,
      text: async () => '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR',
    };

    const result = await processDroppedAIContextFiles([binaryFile]);
    expect(result.attachments).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('appears to be a binary file');
  });

  it('enforces maximum 8 attachments limit', async () => {
    const existing = Array.from({ length: 7 }, (_, i) => ({
      id: `id_${i}`,
      name: `file_${i}.txt`,
      content: 'hello',
    }));

    const newFiles = [
      { name: 'eighth.txt', size: 10, text: async () => 'eighth' },
      { name: 'ninth.txt', size: 10, text: async () => 'ninth' },
    ];

    const result = await processDroppedAIContextFiles(newFiles, existing);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe('eighth.txt');
    expect(result.warnings.some((w) => w.includes('Maximum 8 files attached'))).toBe(true);
  });

  it('stops when total byte limit would be exceeded', async () => {
    const bigFile1 = {
      name: 'big1.txt',
      size: 400 * 1024,
      text: async () => 'a'.repeat(400 * 1024),
    };
    const bigFile2 = {
      name: 'big2.txt',
      size: 400 * 1024,
      text: async () => 'b'.repeat(400 * 1024),
    };
    const bigFile3 = {
      name: 'big3.txt',
      size: 400 * 1024,
      text: async () => 'c'.repeat(400 * 1024),
    };
    const bigFile4 = {
      name: 'big4.txt',
      size: 400 * 1024,
      text: async () => 'd'.repeat(400 * 1024),
    };
    const bigFile5 = {
      name: 'big5.txt',
      size: 400 * 1024,
      text: async () => 'e'.repeat(400 * 1024),
    };
    const bigFile6 = {
      name: 'big6.txt',
      size: 400 * 1024,
      text: async () => 'f'.repeat(400 * 1024),
    };

    // 6 * 400KB = 2.4MB > 2MB total limit
    const result = await processDroppedAIContextFiles([
      bigFile1,
      bigFile2,
      bigFile3,
      bigFile4,
      bigFile5,
      bigFile6,
    ]);
    expect(result.attachments.length).toBeLessThan(6);
    expect(result.warnings.some((w) => w.includes('exceed the total attachment limit'))).toBe(true);
  });

  it('handles 25KB story script file attachment smoothly without warnings', async () => {
    const novelScript = {
      name: '序章.txt',
      size: 25 * 1024,
      text: async () => '“亲爱的旅客，前方到站奉阳北站……”\n'.repeat(800),
    };
    const result = await processDroppedAIContextFiles([novelScript]);
    expect(result.warnings).toHaveLength(0);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe('序章.txt');
    expect(result.attachments[0].content.length).toBeGreaterThan(10000);
  });
});
