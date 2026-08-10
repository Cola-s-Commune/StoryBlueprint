import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId } from '../types/ids';
import type { AssetSource, CharacterSource } from '../types/source';
import type { RuntimeValue, ValueType, VariableDefinition } from '../types/values';
import { StoryFormatError } from './storyKdl';

export const STORY_CHARACTER_FORMAT = 'story-blueprint-character';
export const STORY_CHARACTER_VERSION = 1;
export const STORY_ASSET_FORMAT = 'story-blueprint-asset';
export const STORY_ASSET_VERSION = 1;

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StoryFormatError(`${path} must be a string`);
  return value;
}

function rootDocument(text: string, name: string): Node {
  let document: Document;
  try {
    document = parse(text);
  } catch (error) {
    throw new StoryFormatError(error instanceof Error ? error.message : String(error));
  }
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== name) {
    throw new StoryFormatError(`Document must contain exactly one ${name} node`);
  }
  return document.nodes[0];
}

function assertRoot(root: Node, formatName: string, version: number): void {
  if (root.getProperty('format') !== formatName || root.getProperty('version') !== version) {
    throw new StoryFormatError(
      `Unsupported resource ${String(root.getProperty('format'))}@${String(root.getProperty('version'))}`,
    );
  }
}

function assertShape(
  node: Node,
  path: string,
  argumentsCount: number,
  properties: readonly string[],
  children: readonly string[],
): void {
  if (node.getArguments().length !== argumentsCount) {
    throw new StoryFormatError(`${path} must have ${argumentsCount} argument(s)`);
  }
  const allowedProperties = new Set(properties);
  for (const property of node.getProperties().keys()) {
    if (!allowedProperties.has(property)) {
      throw new StoryFormatError(`${path} contains unsupported property ${property}`);
    }
  }
  const allowedChildren = new Set(children);
  for (const child of node.children?.nodes ?? []) {
    if (!allowedChildren.has(child.getName())) {
      throw new StoryFormatError(`${path} contains unsupported child ${child.getName()}`);
    }
  }
}

function scalarTypeName(valueType: ValueType): string {
  if (['boolean', 'number', 'string'].includes(valueType.kind)) return valueType.kind;
  throw new StoryFormatError(`Unsupported character field type ${valueType.kind}`);
}

function serializeCharacterField(field: VariableDefinition): Node {
  if (!isStableId(field.id, 'variable')) throw new StoryFormatError('Invalid character field ID');
  const node = Node.create('field');
  node.addArgument(field.id);
  node.setProperty('name', field.name);
  if (field.displayName !== field.name) node.setProperty('display-name', field.displayName);
  node.setProperty('type', scalarTypeName(field.valueType));
  if (
    field.defaultValue !== null &&
    typeof field.defaultValue !== 'boolean' &&
    typeof field.defaultValue !== 'number' &&
    typeof field.defaultValue !== 'string'
  ) {
    throw new StoryFormatError(`${field.id}.default must be a scalar`);
  }
  node.setProperty('default', field.defaultValue as null | boolean | number | string);
  return node;
}

function parseCharacterField(node: Node, characterId: string): VariableDefinition {
  assertShape(node, `${characterId}.field`, 1, ['name', 'display-name', 'type', 'default'], []);
  const id = stringValue(node.getArgument(0), `${characterId}.field.id`);
  if (!isStableId(id, 'variable')) throw new StoryFormatError(`${id} is not a valid field ID`);
  const name = stringValue(node.getProperty('name'), `${id}.name`);
  const type = stringValue(node.getProperty('type'), `${id}.type`);
  if (!['boolean', 'number', 'string'].includes(type)) {
    throw new StoryFormatError(`${id}.type is unsupported`);
  }
  const defaultValue = node.getProperty('default');
  if (typeof defaultValue !== type) throw new StoryFormatError(`${id}.default must be ${type}`);
  return {
    id,
    name,
    displayName: (node.getProperty('display-name') as string | undefined) ?? name,
    scope: 'character',
    valueType: { kind: type as 'boolean' | 'number' | 'string' },
    defaultValue: defaultValue as RuntimeValue,
  };
}

export function serializeCharacterResource(character: CharacterSource): string {
  if (!isStableId(character.id, 'character')) throw new StoryFormatError('Invalid character ID');
  const root = Node.create('character');
  root.addArgument(character.id);
  root.setProperty('format', STORY_CHARACTER_FORMAT);
  root.setProperty('version', STORY_CHARACTER_VERSION);
  root.setProperty('name', character.name);
  root.setProperty('display-name', character.displayName);
  if (character.description) root.setProperty('description', character.description);
  if (character.dialogueStyle) root.setProperty('dialogue-style', character.dialogueStyle);
  if (character.defaultPortraitId) root.setProperty('portrait', character.defaultPortraitId);
  for (const field of character.fields ?? []) root.appendNode(serializeCharacterField(field));
  for (const [key, emotion] of Object.entries(character.emotions).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const node = Node.create('emotion');
    node.addArgument(key);
    node.setProperty('display-name', emotion.displayName);
    if (emotion.portraitId) node.setProperty('portrait', emotion.portraitId);
    root.appendNode(node);
  }
  return format(new Document([root]));
}

