import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId, type StableId, type StableIdKind } from '../types/ids';
import {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type ProjectAssetReference,
  type ProjectCharacterReference,
  type ProjectStoryReference,
  type StoryProjectDocument,
} from '../types/project';
import { StoryFormatError } from './storyKdl';

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StoryFormatError(`${path} must be a string`);
  return value;
}

function requiredInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new StoryFormatError(`${path} must be an integer`);
  }
  return value;
}

function requiredId<Kind extends StableIdKind>(
  value: unknown,
  kind: Kind,
  path: string,
): StableId<Kind> {
  const id = requiredString(value, path);
  if (!isStableId(id, kind)) throw new StoryFormatError(`${path} is not a valid ${kind} ID`);
  return id as StableId<Kind>;
}

function assertArguments(node: Node, path: string, count: number): void {
  if (node.getArguments().length !== count) {
    throw new StoryFormatError(`${path} must have ${count} argument(s)`);
  }
}

function assertProperties(node: Node, path: string, allowed: readonly string[]): void {
  const properties = new Set(allowed);
  for (const property of node.getProperties().keys()) {
    if (!properties.has(property)) {
      throw new StoryFormatError(`${path} contains unsupported property ${property}`);
    }
  }
}

function assertChildren(node: Node, path: string, allowed: readonly string[]): void {
  const names = new Set(allowed);
  for (const child of node.children?.nodes ?? []) {
    if (!names.has(child.getName())) {
      throw new StoryFormatError(`${path} contains unsupported child ${child.getName()}`);
    }
  }
}

function validateProject(project: StoryProjectDocument): void {
  if (!isStableId(project.id, 'project')) throw new StoryFormatError('Invalid project ID');
  const storyIds = new Set<string>();
  const storyPaths = new Set<string>();
  for (const story of project.stories) {
    if (!isStableId(story.id, 'story')) throw new StoryFormatError(`Invalid story ID ${story.id}`);
    if (
      !story.path.toLowerCase().endsWith('.story') ||
      story.path.startsWith('/') ||
      /^[a-z]:[\\/]/i.test(story.path) ||
      story.path.split(/[\\/]/).includes('..')
    ) {
      throw new StoryFormatError(`Invalid project story path ${story.path}`);
    }
    if (storyIds.has(story.id)) throw new StoryFormatError(`Duplicate story ID ${story.id}`);
    if (storyPaths.has(story.path))
      throw new StoryFormatError(`Duplicate story path ${story.path}`);
    storyIds.add(story.id);
    storyPaths.add(story.path);
  }
  if (project.entryStoryId && !storyIds.has(project.entryStoryId)) {
    throw new StoryFormatError(`Project entry Story does not exist: ${project.entryStoryId}`);
  }
  if (
    project.outputDirectory !== undefined &&
    (project.outputDirectory.length === 0 ||
      project.outputDirectory.startsWith('/') ||
      /^[a-z]:[\\/]/i.test(project.outputDirectory) ||
      project.outputDirectory.split(/[\\/]/).includes('..'))
  ) {
    throw new StoryFormatError(`Invalid project output directory ${project.outputDirectory}`);
  }
  const characterIds = new Set<string>();
  const characterNames = new Set<string>();
  const resourcePaths = new Set<string>();
  for (const character of project.characters) {
    if (!isStableId(character.id, 'character')) {
      throw new StoryFormatError(`Invalid character ID ${character.id}`);
    }
    if (characterIds.has(character.id)) {
      throw new StoryFormatError(`Duplicate character ID ${character.id}`);
    }
    characterIds.add(character.id);
    if (characterNames.has(character.name)) {
      throw new StoryFormatError(`Duplicate character name ${character.name}`);
    }
    characterNames.add(character.name);
    if (character.path) {
      if (
        !character.path.toLowerCase().endsWith('.character') ||
        character.path.startsWith('/') ||
        /^[a-z]:[\\/]/i.test(character.path) ||
        character.path.split(/[\\/]/).includes('..') ||
        resourcePaths.has(character.path)
      ) {
        throw new StoryFormatError(`Invalid project character path ${character.path}`);
      }
      resourcePaths.add(character.path);
    }
    for (const storyId of character.storyIds) {
      if (!storyIds.has(storyId)) {
        throw new StoryFormatError(`Character ${character.id} references missing story ${storyId}`);
      }
    }
  }
  const assetIds = new Set<string>();
  const assetNames = new Set<string>();
  for (const asset of project.assets) {
    if (!isStableId(asset.id, 'asset')) throw new StoryFormatError(`Invalid asset ID ${asset.id}`);
    if (assetIds.has(asset.id)) throw new StoryFormatError(`Duplicate asset ID ${asset.id}`);
    assetIds.add(asset.id);
    if (assetNames.has(asset.name)) throw new StoryFormatError(`Duplicate asset name ${asset.name}`);
    assetNames.add(asset.name);
    if (asset.path) {
      if (
        !asset.path.toLowerCase().endsWith('.asset') ||
        asset.path.startsWith('/') ||
        /^[a-z]:[\\/]/i.test(asset.path) ||
        asset.path.split(/[\\/]/).includes('..') ||
        resourcePaths.has(asset.path)
      ) {
        throw new StoryFormatError(`Invalid project asset path ${asset.path}`);
      }
      resourcePaths.add(asset.path);
    }
    for (const storyId of asset.storyIds) {
      if (!storyIds.has(storyId)) {
        throw new StoryFormatError(`Asset ${asset.id} references missing story ${storyId}`);
      }
    }
  }
}

