import { describe, expect, it } from 'vitest';
import type { ExternalWorkspaceFileChange } from '../packages/editor/src/shared/electronApi';
import { planExternalFileChange } from '../packages/editor/src/renderer/graph/externalFileChangePlan';

const modifiedStory: ExternalWorkspaceFileChange = {
  relativePath: 'main.story',
  kind: 'story',
  change: 'modified',
  previousContent: 'before',
  content: 'after',
};

function plan(overrides: Partial<Parameters<typeof planExternalFileChange>[0]> = {}) {
  return planExternalFileChange({
    change: modifiedStory,
    matchesEditorContent: false,
    openedStory: true,
    storyDirty: false,
    projectResourcesDirty: false,
    ...overrides,
  });
}

describe('external file change plan', () => {
  it('ignores editor self-saves', () => {
    expect(plan({ matchesEditorContent: true })).toBe('ignore');
  });

  it('reloads clean opened stories but reviews dirty stories', () => {
    expect(plan()).toBe('reload-story');
    expect(plan({ storyDirty: true })).toBe('review');
  });

  it('reviews delete and recreate races for an opened dirty story', () => {
    expect(plan({ change: { ...modifiedStory, change: 'deleted', content: undefined } })).toBe(
      'review',
    );
    expect(
      plan({
        change: { ...modifiedStory, change: 'created', previousContent: undefined },
        storyDirty: true,
      }),
    ).toBe('review');
  });

  it('refreshes unopened stories without changing the active story', () => {
    expect(plan({ openedStory: false })).toBe('refresh-workspace');
  });

  it('refreshes clean resources and reviews dirty or deleted resources', () => {
    const resource: ExternalWorkspaceFileChange = {
      relativePath: 'characters/hero.character',
      kind: 'character',
      change: 'modified',
      previousContent: 'before',
      content: 'after',
    };
    expect(plan({ change: resource, openedStory: false })).toBe('refresh-workspace');
    expect(plan({ change: resource, openedStory: false, projectResourcesDirty: true })).toBe(
      'review',
    );
    expect(
      plan({ change: { ...resource, change: 'deleted', content: undefined }, openedStory: false }),
    ).toBe('review');
  });
});
