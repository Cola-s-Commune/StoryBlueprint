import { Document, Node, format, parse } from '@bgotink/kdl';
import { isStableId } from '../types/ids';
import { StoryNodeType, type ChoiceOption } from '../types/nodes';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  type SourceEdge,
  type SourceGraph,
  type SourceNode,
  type StorySourceDocument,
} from '../types/source';

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

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StoryFormatError(`${path} must be a finite number`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, path: string): number {
  const number = requiredNumber(value, path);
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryFormatError(`${path} must be a positive integer`);
  }
  return number;
}

function assertNodeShape(
  node: Node,
  path: string,
  options: {
    arguments: number;
    properties: readonly string[];
    children: readonly string[];
  },
): void {
  if (node.getArguments().length !== options.arguments) {
    throw new StoryFormatError(`${path} must have ${options.arguments} argument(s)`);
  }
  const allowedProperties = new Set(options.properties);
  for (const property of node.getProperties().keys()) {
    if (!allowedProperties.has(property)) {
      throw new StoryFormatError(`${path} contains unsupported property ${property}`);
    }
  }
  const allowedChildren = new Set(options.children);
  for (const child of node.children?.nodes ?? []) {
    if (!allowedChildren.has(child.getName())) {
      throw new StoryFormatError(`${path} contains unsupported child ${child.getName()}`);
    }
  }
}

function requiredId<Prefix extends string>(
  value: unknown,
  prefix: Prefix,
  path: string,
): `${Prefix}_${string}` {
  const id = requiredString(value, path);
  if (!isStableId(id, prefix)) throw new StoryFormatError(`${path} must start with ${prefix}_`);
  return id;
}

function nodeType(value: unknown, path: string): StoryNodeType {
  if (Object.values(StoryNodeType).includes(value as StoryNodeType)) {
    return value as StoryNodeType;
  }
  throw new StoryFormatError(`${path} contains unsupported node type ${String(value)}`);
}

function createDataNode(source: SourceNode): Node {
  const data = Node.create('data');
  const values = source.data as Readonly<Record<string, unknown>>;
  switch (source.type) {
    case StoryNodeType.Start:
    case StoryNodeType.End:
      data.setProperty('title', requiredString(values.title, `${source.id}.data.title`));
      break;
    case StoryNodeType.Dialogue:
      data.setProperty('speaker', requiredString(values.speaker, `${source.id}.data.speaker`));
      data.setProperty('text', requiredString(values.text, `${source.id}.data.text`));
      break;
    case StoryNodeType.Branch:
      data.setProperty(
        'condition',
        requiredString(values.condition, `${source.id}.data.condition`),
      );
      break;
    case StoryNodeType.Choice: {
      data.setProperty('prompt', requiredString(values.prompt, `${source.id}.data.prompt`));
      if (!Array.isArray(values.options)) {
        throw new StoryFormatError(`${source.id}.data.options must be an array`);
      }
      for (const rawOption of values.options) {
        const option = rawOption as Partial<ChoiceOption>;
        const optionNode = Node.create('option');
        optionNode.addArgument(requiredId(option.id, 'option', `${source.id}.option.id`));
        optionNode.setProperty('label', requiredString(option.label, `${source.id}.option.label`));
        data.appendNode(optionNode);
      }
      break;
    }
    default:
      throw new StoryFormatError(`Cannot serialize unsupported node type ${source.type}`);
  }
  return data;
}

function serializeGraph(source: SourceGraph): Node {
  const graph = Node.create('graph');
  for (const sourceNode of source.nodes) {
    const node = Node.create('node');
    node.addArgument(sourceNode.id);
    node.setProperty('name', sourceNode.name);
    node.setProperty('type', sourceNode.type);
    node.setProperty('definition-version', sourceNode.definitionVersion);
    node.setProperty('x', sourceNode.position.x);
    node.setProperty('y', sourceNode.position.y);
    node.appendNode(createDataNode(sourceNode));
    graph.appendNode(node);
  }
  for (const sourceEdge of source.edges) {
    const edge = Node.create('edge');
    edge.addArgument(sourceEdge.id);
    edge.setProperty('from-node', sourceEdge.from.nodeId);
    edge.setProperty('from-port', sourceEdge.from.portId);
    edge.setProperty('to-node', sourceEdge.to.nodeId);
    edge.setProperty('to-port', sourceEdge.to.portId);
    graph.appendNode(edge);
  }
  return graph;
}

export function serializeStorySource(source: StorySourceDocument): string {
  if (source.format !== STORY_SOURCE_FORMAT || source.version !== STORY_SOURCE_VERSION) {
    throw new StoryFormatError('Unsupported Story Source format or version');
  }
  if (
    source.chapters.length > 0 ||
    source.variables.length > 0 ||
    source.characters.length > 0 ||
    source.assets.length > 0 ||
    source.events.length > 0
  ) {
    throw new StoryFormatError(
      'This writer cannot yet preserve chapters, variables, characters, assets, or events',
    );
  }
  const story = Node.create('story');
  story.addArgument(source.id);
  story.setProperty('format', source.format);
  story.setProperty('version', source.version);
  story.setProperty('name', source.name);
  story.setProperty('display-name', source.displayName);
  story.appendNode(serializeGraph(source.root));
  return format(new Document([story]));
}

