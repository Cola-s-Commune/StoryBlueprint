import type { ExternalWorkspaceFileChange } from '../../shared/electronApi';

export interface ExternalFileChangeFacts {
  change: ExternalWorkspaceFileChange;
  matchesEditorContent: boolean;
  openedStory: boolean;
  storyDirty: boolean;
  projectResourcesDirty: boolean;
}

export type ExternalFileChangeAction = 'ignore' | 'reload-story' | 'refresh-workspace' | 'review';

export function planExternalFileChange(facts: ExternalFileChangeFacts): ExternalFileChangeAction {
  if (facts.matchesEditorContent) return 'ignore';
  if (facts.change.kind !== 'story') {
    return facts.projectResourcesDirty || facts.change.change === 'deleted'
      ? 'review'
      : 'refresh-workspace';
  }
  if (!facts.openedStory) return 'refresh-workspace';
  if (facts.storyDirty || facts.change.change === 'deleted' || !facts.change.content) {
    return 'review';
  }
  return 'reload-story';
}
