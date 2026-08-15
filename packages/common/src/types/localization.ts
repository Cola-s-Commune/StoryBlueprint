import type { StoryId, TextId } from './ids';

export const STORY_LOCALIZATION_FORMAT = 'story-blueprint-localization' as const;
export const STORY_LOCALIZATION_VERSION = 1 as const;

export interface LocalizationSourceEntry {
  storyId: StoryId;
  textId: TextId;
  source: string;
  storyName: string;
  graphName: string;
  context: string;
}

export interface LocalizationTranslationEntry {
  storyId: StoryId;
  textId: TextId;
  text: string;
}

export interface LocalizationLocale {
  locale: string;
  fallback?: string;
  translations: readonly LocalizationTranslationEntry[];
}

export interface StoryLocalizationDocument {
  format: typeof STORY_LOCALIZATION_FORMAT;
  version: typeof STORY_LOCALIZATION_VERSION;
  sourceLocale: string;
  sources: readonly LocalizationSourceEntry[];
  locales: readonly LocalizationLocale[];
}