function parseNodeData(node: Node, type: StoryNodeType): Readonly<Record<string, unknown>> {
  const data = node.findNodeByName('data');
  if (!data) throw new StoryFormatError(`node ${node.getArgument(0)} is missing data`);
  switch (type) {
    case StoryNodeType.Start:
    case StoryNodeType.End:
      assertNodeShape(data, `${type}.data`, {
        arguments: 0,
        properties: ['title'],
        children: [],
      });
      return { title: requiredString(data.getProperty('title'), `${type}.title`) };
    case StoryNodeType.Dialogue:
      assertNodeShape(data, `${type}.data`, {
        arguments: 0,
        properties: ['speaker', 'text'],
        children: [],
      });
      return {
        speaker: requiredString(data.getProperty('speaker'), `${type}.speaker`),
        text: requiredString(data.getProperty('text'), `${type}.text`),
      };
    case StoryNodeType.Branch:
      assertNodeShape(data, `${type}.data`, {
        arguments: 0,
        properties: ['condition'],
        children: [],
      });
      return { condition: requiredString(data.getProperty('condition'), `${type}.condition`) };
    case StoryNodeType.Choice: {
      assertNodeShape(data, `${type}.data`, {
        arguments: 0,
        properties: ['prompt'],
        children: ['option'],
      });
      const options: ChoiceOption[] = data.findNodesByName('option').map((option) => {
        assertNodeShape(option, 'choice.option', {
          arguments: 1,
          properties: ['label'],
          children: [],
        });
        return {
          id: requiredId(option.getArgument(0), 'option', 'choice.option.id'),
          label: requiredString(option.getProperty('label'), 'choice.option.label'),
        };
      });
      return {
        prompt: requiredString(data.getProperty('prompt'), 'choice.prompt'),
        options,
      };
    }
  }
}

function parseGraph(graph: Node): SourceGraph {
  assertNodeShape(graph, 'story.graph', {
    arguments: 0,
    properties: [],
    children: ['node', 'edge'],
  });
  const nodeIds = new Set<string>();
  const nodeNames = new Set<string>();
  const optionIds = new Set<string>();
  const nodes: SourceNode[] = graph.findNodesByName('node').map((node) => {
    const id = requiredId(node.getArgument(0), 'node', 'node.id');
    assertNodeShape(node, id, {
      arguments: 1,
      properties: ['name', 'type', 'definition-version', 'x', 'y'],
      children: ['data'],
    });
    if (node.findNodesByName('data').length !== 1) {
      throw new StoryFormatError(`${id} must contain exactly one data node`);
    }
    if (nodeIds.has(id)) throw new StoryFormatError(`Duplicate node ID: ${id}`);
    nodeIds.add(id);
    const type = nodeType(node.getProperty('type'), `${id}.type`);
    const data = parseNodeData(node, type);
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (nodeNames.has(name)) throw new StoryFormatError(`Duplicate node name: ${name}`);
    nodeNames.add(name);
    const dynamicPorts =
      type === StoryNodeType.Choice
        ? ((data.options as ChoiceOption[]) ?? []).map((option) => {
            if (optionIds.has(option.id)) {
              throw new StoryFormatError(`Duplicate option ID: ${option.id}`);
            }
            optionIds.add(option.id);
            return {
              id: option.id,
              name: `option_${option.id.slice(-8).replaceAll('-', '_')}`,
              displayName: option.label,
            };
          })
        : undefined;
    return {
      id,
      name,
      type,
      definitionVersion: requiredPositiveInteger(
        node.getProperty('definition-version'),
        `${id}.definition-version`,
      ),
      position: {
        x: requiredNumber(node.getProperty('x'), `${id}.x`),
        y: requiredNumber(node.getProperty('y'), `${id}.y`),
      },
      data,
      dynamicPorts,
    };
  });

  const edgeIds = new Set<string>();
  const edges: SourceEdge[] = graph.findNodesByName('edge').map((edge) => {
    assertNodeShape(edge, 'story.graph.edge', {
      arguments: 1,
      properties: ['from-node', 'from-port', 'to-node', 'to-port'],
      children: [],
    });
    const id = requiredId(edge.getArgument(0), 'edge', 'edge.id');
    if (edgeIds.has(id)) throw new StoryFormatError(`Duplicate edge ID: ${id}`);
    edgeIds.add(id);
    return {
      id,
      from: {
        nodeId: requiredId(edge.getProperty('from-node'), 'node', 'edge.from-node'),
        portId: requiredString(edge.getProperty('from-port'), 'edge.from-port'),
      },
      to: {
        nodeId: requiredId(edge.getProperty('to-node'), 'node', 'edge.to-node'),
        portId: requiredString(edge.getProperty('to-port'), 'edge.to-port'),
      },
    };
  });
  return { nodes, edges };
}

export function parseStorySource(text: string): StorySourceDocument {
  const document = parse(text);
  if (document.nodes.length !== 1 || document.nodes[0]?.getName() !== 'story') {
    throw new StoryFormatError('Document must contain exactly one story node');
  }
  const story = document.nodes[0];
  assertNodeShape(story, 'story', {
    arguments: 1,
    properties: ['format', 'version', 'name', 'display-name'],
    children: ['graph'],
  });
  const formatName = requiredString(story.getProperty('format'), 'story.format');
  const version = requiredNumber(story.getProperty('version'), 'story.version');
  if (formatName !== STORY_SOURCE_FORMAT || version !== STORY_SOURCE_VERSION) {
    throw new StoryFormatError(`Unsupported story format ${formatName}@${version}`);
  }
  const graphs = story.findNodesByName('graph');
  if (graphs.length !== 1) throw new StoryFormatError('story must contain exactly one graph');
  const graph = graphs[0];
  return {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: requiredId(story.getArgument(0), 'story', 'story.id'),
    name: requiredString(story.getProperty('name'), 'story.name'),
    displayName: requiredString(story.getProperty('display-name'), 'story.display-name'),
    root: parseGraph(graph),
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
  };
}