function appendUsage(target: Node, storyIds: readonly string[]): void {
  for (const storyId of [...new Set(storyIds)].sort()) {
    const usage = Node.create('used-by');
    usage.addArgument(storyId);
    target.appendNode(usage);
  }
}

export function serializeStoryProject(project: StoryProjectDocument): string {
  if (project.format !== STORY_PROJECT_FORMAT || project.version !== STORY_PROJECT_VERSION) {
    throw new StoryFormatError('Unsupported Story Project format or version');
  }
  validateProject(project);
  const root = Node.create('project');
  root.addArgument(project.id);
  root.setProperty('format', project.format);
  root.setProperty('version', project.version);
  root.setProperty('name', project.name);
  if (project.displayName !== project.name) root.setProperty('display-name', project.displayName);
  if (project.entryStoryId) root.setProperty('entry-story', project.entryStoryId);
  if (project.outputDirectory) root.setProperty('output-directory', project.outputDirectory);

  const stories = Node.create('stories');
  for (const story of [...project.stories].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const node = Node.create('story');
    node.addArgument(story.id);
    node.setProperty('path', story.path);
    node.setProperty('name', story.name);
    if (story.displayName !== story.name) node.setProperty('display-name', story.displayName);
    stories.appendNode(node);
  }
  root.appendNode(stories);

  if (project.characters.length > 0) {
    const characters = Node.create('characters');
    for (const character of [...project.characters].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const node = Node.create('character');
      node.addArgument(character.id);
      node.setProperty('name', character.name);
      node.setProperty('display-name', character.displayName);
      if (character.path) node.setProperty('path', character.path);
      appendUsage(node, character.storyIds);
      characters.appendNode(node);
    }
    root.appendNode(characters);
  }

  if (project.assets.length > 0) {
    const assets = Node.create('assets');
    for (const asset of [...project.assets].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const node = Node.create('asset');
      node.addArgument(asset.id);
      node.setProperty('name', asset.name);
      node.setProperty('display-name', asset.displayName);
      node.setProperty('kind', asset.kind);
      if (asset.path) node.setProperty('path', asset.path);
      for (const [locale, path] of Object.entries(asset.locales).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const localeNode = Node.create('locale');
        localeNode.addArgument(locale);
        localeNode.addArgument(path);
        node.appendNode(localeNode);
      }
      appendUsage(node, asset.storyIds);
      assets.appendNode(node);
    }
    root.appendNode(assets);
  }
  return format(new Document([root]));
}

function parseUsage(node: Node, path: string) {
  return node.findNodesByName('used-by').map((usage, index) => {
    const usagePath = `${path}.used-by[${index}]`;
    assertArguments(usage, usagePath, 1);
    assertProperties(usage, usagePath, []);
    assertChildren(usage, usagePath, []);
    return requiredId(usage.getArgument(0), 'story', usagePath);
  });
}

