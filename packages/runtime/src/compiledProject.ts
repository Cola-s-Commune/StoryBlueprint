import {
  STORY_COMPILED_PROJECT_FORMAT,
  STORY_COMPILED_PROJECT_VERSION,
  type CompiledStoryProject,
  type StoryId,
} from '@story-blueprint/common';
import { StoryRuntime } from './storyRuntime';
import type { RuntimeState } from './types';

export function parseCompiledStoryProject(content: string): CompiledStoryProject {
  const value: unknown = JSON.parse(content);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Compiled Story project must be an object');
  }
  const project = value as Partial<CompiledStoryProject>;
  if (
    project.format !== STORY_COMPILED_PROJECT_FORMAT ||
    project.version !== STORY_COMPILED_PROJECT_VERSION
  ) {
    throw new Error(`Unsupported compiled Story project ${project.format}@${project.version}`);
  }
  if (
    typeof project.entryStoryId !== 'string' ||
    typeof project.stories !== 'object' ||
    project.stories === null ||
    !project.stories[project.entryStoryId]
  ) {
    throw new Error('Compiled Story project has no valid entry Story');
  }
  for (const [storyId, story] of Object.entries(project.stories)) {
    if (!story || story.storyId !== storyId || !story.program) {
      throw new Error(`Invalid compiled Story entry ${storyId}`);
    }
    if (story.program.contentVersion !== project.contentVersion) {
      throw new Error(`Story ${storyId} content version does not match its project`);
    }
  }
  return project as CompiledStoryProject;
}

export function createRuntimeFromCompiledProject(
  project: CompiledStoryProject,
  storyId: StoryId = project.entryStoryId,
  restoredState?: RuntimeState,
): StoryRuntime {
  const story = project.stories[storyId];
  if (!story) throw new Error(`Compiled Story does not exist: ${storyId}`);
  return new StoryRuntime(story.program, restoredState);
}
