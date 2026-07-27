import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId, type StableId, type StableIdKind } from '../types/ids';
import { StoryNodeType, type ChoiceOption, type StoryNodeDataMap } from '../types/nodes';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  type AssetSource,
  type CharacterSource,
  type ChapterSource,
  type SourceEdge,
  type SourceGraph,
  type SourceNode,
  type StorySourceDocument,
} from '../types/source';
import type { RuntimeValue, ValueType, VariableDefinition, VariableScope } from '../types/values';

export class StoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryFormatError';
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StoryFormatError(`${path} must be a string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, path);
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StoryFormatError(`${path} must be a finite number`);
  }
  return value;
}

function requiredInteger(value: unknown, path: string): number {
  const number = requiredNumber(value, path);
  if (!Number.isInteger(number)) throw new StoryFormatError(`${path} must be an integer`);
  return number;
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

function assertShape(
  node: Node,
  path: string,
  options: {
    arguments: number;
    properties?: readonly string[];
    children?: readonly string[];
  },
): void {
  if (node.getArguments().length !== options.arguments) {
    throw new StoryFormatError(`${path} must have ${options.arguments} argument(s)`);
  }
  const properties = new Set(options.properties ?? []);
  for (const property of node.getProperties().keys()) {
    if (!properties.has(property)) {
      throw new StoryFormatError(`${path} contains unsupported property ${property}`);
    }
  }
  const children = new Set(options.children ?? []);
  for (const child of node.children?.nodes ?? []) {
    if (!children.has(child.getName())) {
      throw new StoryFormatError(`${path} contains unsupported child ${child.getName()}`);
    }
  }
}

function addCommonNodeProperties(target: Node, source: SourceNode): void {
  if (source.name) target.setProperty('name', source.name);
  if (source.definitionVersion !== 1)
    target.setProperty('definition-version', source.definitionVersion);
  target.setProperty('x', Math.round(source.position.x));
  target.setProperty('y', Math.round(source.position.y));
}

function expressionSource(value: unknown, path: string) {
  const source = requiredString(value, path);
  return { source, bindings: {} } as const;
}

function serializeSourceNode(source: SourceNode): Node {
  if (!Object.values(StoryNodeType).includes(source.type as StoryNodeType)) {
    throw new StoryFormatError(`Cannot serialize unsupported node type ${source.type}`);
  }
  const target = Node.create(source.type);
  target.addArgument(source.id);
  addCommonNodeProperties(target, source);
  const data = source.data as StoryNodeDataMap[StoryNodeType];

  switch (source.type) {
    case StoryNodeType.Start:
    case StoryNodeType.End:
      target.setProperty(
        'title',
        requiredString(
          (data as StoryNodeDataMap[StoryNodeType.Start] | StoryNodeDataMap[StoryNodeType.End])
            .title,
          `${source.id}.title`,
        ),
      );
      break;
    case StoryNodeType.Dialogue: {
      const dialogue = data as StoryNodeDataMap[StoryNodeType.Dialogue];
      if (dialogue.speakerId) target.setProperty('speaker', dialogue.speakerId);
      if (dialogue.voiceId) target.setProperty('voice', dialogue.voiceId);
      if (dialogue.emotion) target.setProperty('emotion', dialogue.emotion);
      const text = Node.create('text');
      text.addArgument(requiredString(dialogue.text.source, `${source.id}.text`));
      target.appendNode(text);
      break;
    }
    case StoryNodeType.Choice: {
      const choice = data as StoryNodeDataMap[StoryNodeType.Choice];
      target.setProperty('prompt', requiredString(choice.prompt.source, `${source.id}.prompt`));
      for (const option of choice.options) {
        const optionNode = Node.create('option');
        optionNode.addArgument(option.id);
        optionNode.addArgument(requiredString(option.text.source, `${source.id}.option.text`));
        if (option.visibleIf?.source) optionNode.setProperty('visible-if', option.visibleIf.source);
        if (option.enabledIf?.source) optionNode.setProperty('enabled-if', option.enabledIf.source);
        target.appendNode(optionNode);
      }
      break;
    }
    case StoryNodeType.Branch:
      target.setProperty(
        'condition',
        requiredString(
          (data as StoryNodeDataMap[StoryNodeType.Branch]).condition.source,
          `${source.id}.condition`,
        ),
      );
      break;
    case StoryNodeType.GetVariable: {
      const variableId = (data as StoryNodeDataMap[StoryNodeType.GetVariable]).variableId;
      if (variableId) target.setProperty('variable', variableId);
      break;
    }
    case StoryNodeType.SetVariable: {
      const setVariable = data as StoryNodeDataMap[StoryNodeType.SetVariable];
      if (setVariable.variableId) target.setProperty('variable', setVariable.variableId);
      target.setProperty('value', setVariable.value.source);
      break;
    }
    case StoryNodeType.CallSubstory: {
      const chapterId = (data as StoryNodeDataMap[StoryNodeType.CallSubstory]).chapterId;
      if (chapterId) target.setProperty('chapter', chapterId);
      break;
    }
    case StoryNodeType.FlowAnchor:
      target.setProperty(
        'label',
        requiredString(
          (data as StoryNodeDataMap[StoryNodeType.FlowAnchor]).label,
          `${source.id}.label`,
        ),
      );
      break;
    case StoryNodeType.FlowJump: {
      const targetNodeId = (data as StoryNodeDataMap[StoryNodeType.FlowJump]).targetNodeId;
      if (targetNodeId) target.setProperty('target', targetNodeId);
      break;
    }
    case StoryNodeType.Reroute:
    case StoryNodeType.Return:
      break;
  }
  return target;
}

function serializeGraph(source: SourceGraph): Node {
  const graph = Node.create('graph');
  for (const sourceNode of source.nodes) graph.appendNode(serializeSourceNode(sourceNode));
  for (const sourceEdge of source.edges) {
    const link = Node.create('link');
    link.addArgument(sourceEdge.from.nodeId);
    link.addArgument(sourceEdge.to.nodeId);
    if (sourceEdge.from.portId !== 'out') link.setProperty('from', sourceEdge.from.portId);
    if (sourceEdge.to.portId !== 'in') link.setProperty('to', sourceEdge.to.portId);
    graph.appendNode(link);
  }
  return graph;
}

function valueTypeName(valueType: ValueType): string {
  if (valueType.kind === 'boolean' || valueType.kind === 'number' || valueType.kind === 'string') {
    return valueType.kind;
  }
  throw new StoryFormatError(`Unsupported variable type ${valueType.kind}`);
}

function serializeVariables(variables: readonly VariableDefinition[]): Node | undefined {
  if (variables.length === 0) return undefined;
  const container = Node.create('variables');
  for (const variable of variables) {
    const node = Node.create('variable');
    node.addArgument(variable.id);
    node.setProperty('name', variable.name);
    if (variable.displayName !== variable.name)
      node.setProperty('display-name', variable.displayName);
    node.setProperty('type', valueTypeName(variable.valueType));
    if (variable.scope !== 'story') node.setProperty('scope', variable.scope);
    if (
      variable.defaultValue !== null &&
      typeof variable.defaultValue !== 'boolean' &&
      typeof variable.defaultValue !== 'number' &&
      typeof variable.defaultValue !== 'string'
    ) {
      throw new StoryFormatError(`${variable.id}.default must be a scalar`);
    }
    node.setProperty('default', variable.defaultValue);
    container.appendNode(node);
  }
  return container;
}

function serializeCharacters(characters: readonly CharacterSource[]): Node | undefined {
  if (characters.length === 0) return undefined;
  const container = Node.create('characters');
  for (const character of characters) {
    const node = Node.create('character');
    node.addArgument(character.id);
    node.setProperty('name', character.name);
    node.setProperty('display-name', character.displayName);
    if (character.defaultPortraitId) node.setProperty('portrait', character.defaultPortraitId);
    for (const [key, emotion] of Object.entries(character.emotions)) {
      const emotionNode = Node.create('emotion');
      emotionNode.addArgument(key);
      emotionNode.setProperty('display-name', emotion.displayName);
      if (emotion.portraitId) emotionNode.setProperty('portrait', emotion.portraitId);
      node.appendNode(emotionNode);
    }
    container.appendNode(node);
  }
  return container;
}

function serializeAssets(assets: readonly AssetSource[]): Node | undefined {
  if (assets.length === 0) return undefined;
  const container = Node.create('assets');
  for (const asset of assets) {
    const node = Node.create('asset');
    node.addArgument(asset.id);
    node.setProperty('name', asset.name);
    node.setProperty('display-name', asset.displayName);
    node.setProperty('kind', asset.kind);
    for (const [locale, path] of Object.entries(asset.locales ?? {})) {
      const localeNode = Node.create('locale');
      localeNode.addArgument(locale);
      localeNode.addArgument(path);
      node.appendNode(localeNode);
    }
    container.appendNode(node);
  }
  return container;
}

function serializeChapters(chapters: readonly ChapterSource[]): Node | undefined {
  if (chapters.length === 0) return undefined;
  const container = Node.create('chapters');
  for (const chapter of chapters) {
    if (chapter.parameters.length > 0 || chapter.localVariables.length > 0 || chapter.returnType) {
      throw new StoryFormatError(
        'Chapter parameters, locals, and return values are not supported yet',
      );
    }
    const node = Node.create('chapter');
    node.addArgument(chapter.id);
    node.setProperty('name', chapter.name);
    if (chapter.displayName !== chapter.name) node.setProperty('display-name', chapter.displayName);
    node.appendNode(serializeGraph(chapter.graph));
    container.appendNode(node);
  }
  return container;
}

function validateStoryReferences(source: StorySourceDocument): void {
  const chapterIds = new Set(source.chapters.map((chapter) => chapter.id));
  const variableIds = new Set(source.variables.map((variable) => variable.id));
  const allNodeIds = new Set<string>();
  const graphs = [source.root, ...source.chapters.map((chapter) => chapter.graph)];
  for (const graph of graphs) {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const nodeId of nodeIds) {
      if (allNodeIds.has(nodeId)) throw new StoryFormatError(`Duplicate node ID: ${nodeId}`);
      allNodeIds.add(nodeId);
    }
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from.nodeId) || !nodeIds.has(edge.to.nodeId)) {
        throw new StoryFormatError('Link references a missing node');
      }
    }
    for (const node of graph.nodes) {
      if (node.type !== StoryNodeType.FlowJump) continue;
      const targetNodeId = (node.data as StoryNodeDataMap[StoryNodeType.FlowJump]).targetNodeId;
      if (!targetNodeId) continue;
      const targetNode = targetNodeId ? nodesById.get(targetNodeId) : undefined;
      if (!targetNode || targetNode.type !== StoryNodeType.FlowAnchor) {
        throw new StoryFormatError(`${node.id} references a missing Flow Anchor in its graph`);
      }
    }
  }
  for (const node of graphs.flatMap((graph) => graph.nodes)) {
    if (node.type === StoryNodeType.GetVariable || node.type === StoryNodeType.SetVariable) {
      const data = node.data as unknown as
        StoryNodeDataMap[StoryNodeType.GetVariable] | StoryNodeDataMap[StoryNodeType.SetVariable];
      if (data.variableId && !variableIds.has(data.variableId)) {
        throw new StoryFormatError(`${node.id} references missing variable ${data.variableId}`);
      }
    }
    if (node.type === StoryNodeType.CallSubstory) {
      const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      if (!data.chapterId || !chapterIds.has(data.chapterId)) {
        throw new StoryFormatError(`${node.id} references a missing substory`);
      }
    }
  }
}

export function serializeStorySource(source: StorySourceDocument): string {
  if (source.format !== STORY_SOURCE_FORMAT || source.version !== STORY_SOURCE_VERSION) {
    throw new StoryFormatError('Unsupported Story Source format or version');
  }
  if (source.events.length > 0) {
    throw new StoryFormatError('This writer cannot yet preserve events');
  }
  validateStoryReferences(source);
  const story = Node.create('story');
  story.addArgument(source.id);
  story.setProperty('format', source.format);
  story.setProperty('version', source.version);
  story.setProperty('name', source.name);
  if (source.displayName !== source.name) story.setProperty('display-name', source.displayName);
  const variables = serializeVariables(source.variables);
  const characters = serializeCharacters(source.characters);
  const assets = serializeAssets(source.assets);
  const chapters = serializeChapters(source.chapters);
  if (variables) story.appendNode(variables);
  if (characters) story.appendNode(characters);
  if (assets) story.appendNode(assets);
  if (chapters) story.appendNode(chapters);
  story.appendNode(serializeGraph(source.root));
  return format(new Document([story]));
}

function parseSourceNode(node: Node): SourceNode {
  const type = node.getName() as StoryNodeType;
  if (!Object.values(StoryNodeType).includes(type)) {
    throw new StoryFormatError(`Unsupported node type ${type}`);
  }
  const id = requiredId(node.getArgument(0), 'node', `${type}.id`);
  const commonProperties = ['name', 'definition-version', 'x', 'y'] as const;
  const typeProperties: Record<StoryNodeType, readonly string[]> = {
    [StoryNodeType.Start]: ['title'],
    [StoryNodeType.Dialogue]: ['speaker', 'voice', 'emotion'],
    [StoryNodeType.Choice]: ['prompt'],
    [StoryNodeType.Branch]: ['condition'],
    [StoryNodeType.GetVariable]: ['variable'],
    [StoryNodeType.SetVariable]: ['variable', 'value'],
    [StoryNodeType.CallSubstory]: ['chapter'],
    [StoryNodeType.Reroute]: [],
    [StoryNodeType.FlowAnchor]: ['label'],
    [StoryNodeType.FlowJump]: ['target'],
    [StoryNodeType.Return]: [],
    [StoryNodeType.End]: ['title'],
  };
  const typeChildren: Record<StoryNodeType, readonly string[]> = {
    [StoryNodeType.Dialogue]: ['text'],
    [StoryNodeType.Choice]: ['option'],
    [StoryNodeType.Start]: [],
    [StoryNodeType.Branch]: [],
    [StoryNodeType.GetVariable]: [],
    [StoryNodeType.SetVariable]: [],
    [StoryNodeType.CallSubstory]: [],
    [StoryNodeType.Reroute]: [],
    [StoryNodeType.FlowAnchor]: [],
    [StoryNodeType.FlowJump]: [],
    [StoryNodeType.Return]: [],
    [StoryNodeType.End]: [],
  };
  assertShape(node, id, {
    arguments: 1,
    properties: [...commonProperties, ...typeProperties[type]],
    children: typeChildren[type],
  });

  let data: StoryNodeDataMap[StoryNodeType];
  switch (type) {
    case StoryNodeType.Start:
    case StoryNodeType.End:
      data = { title: requiredString(node.getProperty('title'), `${id}.title`) };
      break;
    case StoryNodeType.Dialogue: {
      const texts = node.findNodesByName('text');
      if (texts.length !== 1) throw new StoryFormatError(`${id} must contain exactly one text`);
      assertShape(texts[0], `${id}.text`, { arguments: 1 });
      data = {
        text: { source: requiredString(texts[0].getArgument(0), `${id}.text`) },
        speakerId: node.getProperty('speaker')
          ? requiredId(node.getProperty('speaker'), 'character', `${id}.speaker`)
          : undefined,
        voiceId: node.getProperty('voice')
          ? requiredId(node.getProperty('voice'), 'asset', `${id}.voice`)
          : undefined,
        emotion: optionalString(node.getProperty('emotion'), `${id}.emotion`),
      };
      break;
    }
    case StoryNodeType.Choice: {
      const optionIds = new Set<string>();
      const options = node.findNodesByName('option').map((optionNode): ChoiceOption => {
        assertShape(optionNode, `${id}.option`, {
          arguments: 2,
          properties: ['visible-if', 'enabled-if'],
        });
        const optionId = requiredId(optionNode.getArgument(0), 'option', `${id}.option.id`);
        if (optionIds.has(optionId)) throw new StoryFormatError(`Duplicate option ID: ${optionId}`);
        optionIds.add(optionId);
        const visible = optionalString(
          optionNode.getProperty('visible-if'),
          `${optionId}.visible-if`,
        );
        const enabled = optionalString(
          optionNode.getProperty('enabled-if'),
          `${optionId}.enabled-if`,
        );
        return {
          id: optionId,
          text: { source: requiredString(optionNode.getArgument(1), `${optionId}.text`) },
          visibleIf: visible ? expressionSource(visible, `${optionId}.visible-if`) : undefined,
          enabledIf: enabled ? expressionSource(enabled, `${optionId}.enabled-if`) : undefined,
        };
      });
      data = {
        prompt: { source: requiredString(node.getProperty('prompt'), `${id}.prompt`) },
        options,
      };
      break;
    }
    case StoryNodeType.Branch:
      data = { condition: expressionSource(node.getProperty('condition'), `${id}.condition`) };
      break;
    case StoryNodeType.GetVariable:
      data = {
        variableId: node.getProperty('variable')
          ? requiredId(node.getProperty('variable'), 'variable', `${id}.variable`)
          : undefined,
      };
      break;
    case StoryNodeType.SetVariable:
      data = {
        variableId: node.getProperty('variable')
          ? requiredId(node.getProperty('variable'), 'variable', `${id}.variable`)
          : undefined,
        value: expressionSource(node.getProperty('value'), `${id}.value`),
      };
      break;
    case StoryNodeType.CallSubstory:
      data = {
        chapterId: node.getProperty('chapter')
          ? requiredId(node.getProperty('chapter'), 'chapter', `${id}.chapter`)
          : undefined,
      };
      break;
    case StoryNodeType.Reroute:
      data = {};
      break;
    case StoryNodeType.FlowAnchor:
      data = { label: requiredString(node.getProperty('label'), `${id}.label`) };
      break;
    case StoryNodeType.FlowJump:
      data = {
        targetNodeId: node.getProperty('target')
          ? requiredId(node.getProperty('target'), 'node', `${id}.target`)
          : undefined,
      };
      break;
    case StoryNodeType.Return:
      data = {};
      break;
  }
  const definitionVersionValue = node.getProperty('definition-version');
  return {
    id,
    name: optionalString(node.getProperty('name'), `${id}.name`),
    type,
    definitionVersion:
      definitionVersionValue === undefined
        ? 1
        : requiredInteger(definitionVersionValue, `${id}.definition-version`),
    position: {
      x: requiredInteger(node.getProperty('x'), `${id}.x`),
      y: requiredInteger(node.getProperty('y'), `${id}.y`),
    },
    data: data as unknown as Readonly<Record<string, unknown>>,
  };
}

function parseGraph(graph: Node): SourceGraph {
  assertShape(graph, 'story.graph', {
    arguments: 0,
    children: [...Object.values(StoryNodeType), 'link'],
  });
  const nodes: SourceNode[] = [];
  const nodeIds = new Set<string>();
  const nodeNames = new Set<string>();
  for (const node of graph.children?.nodes ?? []) {
    if (node.getName() === 'link') continue;
    const sourceNode = parseSourceNode(node);
    if (nodeIds.has(sourceNode.id))
      throw new StoryFormatError(`Duplicate node ID: ${sourceNode.id}`);
    nodeIds.add(sourceNode.id);
    if (sourceNode.name) {
      if (nodeNames.has(sourceNode.name))
        throw new StoryFormatError(`Duplicate node name: ${sourceNode.name}`);
      nodeNames.add(sourceNode.name);
    }
    nodes.push(sourceNode);
  }
  const edges: SourceEdge[] = graph.findNodesByName('link').map((link) => {
    assertShape(link, 'story.graph.link', {
      arguments: 2,
      properties: ['from', 'to'],
    });
    return {
      from: {
        nodeId: requiredId(link.getArgument(0), 'node', 'link.from-node'),
        portId: optionalString(link.getProperty('from'), 'link.from-port') ?? 'out',
      },
      to: {
        nodeId: requiredId(link.getArgument(1), 'node', 'link.to-node'),
        portId: optionalString(link.getProperty('to'), 'link.to-port') ?? 'in',
      },
    };
  });
  return { nodes, edges };
}

function parseValueType(value: unknown, path: string): ValueType {
  const kind = requiredString(value, path);
  if (kind === 'boolean' || kind === 'number' || kind === 'string') return { kind };
  throw new StoryFormatError(`${path} contains unsupported type ${kind}`);
}

function parseVariables(container: Node | undefined): VariableDefinition[] {
  if (!container) return [];
  assertShape(container, 'story.variables', { arguments: 0, children: ['variable'] });
  const ids = new Set<string>();
  const names = new Set<string>();
  return container.findNodesByName('variable').map((node) => {
    assertShape(node, 'story.variables.variable', {
      arguments: 1,
      properties: ['name', 'display-name', 'type', 'scope', 'default'],
    });
    const id = requiredId(node.getArgument(0), 'variable', 'variable.id');
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate variable ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate variable name: ${name}`);
    ids.add(id);
    names.add(name);
    const valueType = parseValueType(node.getProperty('type'), `${id}.type`);
    const scopeValue = optionalString(node.getProperty('scope'), `${id}.scope`) ?? 'story';
    if (!['story', 'chapter', 'local'].includes(scopeValue)) {
      throw new StoryFormatError(`${id}.scope is unsupported`);
    }
    const defaultValue = node.getProperty('default');
    if (
      defaultValue !== null &&
      typeof defaultValue !== 'boolean' &&
      typeof defaultValue !== 'number' &&
      typeof defaultValue !== 'string'
    ) {
      throw new StoryFormatError(`${id}.default must be a scalar`);
    }
    return {
      id,
      name,
      displayName: optionalString(node.getProperty('display-name'), `${id}.display-name`) ?? name,
      scope: scopeValue as VariableScope,
      valueType,
      defaultValue: defaultValue as RuntimeValue,
    };
  });
}

