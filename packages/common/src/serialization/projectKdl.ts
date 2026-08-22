import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId, type StableId, type StableIdKind } from '../types/ids';
import {
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type ProjectAssetReference,
  type ProjectCharacterReference,
  type ProjectStoryReference,
  type EngineFieldType,
  type EngineTypeDefinition,
  engineValueMatchesFieldType,
  type StoryProjectDocument,
} from '../types/project';
import type { EventSource, SignalSource } from '../types/source';
import type { RuntimeValue, ValueType, VariableDefinition } from '../types/values';
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
  const engineTypeNames = new Set<string>();
  const engineTypeIds = new Set<string>();
  const engineFieldIds = new Set<string>();
  for (const engineType of project.engineTypes ?? []) {
    if (!isStableId(engineType.id, 'engineType') || engineTypeIds.has(engineType.id)) {
      throw new StoryFormatError(`Invalid or duplicate Engine Type ID ${engineType.id}`);
    }
    engineTypeIds.add(engineType.id);
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(engineType.name)) {
      throw new StoryFormatError(`Invalid Engine Type name ${engineType.name}`);
    }
    if (engineTypeNames.has(engineType.name)) {
      throw new StoryFormatError(`Duplicate Engine Type ${engineType.name}`);
    }
    engineTypeNames.add(engineType.name);
    const fieldNames = new Set<string>();
    for (const field of engineType.fields) {
      if (!isStableId(field.id, 'engineField') || engineFieldIds.has(field.id)) {
        throw new StoryFormatError(`Invalid or duplicate Engine Field ID ${field.id}`);
      }
      engineFieldIds.add(field.id);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) {
        throw new StoryFormatError(`Invalid field ${engineType.name}.${field.name}`);
      }
      if (fieldNames.has(field.name)) {
        throw new StoryFormatError(`Duplicate field ${engineType.name}.${field.name}`);
      }
      fieldNames.add(field.name);
    }
  }
  const validateFieldReferences = (fieldType: EngineFieldType, path: string): void => {
    if (fieldType.kind === 'object' && !engineTypeNames.has(fieldType.typeName)) {
      throw new StoryFormatError(`${path} references missing Engine Type ${fieldType.typeName}`);
    }
    if (fieldType.kind === 'array') validateFieldReferences(fieldType.elementType, `${path}[]`);
  };
  for (const engineType of project.engineTypes ?? []) {
    for (const field of engineType.fields) {
      validateFieldReferences(field.type, `${engineType.name}.${field.name}`);
      if (
        !(field.defaultValue === null && field.nullable) &&
        !engineValueMatchesFieldType(field.defaultValue, field.type, project.engineTypes ?? [])
      ) {
        throw new StoryFormatError(
          `${engineType.name}.${field.name} default does not match its Engine Field type`,
        );
      }
    }
  }
  const referencedTypeNames = (fieldType: EngineFieldType): string[] =>
    fieldType.kind === 'object'
      ? [fieldType.typeName]
      : fieldType.kind === 'array'
        ? referencedTypeNames(fieldType.elementType)
        : [];
  const engineTypesByName = new Map(
    (project.engineTypes ?? []).map((engineType) => [engineType.name, engineType]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitEngineType = (name: string): void => {
    if (visiting.has(name)) throw new StoryFormatError(`Cyclic Engine Type reference at ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const field of engineTypesByName.get(name)?.fields ?? []) {
      for (const reference of referencedTypeNames(field.type)) visitEngineType(reference);
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of engineTypeNames) visitEngineType(name);
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
  if (
    project.localizationPath !== undefined &&
    (!project.localizationPath.toLowerCase().endsWith('.storyloc') ||
      project.localizationPath.startsWith('/') ||
      /^[a-z]:[\\/]/i.test(project.localizationPath) ||
      project.localizationPath.split(/[\\/]/).includes('..'))
  ) {
    throw new StoryFormatError(`Invalid project localization path ${project.localizationPath}`);
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
    if (assetNames.has(asset.name))
      throw new StoryFormatError(`Duplicate asset name ${asset.name}`);
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
  const validateEngineResourceValue = (
    value: RuntimeValue,
    type: EngineFieldType,
    path: string,
  ): void => {
    if (value === null) return;
    if (type.kind === 'character-ref' && !characterIds.has(value as string)) {
      throw new StoryFormatError(`${path} references missing Character ${String(value)}`);
    }
    if (type.kind === 'asset-ref' && !assetIds.has(value as string)) {
      throw new StoryFormatError(`${path} references missing Asset ${String(value)}`);
    }
    if (type.kind === 'array' && Array.isArray(value)) {
      value.forEach((item, index) =>
        validateEngineResourceValue(item, type.elementType, `${path}[${index}]`),
      );
    }
    if (type.kind === 'object' && !Array.isArray(value) && typeof value === 'object') {
      const definition = engineTypesByName.get(type.typeName);
      const record = value as Readonly<Record<string, RuntimeValue>>;
      for (const field of definition?.fields ?? []) {
        const fieldValue = record[field.name];
        if (fieldValue !== undefined) {
          validateEngineResourceValue(fieldValue, field.type, `${path}.${field.name}`);
        }
      }
    }
  };
  for (const engineType of project.engineTypes ?? []) {
    for (const field of engineType.fields) {
      validateEngineResourceValue(
        field.defaultValue,
        field.type,
        `${engineType.name}.${field.name}.default`,
      );
    }
  }
  const variableIds = new Set<string>();
  const variableNames = new Set<string>();
  for (const variable of project.variables ?? []) {
    if (!isStableId(variable.id, 'variable')) {
      throw new StoryFormatError(`Invalid project variable ID ${variable.id}`);
    }
    if (variable.scope !== 'project') {
      throw new StoryFormatError(`Project variable ${variable.name} must use project scope`);
    }
    if (variableIds.has(variable.id) || variableNames.has(variable.name)) {
      throw new StoryFormatError(`Duplicate project variable ${variable.name}`);
    }
    if (
      !['boolean', 'number', 'string', 'json'].includes(variable.valueType.kind) ||
      (variable.valueType.kind === 'json' && !variable.valueType.name.trim())
    ) {
      throw new StoryFormatError(`Unsupported project variable type in ${variable.name}`);
    }
    if (
      variable.valueType.kind !== 'json' &&
      typeof variable.defaultValue !== variable.valueType.kind
    ) {
      throw new StoryFormatError(`Invalid default value for project variable ${variable.name}`);
    }
    if (
      variable.valueType.kind === 'json' &&
      engineTypeNames.has(variable.valueType.name) &&
      !engineValueMatchesFieldType(
        variable.defaultValue,
        { kind: 'object', typeName: variable.valueType.name },
        project.engineTypes ?? [],
      )
    ) {
      throw new StoryFormatError(
        `Project variable ${variable.name} does not match Engine Type ${variable.valueType.name}`,
      );
    }
    if (variable.valueType.kind === 'json' && engineTypeNames.has(variable.valueType.name)) {
      validateEngineResourceValue(
        variable.defaultValue,
        { kind: 'object', typeName: variable.valueType.name },
        `Project variable ${variable.name}`,
      );
    }
    variableIds.add(variable.id);
    variableNames.add(variable.name);
  }
  const eventIds = new Set<string>();
  const eventNames = new Set<string>();
  for (const event of project.events) {
    if (!isStableId(event.id, 'event')) throw new StoryFormatError(`Invalid event ID ${event.id}`);
    if (eventIds.has(event.id)) throw new StoryFormatError(`Duplicate event ID ${event.id}`);
    if (eventNames.has(event.name))
      throw new StoryFormatError(`Duplicate event name ${event.name}`);
    eventIds.add(event.id);
    eventNames.add(event.name);
    if (
      event.returnType &&
      !['boolean', 'number', 'string', 'json'].includes(event.returnType.kind)
    ) {
      throw new StoryFormatError(`Unsupported return type in event ${event.name}`);
    }
    const parameterNames = new Set<string>();
    for (const parameter of event.parameters) {
      if (!parameter.name || parameterNames.has(parameter.name)) {
        throw new StoryFormatError(`Invalid or duplicate parameter in event ${event.name}`);
      }
      parameterNames.add(parameter.name);
      if (
        !['boolean', 'number', 'string', 'json'].includes(parameter.valueType.kind) ||
        (parameter.valueType.kind === 'json' && !parameter.valueType.name.trim())
      ) {
        throw new StoryFormatError(`Unsupported parameter type in event ${event.name}`);
      }
    }
  }
  const signalIds = new Set<string>();
  const signalNames = new Set<string>();
  for (const signal of project.signals) {
    if (!isStableId(signal.id, 'signal')) {
      throw new StoryFormatError(`Invalid signal ID ${signal.id}`);
    }
    if (signalIds.has(signal.id)) throw new StoryFormatError(`Duplicate signal ID ${signal.id}`);
    if (!signal.name || signalNames.has(signal.name)) {
      throw new StoryFormatError(`Invalid or duplicate signal name ${signal.name}`);
    }
    signalIds.add(signal.id);
    signalNames.add(signal.name);
    const parameterNames = new Set<string>();
    for (const parameter of signal.parameters) {
      if (!parameter.name || parameterNames.has(parameter.name)) {
        throw new StoryFormatError(`Invalid or duplicate parameter in signal ${signal.name}`);
      }
      parameterNames.add(parameter.name);
      if (
        !['boolean', 'number', 'string', 'json'].includes(parameter.valueType.kind) ||
        (parameter.valueType.kind === 'json' && !parameter.valueType.name.trim())
      ) {
        throw new StoryFormatError(`Unsupported parameter type in signal ${signal.name}`);
      }
    }
  }
}

function scalarValueType(name: string, path: string): ValueType {
  if (name === 'boolean' || name === 'number' || name === 'string') return { kind: name };
  if (name.startsWith('json:') && name.slice(5).trim())
    return { kind: 'json', name: name.slice(5) };
  throw new StoryFormatError(`${path} has unsupported value type ${name}`);
}

function projectValueTypeName(valueType: ValueType): string {
  return valueType.kind === 'json' ? `json:${valueType.name}` : valueType.kind;
}

function engineFieldTypeName(type: EngineFieldType): string {
  switch (type.kind) {
    case 'boolean':
    case 'number':
    case 'string':
    case 'character-ref':
    case 'asset-ref':
      return type.kind;
    case 'enum':
      return `enum:${JSON.stringify(type.values)}`;
    case 'object':
      return `object:${type.typeName}`;
    case 'array':
      return `array:${engineFieldTypeName(type.elementType)}`;
  }
}

function parseEngineFieldType(value: string, path: string): EngineFieldType {
  if (
    value === 'boolean' ||
    value === 'number' ||
    value === 'string' ||
    value === 'character-ref' ||
    value === 'asset-ref'
  )
    return { kind: value };
  if (value.startsWith('object:') && value.slice(7)) {
    return { kind: 'object', typeName: value.slice(7) };
  }
  if (value.startsWith('array:')) {
    return { kind: 'array', elementType: parseEngineFieldType(value.slice(6), `${path}.element`) };
  }
  if (value.startsWith('enum:')) {
    try {
      const values = JSON.parse(value.slice(5)) as unknown;
      if (Array.isArray(values) && values.every((item) => typeof item === 'string')) {
        return { kind: 'enum', values };
      }
    } catch {
      // Report the stable format error below.
    }
  }
  throw new StoryFormatError(`${path} contains invalid Engine Field type ${value}`);
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
  if (project.localizationPath) root.setProperty('localization', project.localizationPath);

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
  if ((project.engineTypes?.length ?? 0) > 0) {
    const engineTypes = Node.create('engine-types');
    for (const engineType of [...(project.engineTypes ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const typeNode = Node.create('engine-type');
      typeNode.addArgument(engineType.name);
      typeNode.setProperty('id', engineType.id);
      if (engineType.displayName !== engineType.name) {
        typeNode.setProperty('display-name', engineType.displayName);
      }
      if (engineType.description) typeNode.setProperty('description', engineType.description);
      for (const field of engineType.fields) {
        const fieldNode = Node.create('field');
        fieldNode.addArgument(field.name);
        fieldNode.setProperty('id', field.id);
        if (field.displayName !== field.name)
          fieldNode.setProperty('display-name', field.displayName);
        if (field.description) fieldNode.setProperty('description', field.description);
        fieldNode.setProperty('type', engineFieldTypeName(field.type));
        if (field.nullable) fieldNode.setProperty('nullable', true);
        fieldNode.setProperty('default', JSON.stringify(field.defaultValue));
        typeNode.appendNode(fieldNode);
      }
      engineTypes.appendNode(typeNode);
    }
    root.appendNode(engineTypes);
  }
  if ((project.variables?.length ?? 0) > 0) {
    const variables = Node.create('variables');
    for (const variable of [...(project.variables ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const node = Node.create('variable');
      node.addArgument(variable.id);
      node.setProperty('name', variable.name);
      if (variable.displayName !== variable.name) {
        node.setProperty('display-name', variable.displayName);
      }
      node.setProperty('type', projectValueTypeName(variable.valueType));
      node.setProperty(
        'default',
        variable.valueType.kind === 'json'
          ? JSON.stringify(variable.defaultValue)
          : (variable.defaultValue as boolean | number | string),
      );
      variables.appendNode(node);
    }
    root.appendNode(variables);
  }
  if (project.events.length > 0) {
    const events = Node.create('events');
    for (const event of [...project.events].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const node = Node.create('event');
      node.addArgument(event.id);
      node.setProperty('name', event.name);
      if (event.displayName !== event.name) node.setProperty('display-name', event.displayName);
      if (event.description) node.setProperty('description', event.description);
      node.setProperty('resumable', event.resumable);
      node.setProperty('side-effect', event.sideEffect);
      if (event.returnType) node.setProperty('return-type', projectValueTypeName(event.returnType));
      for (const parameter of event.parameters) {
        const parameterNode = Node.create('parameter');
        parameterNode.addArgument(parameter.name);
        parameterNode.setProperty('type', projectValueTypeName(parameter.valueType));
        node.appendNode(parameterNode);
      }
      events.appendNode(node);
    }
    root.appendNode(events);
  }
  if (project.signals.length > 0) {
    const signals = Node.create('signals');
    for (const signal of [...project.signals].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const node = Node.create('signal');
      node.addArgument(signal.id);
      node.setProperty('name', signal.name);
      if (signal.displayName !== signal.name) node.setProperty('display-name', signal.displayName);
      if (signal.description) node.setProperty('description', signal.description);
      for (const parameter of signal.parameters) {
        const parameterNode = Node.create('parameter');
        parameterNode.addArgument(parameter.name);
        parameterNode.setProperty('type', projectValueTypeName(parameter.valueType));
        node.appendNode(parameterNode);
      }
      signals.appendNode(node);
    }
    root.appendNode(signals);
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
    'localization',
  ]);
  assertChildren(root, 'project', [
    'stories',
    'characters',
    'assets',
    'engine-types',
    'variables',
    'events',
    'signals',
  ]);
  for (const section of [
    'stories',
    'characters',
    'assets',
    'engine-types',
    'variables',
    'events',
    'signals',
  ]) {
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

  const engineTypesContainer = root.findNodeByName('engine-types');
  if (engineTypesContainer) {
    assertArguments(engineTypesContainer, 'engine-types', 0);
    assertProperties(engineTypesContainer, 'engine-types', []);
    assertChildren(engineTypesContainer, 'engine-types', ['engine-type']);
  }
  const engineTypes: EngineTypeDefinition[] = (
    engineTypesContainer?.findNodesByName('engine-type') ?? []
  ).map((node, index) => {
    const path = `engine-types[${index}]`;
    assertArguments(node, path, 1);
    assertProperties(node, path, ['id', 'display-name', 'description']);
    assertChildren(node, path, ['field']);
    const name = requiredString(node.getArgument(0), `${path}.name`);
    return {
      id: requiredId(node.getProperty('id'), 'engineType', `${path}.id`),
      name,
      displayName: (node.getProperty('display-name') as string | undefined) ?? name,
      description:
        node.getProperty('description') === undefined
          ? undefined
          : requiredString(node.getProperty('description'), `${path}.description`),
      fields: node.findNodesByName('field').map((fieldNode, fieldIndex) => {
        const fieldPath = `${path}.field[${fieldIndex}]`;
        assertArguments(fieldNode, fieldPath, 1);
        assertProperties(fieldNode, fieldPath, [
          'display-name',
          'id',
          'description',
          'type',
          'nullable',
          'default',
        ]);
        assertChildren(fieldNode, fieldPath, []);
        const fieldName = requiredString(fieldNode.getArgument(0), `${fieldPath}.name`);
        const serializedDefault = requiredString(
          fieldNode.getProperty('default'),
          `${fieldPath}.default`,
        );
        let defaultValue: RuntimeValue;
        try {
          defaultValue = JSON.parse(serializedDefault) as RuntimeValue;
        } catch {
          throw new StoryFormatError(`${fieldPath}.default contains invalid JSON`);
        }
        const nullable = fieldNode.getProperty('nullable');
        if (nullable !== undefined && typeof nullable !== 'boolean') {
          throw new StoryFormatError(`${fieldPath}.nullable must be a boolean`);
        }
        return {
          id: requiredId(fieldNode.getProperty('id'), 'engineField', `${fieldPath}.id`),
          name: fieldName,
          displayName: (fieldNode.getProperty('display-name') as string | undefined) ?? fieldName,
          description:
            fieldNode.getProperty('description') === undefined
              ? undefined
              : requiredString(fieldNode.getProperty('description'), `${fieldPath}.description`),
          type: parseEngineFieldType(
            requiredString(fieldNode.getProperty('type'), `${fieldPath}.type`),
            `${fieldPath}.type`,
          ),
          nullable: nullable || undefined,
          defaultValue,
        };
      }),
    };
  });

  const variablesContainer = root.findNodeByName('variables');
  if (variablesContainer) {
    assertArguments(variablesContainer, 'variables', 0);
    assertProperties(variablesContainer, 'variables', []);
    assertChildren(variablesContainer, 'variables', ['variable']);
  }
  const variables: VariableDefinition[] = (
    variablesContainer?.findNodesByName('variable') ?? []
  ).map((node, index) => {
    const path = `variables[${index}]`;
    assertArguments(node, path, 1);
    assertProperties(node, path, ['name', 'display-name', 'type', 'default']);
    assertChildren(node, path, []);
    const name = requiredString(node.getProperty('name'), `${path}.name`);
    const valueType = scalarValueType(
      requiredString(node.getProperty('type'), `${path}.type`),
      `${path}.type`,
    );
    const serializedDefault = node.getProperty('default');
    const defaultValue =
      valueType.kind === 'json'
        ? (() => {
            if (typeof serializedDefault !== 'string')
              throw new StoryFormatError(`${path}.default must be JSON text`);
            try {
              return JSON.parse(serializedDefault) as RuntimeValue;
            } catch {
              throw new StoryFormatError(`${path}.default contains invalid JSON`);
            }
          })()
        : serializedDefault;
    if (valueType.kind !== 'json' && typeof defaultValue !== valueType.kind) {
      throw new StoryFormatError(`${path}.default must be ${valueType.kind}`);
    }
    return {
      id: requiredId(node.getArgument(0), 'variable', `${path}.id`),
      name,
      displayName: (node.getProperty('display-name') as string | undefined) ?? name,
      scope: 'project',
      valueType,
      defaultValue: defaultValue as RuntimeValue,
    };
  });

  const eventsContainer = root.findNodeByName('events');
  if (eventsContainer) {
    assertArguments(eventsContainer, 'events', 0);
    assertProperties(eventsContainer, 'events', []);
    assertChildren(eventsContainer, 'events', ['event']);
  }
  const events: EventSource[] = (eventsContainer?.findNodesByName('event') ?? []).map(
    (node, index) => {
      const path = `events[${index}]`;
      assertArguments(node, path, 1);
      assertProperties(node, path, [
        'name',
        'display-name',
        'description',
        'resumable',
        'side-effect',
        'return-type',
      ]);
      assertChildren(node, path, ['parameter']);
      const name = requiredString(node.getProperty('name'), `${path}.name`);
      const resumable = node.getProperty('resumable');
      if (typeof resumable !== 'boolean') {
        throw new StoryFormatError(`${path}.resumable must be a boolean`);
      }
      const sideEffect = requiredString(node.getProperty('side-effect'), `${path}.side-effect`);
      if (!['none', 'read', 'write'].includes(sideEffect)) {
        throw new StoryFormatError(`${path}.side-effect is invalid`);
      }
      return {
        id: requiredId(node.getArgument(0), 'event', `${path}.id`),
        name,
        displayName: (node.getProperty('display-name') as string | undefined) ?? name,
        description:
          node.getProperty('description') === undefined
            ? undefined
            : requiredString(node.getProperty('description'), `${path}.description`),
        parameters: node.findNodesByName('parameter').map((parameter, parameterIndex) => {
          const parameterPath = `${path}.parameter[${parameterIndex}]`;
          assertArguments(parameter, parameterPath, 1);
          assertProperties(parameter, parameterPath, ['type']);
          assertChildren(parameter, parameterPath, []);
          return {
            name: requiredString(parameter.getArgument(0), `${parameterPath}.name`),
            valueType: scalarValueType(
              requiredString(parameter.getProperty('type'), `${parameterPath}.type`),
              parameterPath,
            ),
          };
        }),
        returnType:
          node.getProperty('return-type') === undefined
            ? undefined
            : scalarValueType(
                requiredString(node.getProperty('return-type'), `${path}.return-type`),
                `${path}.return-type`,
              ),
        resumable,
        sideEffect: sideEffect as EventSource['sideEffect'],
      };
    },
  );

  const signalsContainer = root.findNodeByName('signals');
  if (signalsContainer) {
    assertArguments(signalsContainer, 'signals', 0);
    assertProperties(signalsContainer, 'signals', []);
    assertChildren(signalsContainer, 'signals', ['signal']);
  }
  const signals: SignalSource[] = (signalsContainer?.findNodesByName('signal') ?? []).map(
    (node, index) => {
      const path = `signals[${index}]`;
      assertArguments(node, path, 1);
      assertProperties(node, path, ['name', 'display-name', 'description']);
      assertChildren(node, path, ['parameter']);
      const signalName = requiredString(node.getProperty('name'), `${path}.name`);
      return {
        id: requiredId(node.getArgument(0), 'signal', `${path}.id`),
        name: signalName,
        displayName: (node.getProperty('display-name') as string | undefined) ?? signalName,
        description:
          node.getProperty('description') === undefined
            ? undefined
            : requiredString(node.getProperty('description'), `${path}.description`),
        parameters: node.findNodesByName('parameter').map((parameter, parameterIndex) => {
          const parameterPath = `${path}.parameter[${parameterIndex}]`;
          assertArguments(parameter, parameterPath, 1);
          assertProperties(parameter, parameterPath, ['type']);
          assertChildren(parameter, parameterPath, []);
          return {
            name: requiredString(parameter.getArgument(0), `${parameterPath}.name`),
            valueType: scalarValueType(
              requiredString(parameter.getProperty('type'), `${parameterPath}.type`),
              parameterPath,
            ),
          };
        }),
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
    localizationPath:
      root.getProperty('localization') === undefined
        ? undefined
        : requiredString(root.getProperty('localization'), 'project.localization'),
    stories,
    characters,
    assets,
    engineTypes,
    variables,
    events,
    signals,
  };
  validateProject(project);
  return project;
}
