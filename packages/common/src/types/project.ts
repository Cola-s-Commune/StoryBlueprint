import type { AssetId, CharacterId, ProjectId, StoryId } from './ids';
import type { EventSource, SignalSource } from './source';
import type { VariableDefinition } from './values';

export const STORY_PROJECT_FORMAT = 'story-blueprint-project';
export const STORY_PROJECT_VERSION = 1;

export interface ProjectStoryReference {
  id: StoryId;
  path: string;
  name: string;
  displayName: string;
}

export interface ProjectCharacterReference {
  id: CharacterId;
  name: string;
  displayName: string;
  path?: string;
  storyIds: readonly StoryId[];
}

export interface ProjectAssetReference {
  id: AssetId;
  name: string;
  displayName: string;
  kind: 'audio' | 'portrait' | 'other';
  path?: string;
  locales: Readonly<Record<string, string>>;
  storyIds: readonly StoryId[];
}

export interface StoryProjectDocument {
  format: typeof STORY_PROJECT_FORMAT;
  version: typeof STORY_PROJECT_VERSION;
  id: ProjectId;
  name: string;
  displayName: string;
  entryStoryId?: StoryId;
  outputDirectory?: string;
  stories: readonly ProjectStoryReference[];
  characters: readonly ProjectCharacterReference[];
  assets: readonly ProjectAssetReference[];
  variables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
}
