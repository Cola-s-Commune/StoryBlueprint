import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId } from '../types/ids';
import {
  STORY_LOCALIZATION_FORMAT,
  STORY_LOCALIZATION_VERSION,
  type StoryLocalizationDocument,
} from '../types/localization';
import { StoryFormatError } from './storyKdl';

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StoryFormatError(`${path} must be a string`);
  return value;
}

function assertLocaleName(value: string, path: string): string {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)) {
    throw new StoryFormatError(`${path} must be a locale such as en or zh-CN`);
  }
  return value;
}

export function serializeStoryLocalization(document: StoryLocalizationDocument): string {
  if (
    document.format !== STORY_LOCALIZATION_FORMAT ||
    document.version !== STORY_LOCALIZATION_VERSION
  ) {
    throw new StoryFormatError('Unsupported Story Localization format or version');
  }
  assertLocaleName(document.sourceLocale, 'localization.source-locale');
  const root = Node.create('localization');
  root.setProperty('format', document.format);
  root.setProperty('version', document.version);
  root.setProperty('source-locale', document.sourceLocale);
  const sourceKeys = new Set<string>();
  for (const source of document.sources) {
    const key = `${source.storyId}\0${source.textId}`;
    if (sourceKeys.has(key)) {
      throw new StoryFormatError(
        `Duplicate localization source ${source.storyId} / ${source.textId}`,
      );
    }
    sourceKeys.add(key);
    const node = Node.create('source');
    node.addArgument(source.storyId);
    node.addArgument(source.textId);
    node.addArgument(source.source);
    node.setProperty('story', source.storyName);
    node.setProperty('graph', source.graphName);
    node.setProperty('context', source.context);
    root.appendNode(node);
  }
  const localeNames = new Set<string>();
  for (const locale of [...document.locales].sort((a, b) => a.locale.localeCompare(b.locale))) {
    assertLocaleName(locale.locale, 'localization.locale');
    if (locale.locale === document.sourceLocale) {
      throw new StoryFormatError('Source locale must not also be a translation locale');
    }
    if (localeNames.has(locale.locale))
      throw new StoryFormatError(`Duplicate locale ${locale.locale}`);
    localeNames.add(locale.locale);
    const node = Node.create('locale');
    node.addArgument(locale.locale);
    if (locale.fallback)
      node.setProperty('fallback', assertLocaleName(locale.fallback, `${locale.locale}.fallback`));
    const translated = new Set<string>();
    for (const entry of [...locale.translations].sort(
      (a, b) => a.storyId.localeCompare(b.storyId) || a.textId.localeCompare(b.textId),
    )) {
      const key = `${entry.storyId}\0${entry.textId}`;
      if (!sourceKeys.has(key))
        throw new StoryFormatError(`Translation references missing source ${key}`);
      if (translated.has(key)) throw new StoryFormatError(`Duplicate translation ${key}`);
      translated.add(key);
      const translation = Node.create('text');
      translation.addArgument(entry.storyId);
      translation.addArgument(entry.textId);
      translation.addArgument(entry.text);
      node.appendNode(translation);
    }
    root.appendNode(node);
  }
  for (const locale of document.locales) {
    if (
      locale.fallback &&
      locale.fallback !== document.sourceLocale &&
      !localeNames.has(locale.fallback)
    ) {
      throw new StoryFormatError(`Locale ${locale.locale} has missing fallback ${locale.fallback}`);
    }
    const visited = new Set<string>([locale.locale]);
    let fallback = locale.fallback;
    while (fallback && fallback !== document.sourceLocale) {
      if (visited.has(fallback)) {
        throw new StoryFormatError(`Locale ${locale.locale} has a fallback cycle`);
      }
      visited.add(fallback);
      fallback = document.locales.find((candidate) => candidate.locale === fallback)?.fallback;
    }
  }
  return format(new Document([root]));
}

export function parseStoryLocalization(content: string): StoryLocalizationDocument {
  let document: Document;
  try {
    document = parse(content);
  } catch (error) {
    throw new StoryFormatError(error instanceof Error ? error.message : String(error));
  }
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== 'localization') {
    throw new StoryFormatError('Document must contain one localization node');
  }
  const root = document.nodes[0]!;
  const formatName = text(root.getProperty('format'), 'localization.format');
  const version = root.getProperty('version');
  if (formatName !== STORY_LOCALIZATION_FORMAT || version !== STORY_LOCALIZATION_VERSION) {
    throw new StoryFormatError(`Unsupported Story Localization ${formatName}@${String(version)}`);
  }
  const sourceLocale = assertLocaleName(
    text(root.getProperty('source-locale'), 'localization.source-locale'),
    'localization.source-locale',
  );
  const sources = root.findNodesByName('source').map((node, index) => {
    const storyId = text(node.getArgument(0), `source[${index}].story-id`);
    const textId = text(node.getArgument(1), `source[${index}].text-id`);
    if (!isStableId(storyId, 'story') || !isStableId(textId, 'text')) {
      throw new StoryFormatError(`source[${index}] contains an invalid stable ID`);
    }
    return {
      storyId,
      textId,
      source: text(node.getArgument(2), `source[${index}].source`),
      storyName: text(node.getProperty('story'), `source[${index}].story`),
      graphName: text(node.getProperty('graph'), `source[${index}].graph`),
      context: text(node.getProperty('context'), `source[${index}].context`),
    };
  });
  const locales = root.findNodesByName('locale').map((node, localeIndex) => ({
    locale: assertLocaleName(
      text(node.getArgument(0), `locale[${localeIndex}]`),
      `locale[${localeIndex}]`,
    ),
    fallback: node.getProperty('fallback')
      ? assertLocaleName(
          text(node.getProperty('fallback'), `locale[${localeIndex}].fallback`),
          `locale[${localeIndex}].fallback`,
        )
      : undefined,
    translations: node.findNodesByName('text').map((entry, textIndex) => {
      const storyId = text(
        entry.getArgument(0),
        `locale[${localeIndex}].text[${textIndex}].story-id`,
      );
      const textId = text(
        entry.getArgument(1),
        `locale[${localeIndex}].text[${textIndex}].text-id`,
      );
      if (!isStableId(storyId, 'story') || !isStableId(textId, 'text')) {
        throw new StoryFormatError(
          `locale[${localeIndex}].text[${textIndex}] contains an invalid stable ID`,
        );
      }
      return {
        storyId,
        textId,
        text: text(entry.getArgument(2), `locale[${localeIndex}].text[${textIndex}].value`),
      };
    }),
  }));
  const result: StoryLocalizationDocument = {
    format: STORY_LOCALIZATION_FORMAT,
    version: STORY_LOCALIZATION_VERSION,
    sourceLocale,
    sources,
    locales,
  };
  serializeStoryLocalization(result);
  return result;
}