function parseCharacters(container: Node | undefined): CharacterSource[] {
  if (!container) return [];
  assertShape(container, 'story.characters', { arguments: 0, children: ['character'] });
  const ids = new Set<string>();
  const names = new Set<string>();
  return container.findNodesByName('character').map((node) => {
    assertShape(node, 'story.characters.character', {
      arguments: 1,
      properties: ['name', 'display-name', 'portrait'],
      children: ['emotion'],
    });
    const id = requiredId(node.getArgument(0), 'character', 'character.id');
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate character ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate character name: ${name}`);
    ids.add(id);
    names.add(name);
    const emotions: CharacterSource['emotions'] = Object.fromEntries(
      node.findNodesByName('emotion').map((emotion) => {
        assertShape(emotion, `${id}.emotion`, {
          arguments: 1,
          properties: ['display-name', 'portrait'],
        });
        const key = requiredString(emotion.getArgument(0), `${id}.emotion.key`);
        return [
          key,
          {
            displayName:
              optionalString(emotion.getProperty('display-name'), `${id}.${key}.display-name`) ??
              key,
            portraitId: emotion.getProperty('portrait')
              ? requiredId(emotion.getProperty('portrait'), 'asset', `${id}.${key}.portrait`)
              : undefined,
          },
        ];
      }),
    );
    return {
      id,
      name,
      displayName: requiredString(node.getProperty('display-name'), `${id}.display-name`),
      defaultPortraitId: node.getProperty('portrait')
        ? requiredId(node.getProperty('portrait'), 'asset', `${id}.portrait`)
        : undefined,
      emotions,
    };
  });
}

function parseAssets(container: Node | undefined): AssetSource[] {
  if (!container) return [];
  assertShape(container, 'story.assets', { arguments: 0, children: ['asset'] });
  return container.findNodesByName('asset').map((node) => {
    assertShape(node, 'story.assets.asset', {
      arguments: 1,
      properties: ['name', 'display-name', 'kind'],
      children: ['locale'],
    });
    const id = requiredId(node.getArgument(0), 'asset', 'asset.id');
    const kind = requiredString(node.getProperty('kind'), `${id}.kind`);
    if (kind !== 'audio' && kind !== 'portrait' && kind !== 'other') {
      throw new StoryFormatError(`${id}.kind is unsupported`);
    }
    const locales = Object.fromEntries(
      node.findNodesByName('locale').map((locale) => {
        assertShape(locale, `${id}.locale`, { arguments: 2 });
        return [
          requiredString(locale.getArgument(0), `${id}.locale.name`),
          requiredString(locale.getArgument(1), `${id}.locale.path`),
        ];
      }),
    );
    return {
      id,
      name: requiredString(node.getProperty('name'), `${id}.name`),
      displayName: requiredString(node.getProperty('display-name'), `${id}.display-name`),
      kind,
      locales: Object.keys(locales).length > 0 ? locales : undefined,
    };
  });
}

function parseChapters(container: Node | undefined): ChapterSource[] {
  if (!container) return [];
  assertShape(container, 'story.chapters', { arguments: 0, children: ['chapter'] });
  const ids = new Set<string>();
  const names = new Set<string>();
  return container.findNodesByName('chapter').map((node) => {
    assertShape(node, 'story.chapters.chapter', {
      arguments: 1,
      properties: ['name', 'display-name'],
      children: ['graph'],
    });
    if (node.findNodesByName('graph').length !== 1) {
      throw new StoryFormatError('Chapter must contain exactly one graph');
    }
    const id = requiredId(node.getArgument(0), 'chapter', 'chapter.id');
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate chapter ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate chapter name: ${name}`);
    ids.add(id);
    names.add(name);
    return {
      id,
      name,
      displayName: optionalString(node.getProperty('display-name'), `${id}.display-name`) ?? name,
      parameters: [],
      localVariables: [],
      graph: parseGraph(node.findNodeByName('graph')!),
    };
  });
}

