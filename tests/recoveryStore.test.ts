import { describe, expect, it } from 'vitest';
import { parseRecoveryStore } from '../packages/editor/src/main/recoveryStore';

const valid = {
  storyId: 'story_1',
  displayName: 'Recovered Story',
  filePath: 'C:\\Stories\\main.story',
  content: 'valid-content',
  savedAt: '2026-08-12T01:00:00.000Z',
};

describe('recovery store parsing', () => {
  const validate = (content: string) => content === 'valid-content';

  it('keeps valid recovery snapshots', () => {
    expect(parseRecoveryStore([valid], validate, 50)).toEqual({ snapshots: [valid] });
  });

  it('keeps valid entries while reporting damaged entries', () => {
    expect(
      parseRecoveryStore(
        [valid, { ...valid, storyId: 'story_2', content: 'broken' }],
        validate,
        50,
      ),
    ).toEqual({
      snapshots: [valid],
      error: 'Some damaged recovery entries were ignored.',
    });
  });

  it('rejects a damaged top-level recovery format', () => {
    expect(parseRecoveryStore({ snapshots: [valid] }, validate, 50)).toEqual({
      snapshots: [],
      error: 'Recovery data has an invalid format.',
    });
  });

  it('limits the number of restored entries', () => {
    expect(
      parseRecoveryStore([valid, { ...valid, storyId: 'story_2' }], validate, 1).snapshots,
    ).toHaveLength(1);
  });
});
