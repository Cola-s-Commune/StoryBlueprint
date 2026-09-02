import { Document, Node, format, parse } from '@bgotink/kdl';
import type { CharacterTemplateSource } from '../types/characterTemplate';
import { runtimeValueMatchesType, type RuntimeValue, type ValueType } from '../types/values';
import { StoryFormatError } from './storyKdl';

export const STORY_CHARACTER_TEMPLATE_FORMAT = 'story-blueprint-character-template';
export const STORY_CHARACTER_TEMPLATE_VERSION = 1;

function scalarType(value: unknown, path: string, nullable = false): ValueType {
  if (
    value !== 'boolean' &&
    value !== 'number' &&
    value !== 'string' &&
    value !== 'character-ref' &&
    value !== 'asset-ref'
  ) {
    throw new StoryFormatError(
      `${path} must be boolean, number, string, character-ref, or asset-ref`,
    );
  }
  return { kind: value, ...(nullable ? { nullable: true } : {}) };
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StoryFormatError(`${path} must be a non-empty string`);
  }
  return value;
}

export function serializeCharacterTemplate(template: CharacterTemplateSource): string {
  const root = Node.create('character-template');
  root.setProperty('format', STORY_CHARACTER_TEMPLATE_FORMAT);
  root.setProperty('version', STORY_CHARACTER_TEMPLATE_VERSION);
  root.setProperty('name', requiredString(template.name, 'template.name'));
  root.setProperty('display-name', requiredString(template.displayName, 'template.displayName'));
  if (template.description) root.setProperty('description', template.description);
  if (template.dialogueStyle) root.setProperty('dialogue-style', template.dialogueStyle);
  for (const tag of [...new Set(template.tags ?? [])].sort()) {
    const node = Node.create('tag');
    node.addArgument(requiredString(tag, 'template.tag'));
    root.appendNode(node);
  }
  for (const [key, value] of Object.entries(template.metadata ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const node = Node.create('meta');
    node.addArgument(requiredString(key, 'template.metadata.key'));
    node.addArgument(value);
    root.appendNode(node);
  }
  for (const field of template.fields ?? []) {
    const node = Node.create('field');
    node.addArgument(requiredString(field.name, 'template.field.name'));
    node.setProperty(
      'display-name',
      requiredString(field.displayName, 'template.field.displayName'),
    );
    node.setProperty('type', field.valueType.kind);
    if (field.valueType.nullable) node.setProperty('nullable', true);
    node.setProperty('default', field.defaultValue as null | boolean | number | string);
    root.appendNode(node);
  }
  for (const [key, emotion] of Object.entries(template.emotions).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const node = Node.create('emotion');
    node.addArgument(requiredString(key, 'template.emotion.key'));
    node.setProperty('display-name', requiredString(emotion.displayName, 'template.emotion.name'));
    root.appendNode(node);
  }
  return format(new Document([root]));
}

export function parseCharacterTemplate(text: string): CharacterTemplateSource {
  let document: Document;
  try {
    document = parse(text);
  } catch (error) {
    throw new StoryFormatError(error instanceof Error ? error.message : String(error));
  }
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== 'character-template') {
    throw new StoryFormatError('Document must contain exactly one character-template node');
  }
  const root = document.nodes[0]!;
  if (
    root.getProperty('format') !== STORY_CHARACTER_TEMPLATE_FORMAT ||
    root.getProperty('version') !== STORY_CHARACTER_TEMPLATE_VERSION
  ) {
    throw new StoryFormatError('Unsupported character template format');
  }
  const tags = root
    .findNodesByName('tag')
    .map((node) => requiredString(node.getArgument(0), 'tag'));
  const metadata = Object.fromEntries(
    root.findNodesByName('meta').map((node) => {
      const key = requiredString(node.getArgument(0), 'metadata.key');
      const value = node.getArgument(1);
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new StoryFormatError(`${key} metadata must be scalar`);
      }
      return [key, value];
    }),
  );
  const fields = root.findNodesByName('field').map((node) => {
    const name = requiredString(node.getArgument(0), 'field.name');
    const nullable = node.getProperty('nullable');
    if (nullable !== undefined && typeof nullable !== 'boolean') {
      throw new StoryFormatError(`${name}.nullable must be a boolean`);
    }
    const valueType = scalarType(node.getProperty('type'), `${name}.type`, nullable === true);
    const defaultValue = node.getProperty('default');
    if (!runtimeValueMatchesType(defaultValue as RuntimeValue, valueType)) {
      throw new StoryFormatError(`${name}.default must be ${valueType.kind}`);
    }
    return {
      name,
      displayName: requiredString(node.getProperty('display-name'), `${name}.displayName`),
      valueType,
      defaultValue: defaultValue as RuntimeValue,
    };
  });
  const emotions = Object.fromEntries(
    root.findNodesByName('emotion').map((node) => {
      const key = requiredString(node.getArgument(0), 'emotion.key');
      return [
        key,
        { displayName: requiredString(node.getProperty('display-name'), `${key}.displayName`) },
      ];
    }),
  );
  const optional = (name: string) => {
    const value = root.getProperty(name);
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new StoryFormatError(`${name} must be a string`);
    return value || undefined;
  };
  return {
    name: requiredString(root.getProperty('name'), 'template.name'),
    displayName: requiredString(root.getProperty('display-name'), 'template.displayName'),
    description: optional('description'),
    dialogueStyle: optional('dialogue-style'),
    ...(tags.length ? { tags } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    emotions,
    ...(fields.length ? { fields } : {}),
  };
}
