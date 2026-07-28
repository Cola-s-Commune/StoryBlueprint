import type { ProjectId, StoryId } from './ids';
import type { AssetSource, CharacterSource, EventSource, SignalSource } from './source';
import type { RuntimeProgram } from './runtimeProgram';

export const STORY_COMPILED_PROJECT_FORMAT = 'story-blueprint-compiled-project';
export const STORY_COMPILED_PROJECT_VERSION = 1;

export interface CompiledStoryProgram {
  storyId: StoryId;
  name: string;
  displayName: string;
  program: RuntimeProgram;
  characters: readonly CharacterSource[];
  assets: readonly AssetSource[];
}

/** Node-free project artifact consumed by engine adapters. */
export interface CompiledStoryProject {
  format: typeof STORY_COMPILED_PROJECT_FORMAT;
  version: typeof STORY_COMPILED_PROJECT_VERSION;
  projectId: ProjectId;
  name: string;
  displayName: string;
  contentVersion: string;
  entryStoryId: StoryId;
  /** Project-level engine interface manifest used to implement adapter handlers. */
  events: readonly EventSource[];
  signals: readonly SignalSource[];
  stories: Readonly<Record<string, CompiledStoryProgram>>;
}