export function parseCharacterResource(text: string): CharacterSource {
  const root = rootDocument(text, 'character');
  assertShape(
    root,
    'character',
    1,
    ['format', 'version', 'name', 'display-name', 'description', 'dialogue-style', 'portrait'],
    ['emotion', 'field'],
  );
  assertRoot(root, STORY_CHARACTER_FORMAT, STORY_CHARACTER_VERSION);
  const id = stringValue(root.getArgument(0), 'character.id');
  if (!isStableId(id, 'character')) throw new StoryFormatError('Invalid character ID');
  const emotionKeys = new Set<string>();
  const fieldIds = new Set<string>();
  const fieldNames = new Set<string>();
  const fields = root.findNodesByName('field').map((node) => {
    const field = parseCharacterField(node, id);
    if (fieldIds.has(field.id)) throw new StoryFormatError(`Duplicate field ID ${field.id}`);
    if (fieldNames.has(field.name))
      throw new StoryFormatError(`Duplicate field name ${field.name}`);
    fieldIds.add(field.id);
    fieldNames.add(field.name);
    return field;
  });
  const emotions = Object.fromEntries(
    root.findNodesByName('emotion').map((node) => {
      assertShape(node, `${id}.emotion`, 1, ['display-name', 'portrait'], []);
      const key = stringValue(node.getArgument(0), `${id}.emotion`);
      if (emotionKeys.has(key)) throw new StoryFormatError(`Duplicate emotion ${key}`);
      emotionKeys.add(key);
      const portrait = node.getProperty('portrait');
      if (
        portrait !== undefined &&
        (typeof portrait !== 'string' || !isStableId(portrait, 'asset'))
      ) {
        throw new StoryFormatError(`${id}.${key}.portrait is invalid`);
      }
      return [
        key,
        {
          displayName: stringValue(node.getProperty('display-name'), `${id}.${key}.display-name`),
          portraitId: portrait as CharacterSource['defaultPortraitId'],
        },
      ];
    }),
  );
  const portrait = root.getProperty('portrait');
  if (portrait !== undefined && (typeof portrait !== 'string' || !isStableId(portrait, 'asset'))) {
    throw new StoryFormatError(`${id}.portrait is invalid`);
  }
  const description = root.getProperty('description');
  if (description !== undefined && typeof description !== 'string') {
    throw new StoryFormatError(`${id}.description must be a string`);
  }
  const dialogueStyle = root.getProperty('dialogue-style');
  if (dialogueStyle !== undefined && typeof dialogueStyle !== 'string') {
    throw new StoryFormatError(`${id}.dialogue-style must be a string`);
  }
  return {
    id,
    name: stringValue(root.getProperty('name'), `${id}.name`),
    displayName: stringValue(root.getProperty('display-name'), `${id}.display-name`),
    description: description || undefined,
    dialogueStyle: dialogueStyle || undefined,
    defaultPortraitId: portrait as CharacterSource['defaultPortraitId'],
    emotions,
    fields,
  };
}

export function serializeAssetResource(asset: AssetSource): string {
  if (!isStableId(asset.id, 'asset')) throw new StoryFormatError('Invalid asset ID');
  const root = Node.create('asset');
  root.addArgument(asset.id);
  root.setProperty('format', STORY_ASSET_FORMAT);
  root.setProperty('version', STORY_ASSET_VERSION);
  root.setProperty('name', asset.name);
  root.setProperty('display-name', asset.displayName);
  root.setProperty('kind', asset.kind);
  for (const [locale, path] of Object.entries(asset.locales ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const node = Node.create('locale');
    node.addArgument(locale);
    node.addArgument(path);
    root.appendNode(node);
  }
  return format(new Document([root]));
}

export function parseAssetResource(text: string): AssetSource {
  const root = rootDocument(text, 'asset');
  assertShape(root, 'asset', 1, ['format', 'version', 'name', 'display-name', 'kind'], ['locale']);
  assertRoot(root, STORY_ASSET_FORMAT, STORY_ASSET_VERSION);
  const id = stringValue(root.getArgument(0), 'asset.id');
  if (!isStableId(id, 'asset')) throw new StoryFormatError('Invalid asset ID');
  const kind = stringValue(root.getProperty('kind'), `${id}.kind`);
  if (kind !== 'audio' && kind !== 'portrait' && kind !== 'other') {
    throw new StoryFormatError(`${id}.kind is unsupported`);
  }
  const localeNames = new Set<string>();
  const locales = Object.fromEntries(
    root.findNodesByName('locale').map((node) => {
      assertShape(node, `${id}.locale`, 2, [], []);
      const locale = stringValue(node.getArgument(0), `${id}.locale`);
      if (localeNames.has(locale)) throw new StoryFormatError(`Duplicate locale ${locale}`);
      localeNames.add(locale);
      return [locale, stringValue(node.getArgument(1), `${id}.locale.path`)];
    }),
  );
  return {
    id,
    name: stringValue(root.getProperty('name'), `${id}.name`),
    displayName: stringValue(root.getProperty('display-name'), `${id}.display-name`),
    kind,
    locales,
  };
}