export function parseStorySource(text: string): StorySourceDocument {
  let document: Document;
  try {
    document = parse(text);
  } catch (error) {
    throw new StoryFormatError(error instanceof Error ? error.message : String(error));
  }
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== 'story') {
    throw new StoryFormatError('Document must contain exactly one story node');
  }
  const story = document.nodes[0];
  assertShape(story, 'story', {
    arguments: 1,
    properties: ['format', 'version', 'name', 'display-name'],
    children: ['variables', 'characters', 'assets', 'chapters', 'graph'],
  });
  if (story.findNodesByName('graph').length !== 1) {
    throw new StoryFormatError('Story must contain exactly one graph');
  }
  for (const section of ['variables', 'characters', 'assets', 'chapters'] as const) {
    if (story.findNodesByName(section).length > 1) {
      throw new StoryFormatError(`Story may contain at most one ${section} section`);
    }
  }
  const formatName = requiredString(story.getProperty('format'), 'story.format');
  const version = requiredInteger(story.getProperty('version'), 'story.version');
  if (formatName !== STORY_SOURCE_FORMAT || version !== STORY_SOURCE_VERSION) {
    throw new StoryFormatError(
      `Unsupported Story Source format or version: ${formatName}@${version}`,
    );
  }
  const name = requiredString(story.getProperty('name'), 'story.name');
  const source: StorySourceDocument = {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: requiredId(story.getArgument(0), 'story', 'story.id'),
    name,
    displayName: optionalString(story.getProperty('display-name'), 'story.display-name') ?? name,
    root: parseGraph(story.findNodeByName('graph')!),
    variables: parseVariables(story.findNodeByName('variables')),
    characters: parseCharacters(story.findNodeByName('characters')),
    assets: parseAssets(story.findNodeByName('assets')),
    chapters: parseChapters(story.findNodeByName('chapters')),
    events: [],
  };
  validateStoryReferences(source);
  return source;
}