export function parseStoryProject(text: string): StoryProjectDocument {
  let document: Document;
  try {
    document = parse(text);
  } catch (error) {
    throw new StoryFormatError(error instanceof Error ? error.message : String(error));
  }
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== 'project') {
    throw new StoryFormatError('Document must contain exactly one project node');
  }
  const root = document.nodes[0];
  assertArguments(root, 'project', 1);
  assertProperties(root, 'project', [
    'format',
    'version',
    'name',
    'display-name',
    'entry-story',
    'output-directory',
  ]);
  assertChildren(root, 'project', ['stories', 'characters', 'assets']);
  for (const section of ['stories', 'characters', 'assets']) {
    if (root.findNodesByName(section).length > 1) {
      throw new StoryFormatError(`Project may contain at most one ${section} section`);
    }
  }
  const formatName = requiredString(root.getProperty('format'), 'project.format');
  const version = requiredInteger(root.getProperty('version'), 'project.version');
  if (formatName !== STORY_PROJECT_FORMAT || version !== STORY_PROJECT_VERSION) {
    throw new StoryFormatError(
      `Unsupported Story Project format or version: ${formatName}@${version}`,
    );
  }
  const name = requiredString(root.getProperty('name'), 'project.name');

  const storiesContainer = root.findNodeByName('stories');
  if (storiesContainer) {
    assertArguments(storiesContainer, 'stories', 0);
    assertProperties(storiesContainer, 'stories', []);
    assertChildren(storiesContainer, 'stories', ['story']);
  }
  const stories: ProjectStoryReference[] = (storiesContainer?.findNodesByName('story') ?? []).map(
    (node, index) => {
      const path = `stories[${index}]`;
      assertArguments(node, path, 1);
      assertProperties(node, path, ['path', 'name', 'display-name']);
      assertChildren(node, path, []);
      const storyName = requiredString(node.getProperty('name'), `${path}.name`);
      return {
        id: requiredId(node.getArgument(0), 'story', `${path}.id`),
        path: requiredString(node.getProperty('path'), `${path}.path`),
        name: storyName,
        displayName: (node.getProperty('display-name') as string | undefined) ?? storyName,
      };
    },
  );

  const charactersContainer = root.findNodeByName('characters');
  if (charactersContainer) {
    assertArguments(charactersContainer, 'characters', 0);
    assertProperties(charactersContainer, 'characters', []);
    assertChildren(charactersContainer, 'characters', ['character']);
  }
  const characters: ProjectCharacterReference[] = (
    charactersContainer?.findNodesByName('character') ?? []
  ).map((node, index) => {
    const path = `characters[${index}]`;
    assertArguments(node, path, 1);
    assertProperties(node, path, ['name', 'display-name', 'path']);
    assertChildren(node, path, ['used-by']);
    return {
      id: requiredId(node.getArgument(0), 'character', `${path}.id`),
      name: requiredString(node.getProperty('name'), `${path}.name`),
      displayName: requiredString(node.getProperty('display-name'), `${path}.display-name`),
      path:
        node.getProperty('path') === undefined
          ? undefined
          : requiredString(node.getProperty('path'), `${path}.path`),
      storyIds: parseUsage(node, path),
    };
  });

  const assetsContainer = root.findNodeByName('assets');
  if (assetsContainer) {
    assertArguments(assetsContainer, 'assets', 0);
    assertProperties(assetsContainer, 'assets', []);
    assertChildren(assetsContainer, 'assets', ['asset']);
  }
  const assets: ProjectAssetReference[] = (assetsContainer?.findNodesByName('asset') ?? []).map(
    (node, index) => {
      const path = `assets[${index}]`;
      assertArguments(node, path, 1);
      assertProperties(node, path, ['name', 'display-name', 'kind', 'path']);
      assertChildren(node, path, ['locale', 'used-by']);
      const kind = requiredString(node.getProperty('kind'), `${path}.kind`);
      if (!['audio', 'portrait', 'other'].includes(kind)) {
        throw new StoryFormatError(`${path}.kind is invalid`);
      }
      return {
        id: requiredId(node.getArgument(0), 'asset', `${path}.id`),
        name: requiredString(node.getProperty('name'), `${path}.name`),
        displayName: requiredString(node.getProperty('display-name'), `${path}.display-name`),
        kind: kind as ProjectAssetReference['kind'],
        path:
          node.getProperty('path') === undefined
            ? undefined
            : requiredString(node.getProperty('path'), `${path}.path`),
        locales: Object.fromEntries(
          node.findNodesByName('locale').map((locale, localeIndex) => {
            const localePath = `${path}.locale[${localeIndex}]`;
            assertArguments(locale, localePath, 2);
            assertProperties(locale, localePath, []);
            assertChildren(locale, localePath, []);
            return [
              requiredString(locale.getArgument(0), `${localePath}.name`),
              requiredString(locale.getArgument(1), `${localePath}.path`),
            ];
          }),
        ),
        storyIds: parseUsage(node, path),
      };
    },
  );

  const project: StoryProjectDocument = {
    format: STORY_PROJECT_FORMAT,
    version: STORY_PROJECT_VERSION,
    id: requiredId(root.getArgument(0), 'project', 'project.id'),
    name,
    displayName: (root.getProperty('display-name') as string | undefined) ?? name,
    entryStoryId: root.getProperty('entry-story')
      ? requiredId(root.getProperty('entry-story'), 'story', 'project.entry-story')
      : undefined,
    outputDirectory:
      root.getProperty('output-directory') === undefined
        ? undefined
        : requiredString(root.getProperty('output-directory'), 'project.output-directory'),
    stories,
    characters,
    assets,
  };
  validateProject(project);
  return project;
}
