import {
  StoryNodeType,
  type ChoiceNodeData,
  type DialogueNodeData,
  type NarrationNodeData,
} from '../types/nodes';
import type { NodeId, OptionId, StoryId, TextId } from '../types/ids';
import type { LocalizationSourceEntry, StoryLocalizationDocument } from '../types/localization';
import type { SourceGraph, StorySourceDocument } from '../types/source';
import { StoryFormatError } from '../serialization/storyKdl';

function suffix(id: string): string {
  return id.slice(id.indexOf('_') + 1);
}

export function choicePromptTextId(nodeId: NodeId): TextId {
  return `t_choice_prompt_${suffix(nodeId)}` as TextId;
}

export function choiceOptionTextId(optionId: OptionId): TextId {
  return `t_choice_option_${suffix(optionId)}` as TextId;
}

function graphSources(
  story: StorySourceDocument,
  graph: SourceGraph,
  graphName: string,
): LocalizationSourceEntry[] {
  return graph.nodes.flatMap((node) => {
    if (node.type === StoryNodeType.Dialogue) {
      const data = node.data as unknown as DialogueNodeData;
      return data.lines.map((line, index) => ({
        storyId: story.id,
        textId: line.textId,
        source: line.text.source,
        storyName: story.displayName,
        graphName,
        context: `${node.name ?? 'Dialogue'} · Line ${index + 1}`,
      }));
    }
    if (node.type === StoryNodeType.Narration) {
      const narration = node.data as unknown as NarrationNodeData;
      return [
        {
          storyId: story.id,
          textId: narration.textId,
          source: narration.text.source,
          storyName: story.displayName,
          graphName,
          context: `${node.name ?? 'Narration'} · Text`,
        },
      ];
    }
    if (node.type === StoryNodeType.Choice) {
      const data = node.data as unknown as ChoiceNodeData;
      return [
        ...(data.prompt.source
          ? [
              {
                storyId: story.id,
                textId: choicePromptTextId(node.id),
                source: data.prompt.source,
                storyName: story.displayName,
                graphName,
                context: `${node.name ?? 'Choice'} · Prompt`,
              },
            ]
          : []),
        ...data.options.map((option, index) => ({
          storyId: story.id,
          textId: choiceOptionTextId(option.id),
          source: option.text.source,
          storyName: story.displayName,
          graphName,
          context: `${node.name ?? 'Choice'} · Option ${index + 1}`,
        })),
      ];
    }
    return [];
  });
}

export function extractLocalizationSources(
  stories: readonly StorySourceDocument[],
): LocalizationSourceEntry[] {
  const extracted = stories.flatMap((story) => [
    ...graphSources(story, story.root, 'Main Story'),
    ...story.chapters.flatMap((chapter) => graphSources(story, chapter.graph, chapter.displayName)),
  ]);
  const unique = new Map<string, LocalizationSourceEntry>();
  for (const entry of extracted) {
    const key = `${entry.storyId}\0${entry.textId}`;
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, entry);
      continue;
    }
    // A text ID is the localization identity. Reusing it intentionally means
    // both occurrences share one translation, so emit one table row.
    if (previous.source !== entry.source) {
      throw new StoryFormatError(
        `Localization text ${entry.storyId} / ${entry.textId} has conflicting source text`,
      );
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.storyName.localeCompare(right.storyName) ||
      left.graphName.localeCompare(right.graphName) ||
      left.context.localeCompare(right.context) ||
      left.textId.localeCompare(right.textId),
  );
}

export function mergeLocalizationSources(
  document: StoryLocalizationDocument | undefined,
  stories: readonly StorySourceDocument[],
  sourceLocale = 'en',
): StoryLocalizationDocument {
  const sources = extractLocalizationSources(stories);
  const validKeys = new Set(sources.map((entry) => `${entry.storyId}\0${entry.textId}`));
  return {
    format: 'story-blueprint-localization',
    version: 1,
    sourceLocale: document?.sourceLocale ?? sourceLocale,
    sources,
    locales: (document?.locales ?? []).map((locale) => ({
      ...locale,
      translations: locale.translations.filter((entry) =>
        validKeys.has(`${entry.storyId}\0${entry.textId}`),
      ),
    })),
  };
}

export function localizationTranslationsForStory(
  document: StoryLocalizationDocument | undefined,
  storyId: StoryId,
): Record<string, Record<TextId, string>> {
  return Object.fromEntries(
    (document?.locales ?? []).map((locale) => [
      locale.locale,
      Object.fromEntries(
        locale.translations
          .filter((entry) => entry.storyId === storyId)
          .map((entry) => [entry.textId, entry.text]),
      ),
    ]),
  );
}
