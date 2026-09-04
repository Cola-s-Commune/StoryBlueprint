import { Document, Node, format, parse } from '@bgotink/kdl';
import { findConditionReferenceCycle } from '../conditionValidation';
import { isStableId, type StableId, type StableIdKind } from '../types/ids';
import {
  StoryNodeType,
  type ChoiceOption,
  type DialogueLine,
  type InkVariableDirection,
  type StoryNodeDataMap,
} from '../types/nodes';
import {
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  type AssetSource,
  type CharacterSource,
  type ChapterSource,
  type ConditionSource,
  type ConditionTreeNode,
  type SourceEdge,
  type SourceGraph,
  type SourceNode,
  type StorySourceDocument,
} from '../types/source';
import {
  parseValueTypeDescriptor,
  runtimeValueMatchesType,
  serializeValueTypeDescriptor,
  type RuntimeValue,
  type ValueType,
  type VariableDefinition,
  type VariableScope,
} from '../types/values';

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
}

function readBindings(
  node: Node,
  target: string,
  path: string,
): Record<string, StableId<'variable'>> {
  const bindings: Record<string, StableId<'variable'>> = {};
  for (const binding of node.findNodesByName('binding')) {
    assertShape(binding, `${path}.binding`, { arguments: 3 });
    if (requiredString(binding.getArgument(0), `${path}.binding.target`) !== target) continue;
    const symbol = requiredString(binding.getArgument(1), `${path}.binding.symbol`);
    if (bindings[symbol])
      throw new StoryFormatError(`${path} contains duplicate binding ${symbol}`);
    bindings[symbol] = requiredId(binding.getArgument(2), 'variable', `${path}.binding.variable`);
  }
  return bindings;
}

function assertBindingTargets(node: Node, targets: readonly string[], path: string): void {
  for (const binding of node.findNodesByName('binding')) {
    const target = requiredString(binding.getArgument(0), `${path}.binding.target`);
    if (!targets.includes(target)) {
      throw new StoryFormatError(`${path} contains unsupported binding target ${target}`);
    }
  }
}

function appendBindings(
  node: Node,
  target: string,
  bindings: Readonly<Record<string, StableId<'variable'>>> | undefined,
): void {
  for (const [symbol, variableId] of Object.entries(bindings ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const binding = Node.create('binding');
    binding.addArgument(target);
    binding.addArgument(symbol);
    binding.addArgument(variableId);
    node.appendNode(binding);
  }
}

function expressionSource(value: unknown, path: string, node?: Node, target?: string) {
  const source = requiredString(value, path);
  return { source, bindings: node && target ? readBindings(node, target, path) : {} } as const;
}

function textTemplateSource(value: unknown, path: string, node: Node, target: string) {
  const source = requiredString(value, path);
  const bindings = readBindings(node, target, path);
  return Object.keys(bindings).length > 0 ? { source, bindings } : { source };
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
      if (dialogue.lines.length === 0) {
        throw new StoryFormatError(`${source.id} must contain at least one dialogue line`);
      }
      for (const line of dialogue.lines) {
        const lineNode = Node.create('line');
        lineNode.addArgument(line.id);
        lineNode.addArgument(line.textId);
        lineNode.addArgument(requiredString(line.text.source, `${line.id}.text`));
        appendBindings(lineNode, 'text', line.text.bindings);
        if (line.speakerId) lineNode.setProperty('speaker', line.speakerId);
        if (line.voiceId) lineNode.setProperty('voice', line.voiceId);
        if (line.emotion) lineNode.setProperty('emotion', line.emotion);
        for (const tag of line.tags ?? []) {
          const tagNode = Node.create('tag');
          tagNode.addArgument(requiredString(tag, `${line.id}.tag`));
          lineNode.appendNode(tagNode);
        }
        target.appendNode(lineNode);
      }
      break;
    }
    case StoryNodeType.Narration: {
      const narration = data as StoryNodeDataMap[StoryNodeType.Narration];
      target.setProperty('text-id', narration.textId);
      target.setProperty('text', requiredString(narration.text.source, `${source.id}.text`));
      appendBindings(target, 'text', narration.text.bindings);
      if (narration.voiceId) target.setProperty('voice', narration.voiceId);
      break;
    }
    case StoryNodeType.InkBlock: {
      const ink = data as StoryNodeDataMap[StoryNodeType.InkBlock];
      target.setProperty('source-mode', ink.sourceMode);
      if (ink.sourceMode === 'embedded') {
        target.setProperty('source', requiredString(ink.source, `${source.id}.source`));
      } else {
        target.setProperty('path', requiredString(ink.path, `${source.id}.path`));
      }
      if (ink.entryKnot) target.setProperty('entry-knot', ink.entryKnot);
      for (const binding of ink.variableBindings ?? []) {
        const bindingNode = Node.create('variable-binding');
        bindingNode.addArgument(
          requiredString(binding.inkName, `${source.id}.variable-binding.ink-name`),
        );
        bindingNode.addArgument(binding.variableId);
        bindingNode.setProperty('direction', binding.direction);
        target.appendNode(bindingNode);
      }
      for (const binding of ink.externalFunctionBindings ?? []) {
        const bindingNode = Node.create('external-function-binding');
        bindingNode.addArgument(
          requiredString(binding.inkName, `${source.id}.external-function-binding.ink-name`),
        );
        bindingNode.addArgument(binding.functionId);
        target.appendNode(bindingNode);
      }
      break;
    }
    case StoryNodeType.Choice: {
      const choice = data as StoryNodeDataMap[StoryNodeType.Choice];
      target.setProperty('prompt', requiredString(choice.prompt.source, `${source.id}.prompt`));
      appendBindings(target, 'prompt', choice.prompt.bindings);
      for (const option of choice.options) {
        const optionNode = Node.create('option');
        optionNode.addArgument(option.id);
        optionNode.addArgument(requiredString(option.text.source, `${source.id}.option.text`));
        appendBindings(optionNode, 'text', option.text.bindings);
        if (option.visibleIf?.source) optionNode.setProperty('visible-if', option.visibleIf.source);
        if (option.enabledIf?.source) optionNode.setProperty('enabled-if', option.enabledIf.source);
        if (option.visibleConditionId)
          optionNode.setProperty(
            'visible-condition-ref',
            requiredId(
              option.visibleConditionId,
              'condition',
              `${source.id}.option.visible-condition-ref`,
            ),
          );
        if (option.enabledConditionId)
          optionNode.setProperty(
            'enabled-condition-ref',
            requiredId(
              option.enabledConditionId,
              'condition',
              `${source.id}.option.enabled-condition-ref`,
            ),
          );
        appendBindings(optionNode, 'visible-if', option.visibleIf?.bindings);
        appendBindings(optionNode, 'enabled-if', option.enabledIf?.bindings);
        target.appendNode(optionNode);
      }
      break;
    }
    case StoryNodeType.Branch: {
      const branch = data as StoryNodeDataMap[StoryNodeType.Branch];
      if (branch.conditionId) {
        target.setProperty(
          'condition-ref',
          requiredId(branch.conditionId, 'condition', `${source.id}.condition-ref`),
        );
      } else {
        target.setProperty(
          'condition',
          requiredString(branch.condition.source, `${source.id}.condition`),
        );
        appendBindings(target, 'condition', branch.condition.bindings);
      }
      break;
    }
    case StoryNodeType.GetVariable: {
      const getVariable = data as StoryNodeDataMap[StoryNodeType.GetVariable];
      const variableId = getVariable.variableId;
      if (variableId) target.setProperty('variable', variableId);
      if (getVariable.outputValueType) {
        target.setProperty('output-value-type', JSON.stringify(getVariable.outputValueType));
      }
      if (getVariable.accessor?.kind === 'member') {
        target.setProperty('member', getVariable.accessor.member);
        target.setProperty('output-type', JSON.stringify(getVariable.accessor.valueType));
      } else if (getVariable.accessor?.kind === 'index') {
        target.setProperty('index', getVariable.accessor.index.source);
        target.setProperty('output-type', JSON.stringify(getVariable.accessor.valueType));
        appendBindings(target, 'index', getVariable.accessor.index.bindings);
      }
      for (const field of getVariable.exposedFields ?? []) {
        const fieldNode = Node.create('output-field');
        fieldNode.addArgument(field.fieldId);
        fieldNode.addArgument(field.member);
        fieldNode.setProperty('display-name', field.displayName);
        fieldNode.setProperty('type', JSON.stringify(field.valueType));
        target.appendNode(fieldNode);
      }
      break;
    }
    case StoryNodeType.SetVariable: {
      const setVariable = data as StoryNodeDataMap[StoryNodeType.SetVariable];
      if (setVariable.variableId) target.setProperty('variable', setVariable.variableId);
      target.setProperty('value', setVariable.value.source);
      appendBindings(target, 'value', setVariable.value.bindings);
      if (setVariable.containerOperation) {
        target.setProperty('container-operation', setVariable.containerOperation);
      }
      if (setVariable.fieldId) target.setProperty('field-id', setVariable.fieldId);
      if (setVariable.fieldName) target.setProperty('field-name', setVariable.fieldName);
      if (setVariable.fieldValueType) {
        target.setProperty('field-type', JSON.stringify(setVariable.fieldValueType));
      }
      if (setVariable.valueInputType) {
        target.setProperty('value-input-type', JSON.stringify(setVariable.valueInputType));
      }
      if (setVariable.keyInputType) {
        target.setProperty('key-input-type', JSON.stringify(setVariable.keyInputType));
      }
      if (setVariable.key) {
        target.setProperty('key', setVariable.key.source);
        appendBindings(target, 'key', setVariable.key.bindings);
      }
      break;
    }
    case StoryNodeType.CallEvent: {
      const callEvent = data as StoryNodeDataMap[StoryNodeType.CallEvent];
      if (callEvent.eventId) target.setProperty('event', callEvent.eventId);
      for (const output of callEvent.outputPorts ?? []) {
        const port = Node.create('output-port');
        port.addArgument(output.id);
        port.setProperty('label', output.label);
        port.setProperty('type', JSON.stringify(output.valueType));
        target.appendNode(port);
      }
      for (const [name, value] of Object.entries(callEvent.arguments).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const argument = Node.create('argument');
        argument.addArgument(name);
        argument.addArgument(value.source);
        appendBindings(argument, 'value', value.bindings);
        target.appendNode(argument);
      }
      for (const [outputId, variableId] of Object.entries(callEvent.resultVariableIds ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const result = Node.create('result');
        result.addArgument(outputId);
        result.addArgument(variableId);
        target.appendNode(result);
      }
      break;
    }
    case StoryNodeType.WaitSignal: {
      const waitSignal = data as StoryNodeDataMap[StoryNodeType.WaitSignal];
      const signalId = waitSignal.signalId;
      if (signalId) target.setProperty('signal', signalId);
      for (const [name, value] of Object.entries(waitSignal.matches).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const match = Node.create('match');
        match.addArgument(name);
        match.addArgument(value.source);
        appendBindings(match, 'value', value.bindings);
        target.appendNode(match);
      }
      break;
    }
    case StoryNodeType.CallSubstory: {
      const call = data as StoryNodeDataMap[StoryNodeType.CallSubstory];
      if (call.chapterId) target.setProperty('chapter', call.chapterId);
      for (const [parameterId, value] of Object.entries(call.arguments ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const argument = Node.create('argument');
        argument.addArgument(parameterId);
        argument.addArgument(value.source);
        appendBindings(argument, 'value', value.bindings);
        target.appendNode(argument);
      }
      for (const [outputId, variableId] of Object.entries(call.resultVariableIds ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const result = Node.create('result');
        result.addArgument(outputId);
        result.addArgument(variableId);
        target.appendNode(result);
      }
      break;
    }
    case StoryNodeType.StartStory:
    case StoryNodeType.SwitchStory:
    case StoryNodeType.ResumeStory:
    case StoryNodeType.EndStoryInstance: {
      const control = data as StoryNodeDataMap[
        | StoryNodeType.StartStory
        | StoryNodeType.SwitchStory
        | StoryNodeType.ResumeStory
        | StoryNodeType.EndStoryInstance];
      if ('storyId' in control && control.storyId) target.setProperty('story', control.storyId);
      if (control.instanceId) {
        target.setProperty('instance-id', control.instanceId.source);
        appendBindings(target, 'instance-id', control.instanceId.bindings);
      }
      if ('instanceVariableId' in control && control.instanceVariableId) {
        target.setProperty('instance-variable', control.instanceVariableId);
      }
      if ('waitForCompletion' in control && control.waitForCompletion) {
        target.setProperty('wait-for-completion', 'true');
      }
      for (const [parameterId, value] of Object.entries(
        'arguments' in control ? (control.arguments ?? {}) : {},
      ).sort(([left], [right]) => left.localeCompare(right))) {
        const argument = Node.create('argument');
        argument.addArgument(parameterId);
        argument.addArgument(value.source);
        appendBindings(argument, 'value', value.bindings);
        target.appendNode(argument);
      }
      for (const [outputId, variableId] of Object.entries(control.resultVariableIds ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const result = Node.create('result');
        result.addArgument(outputId);
        result.addArgument(variableId);
        target.appendNode(result);
      }
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
    case StoryNodeType.Return: {
      for (const [outputId, value] of Object.entries(
        (data as StoryNodeDataMap[StoryNodeType.Return]).values ?? {},
      ).sort(([left], [right]) => left.localeCompare(right))) {
        const result = Node.create('result');
        result.addArgument(outputId);
        result.addArgument(value.source);
        appendBindings(result, 'value', value.bindings);
        target.appendNode(result);
      }
      break;
    }
    case StoryNodeType.Reroute: {
      const reroute = data as StoryNodeDataMap[StoryNodeType.Reroute];
      if (reroute.kind === 'data') {
        target.setProperty('kind', 'data');
        target.setProperty('value-type', JSON.stringify(reroute.valueType ?? { kind: 'any' }));
      }
      break;
    }
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
  const layout = Node.create('layout');
  for (const sourceNode of source.nodes) {
    const position = Node.create('position');
    position.addArgument(sourceNode.id);
    position.setProperty('x', Math.round(sourceNode.position.x));
    position.setProperty('y', Math.round(sourceNode.position.y));
    layout.appendNode(position);
  }
  graph.appendNode(layout);
  return graph;
}

function valueTypeName(valueType: ValueType): string {
  try {
    return serializeValueTypeDescriptor(valueType);
  } catch (error) {
    throw new StoryFormatError(
      `Unsupported variable type ${valueType.kind}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function serializeVariableDefault(variable: VariableDefinition): null | boolean | number | string {
  if (
    variable.valueType.kind === 'any' ||
    variable.valueType.kind === 'json' ||
    variable.valueType.kind === 'array' ||
    variable.valueType.kind === 'map' ||
    variable.valueType.kind === 'struct'
  )
    return JSON.stringify(variable.defaultValue);
  if (
    variable.defaultValue === null ||
    typeof variable.defaultValue === 'boolean' ||
    typeof variable.defaultValue === 'number' ||
    typeof variable.defaultValue === 'string'
  )
    return variable.defaultValue;
  throw new StoryFormatError(`${variable.id}.default must match ${variable.valueType.kind}`);
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
    node.setProperty('default', serializeVariableDefault(variable));
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
    if (character.description) node.setProperty('description', character.description);
    if (character.dialogueStyle) node.setProperty('dialogue-style', character.dialogueStyle);
    if (character.defaultPortraitId) node.setProperty('portrait', character.defaultPortraitId);
    for (const tag of [...new Set(character.tags ?? [])].sort()) {
      if (!tag.trim()) throw new StoryFormatError(`${character.id}.tag cannot be empty`);
      const tagNode = Node.create('tag');
      tagNode.addArgument(tag);
      node.appendNode(tagNode);
    }
    for (const [key, value] of Object.entries(character.metadata ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!key.trim()) throw new StoryFormatError(`${character.id}.metadata key cannot be empty`);
      const metaNode = Node.create('meta');
      metaNode.addArgument(key);
      metaNode.addArgument(value);
      node.appendNode(metaNode);
    }
    for (const [targetId, relationship] of Object.entries(character.relationships ?? {})) {
      if (!isStableId(targetId, 'character') || targetId === character.id) {
        throw new StoryFormatError(`${character.id}.relationship target is invalid`);
      }
      if (!relationship.label.trim()) {
        throw new StoryFormatError(`${character.id}.${targetId}.label cannot be empty`);
      }
      const relationshipNode = Node.create('relationship');
      relationshipNode.addArgument(targetId);
      relationshipNode.setProperty('label', relationship.label);
      if (relationship.description)
        relationshipNode.setProperty('description', relationship.description);
      node.appendNode(relationshipNode);
    }
    for (const field of character.fields ?? []) {
      const fieldNode = Node.create('field');
      fieldNode.addArgument(field.id);
      fieldNode.setProperty('name', field.name);
      if (field.displayName !== field.name)
        fieldNode.setProperty('display-name', field.displayName);
      fieldNode.setProperty('type', valueTypeName(field.valueType));
      if (!runtimeValueMatchesType(field.defaultValue, field.valueType)) {
        throw new StoryFormatError(`${field.id}.default must match ${field.valueType.kind}`);
      }
      fieldNode.setProperty('default', serializeVariableDefault(field));
      node.appendNode(fieldNode);
    }
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

function serializeConditionTree(tree: ConditionTreeNode): Node {
  switch (tree.kind) {
    case 'expression': {
      const node = Node.create('expression');
      node.addArgument(requiredString(tree.expression.source, 'condition.expression'));
      appendBindings(node, 'value', tree.expression.bindings);
      return node;
    }
    case 'all': {
      const node = Node.create('all');
      for (const child of tree.children) node.appendNode(serializeConditionTree(child));
      return node;
    }
    case 'any': {
      const node = Node.create('any');
      for (const child of tree.children) node.appendNode(serializeConditionTree(child));
      return node;
    }
    case 'not': {
      const node = Node.create('not');
      node.appendNode(serializeConditionTree(tree.child));
      return node;
    }
    case 'reference': {
      const node = Node.create('reference');
      node.addArgument(requiredId(tree.conditionId, 'condition', 'condition.reference'));
      return node;
    }
  }
}

function serializeConditions(conditions: readonly ConditionSource[]): Node | undefined {
  if (conditions.length === 0) return undefined;
  const container = Node.create('conditions');
  for (const condition of conditions) {
    const node = Node.create('condition');
    node.addArgument(requiredId(condition.id, 'condition', 'condition.id'));
    node.setProperty('name', requiredString(condition.name, `${condition.id}.name`));
    if (condition.displayName !== condition.name)
      node.setProperty(
        'display-name',
        requiredString(condition.displayName, `${condition.id}.display-name`),
      );
    if (condition.description) node.setProperty('description', condition.description);
    node.appendNode(serializeConditionTree(condition.root));
    container.appendNode(node);
  }
  return container;
}

function serializeChapters(chapters: readonly ChapterSource[]): Node | undefined {
  if (chapters.length === 0) return undefined;
  const container = Node.create('chapters');
  for (const chapter of chapters) {
    const node = Node.create('chapter');
    node.addArgument(chapter.id);
    node.setProperty('name', chapter.name);
    if (chapter.displayName !== chapter.name) node.setProperty('display-name', chapter.displayName);
    const appendVariable = (
      kind: 'parameter' | 'output' | 'local',
      variable: VariableDefinition,
    ) => {
      const child = Node.create(kind);
      child.addArgument(variable.id);
      child.setProperty('name', variable.name);
      if (variable.displayName !== variable.name)
        child.setProperty('display-name', variable.displayName);
      child.setProperty('type', valueTypeName(variable.valueType));
      child.setProperty('default', serializeVariableDefault(variable));
      node.appendNode(child);
    };
    for (const parameter of chapter.parameters) appendVariable('parameter', parameter.variable);
    for (const output of chapter.outputs) appendVariable('output', output.variable);
    for (const variable of chapter.localVariables) appendVariable('local', variable);
    node.appendNode(serializeGraph(chapter.graph));
    container.appendNode(node);
  }
  return container;
}

function validateStoryReferences(source: StorySourceDocument): void {
  const chapterIds = new Set(source.chapters.map((chapter) => chapter.id));
  const characterIds = new Set(source.characters.map((character) => character.id));
  const conditions = source.conditions ?? [];
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const conditionNames = new Set<string>();
  for (const condition of conditions) {
    if (conditionNames.has(condition.name))
      throw new StoryFormatError(`Duplicate condition name: ${condition.name}`);
    conditionNames.add(condition.name);
  }
  const referenceCycle = findConditionReferenceCycle(conditions);
  if (referenceCycle) {
    throw new StoryFormatError(`Condition cycle detected: ${referenceCycle.join(' -> ')}`);
  }
  const validateConditionTree = (
    tree: ConditionTreeNode,
    ownerId: ConditionSource['id'],
    stack: readonly ConditionSource['id'][] = [ownerId],
  ): void => {
    if (tree.kind === 'reference') {
      const target = conditionById.get(tree.conditionId);
      if (!target) {
        throw new StoryFormatError(`${ownerId} references missing condition ${tree.conditionId}`);
      }
      if (stack.includes(target.id)) {
        throw new StoryFormatError(
          `Condition cycle detected: ${[...stack, target.id].join(' -> ')}`,
        );
      }
      validateConditionTree(target.root, target.id, [...stack, target.id]);
      return;
    }
    if (tree.kind === 'not') {
      validateConditionTree(tree.child, ownerId, stack);
      return;
    }
    if (tree.kind === 'all' || tree.kind === 'any') {
      for (const child of tree.children) validateConditionTree(child, ownerId, stack);
    }
  };
  const conditionIds = new Set<string>();
  for (const condition of conditions) {
    if (conditionIds.has(condition.id))
      throw new StoryFormatError(`Duplicate condition ID: ${condition.id}`);
    conditionIds.add(condition.id);
    validateConditionTree(condition.root, condition.id);
  }
  for (const character of source.characters) {
    for (const targetId of Object.keys(character.relationships ?? {})) {
      if (!characterIds.has(targetId as CharacterSource['id'])) {
        throw new StoryFormatError(
          `Character ${character.id} relationship references missing character ${targetId}`,
        );
      }
    }
  }
  const allNodeIds = new Set<string>();
  const allLineIds = new Set<string>();
  const allTextIds = new Set<string>();
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
      if (node.type === StoryNodeType.Dialogue) {
        const dialogue = node.data as unknown as StoryNodeDataMap[StoryNodeType.Dialogue];
        for (const line of dialogue.lines) {
          if (allLineIds.has(line.id)) throw new StoryFormatError(`Duplicate line ID: ${line.id}`);
          if (allTextIds.has(line.textId)) {
            throw new StoryFormatError(`Duplicate text ID: ${line.textId}`);
          }
          allLineIds.add(line.id);
          allTextIds.add(line.textId);
        }
      }
      if (node.type === StoryNodeType.Narration) {
        const narration = node.data as unknown as StoryNodeDataMap[StoryNodeType.Narration];
        if (allTextIds.has(narration.textId)) {
          throw new StoryFormatError(`Duplicate text ID: ${narration.textId}`);
        }
        allTextIds.add(narration.textId);
      }
      if (node.type === StoryNodeType.Branch) {
        const branch = node.data as unknown as StoryNodeDataMap[StoryNodeType.Branch];
        if (branch.conditionId && !conditionIds.has(branch.conditionId)) {
          throw new StoryFormatError(
            `${node.id} references missing condition ${branch.conditionId}`,
          );
        }
      }
      if (node.type === StoryNodeType.Choice) {
        const choice = node.data as unknown as StoryNodeDataMap[StoryNodeType.Choice];
        for (const option of choice.options) {
          for (const conditionId of [option.visibleConditionId, option.enabledConditionId]) {
            if (conditionId && !conditionIds.has(conditionId)) {
              throw new StoryFormatError(
                `${node.id} option ${option.id} references missing condition ${conditionId}`,
              );
            }
          }
        }
      }
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
    if (node.type === StoryNodeType.CallSubstory) {
      const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      if (!data.chapterId || !chapterIds.has(data.chapterId)) {
        throw new StoryFormatError(`${node.id} references a missing substory`);
      }
      const chapter = source.chapters.find((candidate) => candidate.id === data.chapterId)!;
      const parameterIds = new Set(
        chapter.parameters.map((parameter) => parameter.variable.id as string),
      );
      for (const parameterId of Object.keys(data.arguments ?? {})) {
        if (!parameterIds.has(parameterId)) {
          throw new StoryFormatError(
            `${node.id} references missing substory parameter ${parameterId}`,
          );
        }
      }
      const outputIds = new Set(chapter.outputs.map((output) => output.variable.id as string));
      for (const outputId of Object.keys(data.resultVariableIds ?? {})) {
        if (!outputIds.has(outputId)) {
          throw new StoryFormatError(`${node.id} references missing substory output ${outputId}`);
        }
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
  const conditions = serializeConditions(source.conditions ?? []);
  const chapters = serializeChapters(source.chapters);
  if (variables) story.appendNode(variables);
  if (characters) story.appendNode(characters);
  if (assets) story.appendNode(assets);
  if (conditions) story.appendNode(conditions);
  if (chapters) story.appendNode(chapters);
  story.appendNode(serializeGraph(source.root));
  return format(new Document([story]));
}

const legacyResultOutputId = 'v_legacy_result' as VariableDefinition['id'];

function parseSourceNode(
  node: Node,
  position: { x: number; y: number },
  legacyOutputId?: VariableDefinition['id'],
): SourceNode {
  const type = node.getName() as StoryNodeType;
  if (!Object.values(StoryNodeType).includes(type)) {
    throw new StoryFormatError(`Unsupported node type ${type}`);
  }
  const id = requiredId(node.getArgument(0), 'node', `${type}.id`);
  const commonProperties = ['name', 'definition-version'] as const;
  const typeProperties: Record<StoryNodeType, readonly string[]> = {
    [StoryNodeType.Start]: ['title'],
    [StoryNodeType.Dialogue]: [],
    [StoryNodeType.Narration]: ['text-id', 'text', 'voice'],
    [StoryNodeType.InkBlock]: ['source-mode', 'source', 'path', 'entry-knot'],
    [StoryNodeType.Choice]: ['prompt'],
    [StoryNodeType.Branch]: ['condition', 'condition-ref'],
    [StoryNodeType.GetVariable]: [
      'variable',
      'member',
      'index',
      'output-type',
      'output-value-type',
    ],
    [StoryNodeType.SetVariable]: [
      'variable',
      'value',
      'container-operation',
      'key',
      'field-id',
      'field-name',
      'field-type',
      'value-input-type',
      'key-input-type',
    ],
    [StoryNodeType.CallEvent]: ['event'],
    [StoryNodeType.WaitSignal]: ['signal'],
    [StoryNodeType.CallSubstory]: ['chapter', 'result-variable'],
    [StoryNodeType.StartStory]: [
      'story',
      'instance-id',
      'instance-variable',
      'wait-for-completion',
    ],
    [StoryNodeType.SwitchStory]: [
      'story',
      'instance-id',
      'instance-variable',
      'wait-for-completion',
    ],
    [StoryNodeType.ResumeStory]: ['instance-id', 'instance-variable', 'wait-for-completion'],
    [StoryNodeType.EndStoryInstance]: ['instance-id'],
    [StoryNodeType.Reroute]: ['kind', 'value-type'],
    [StoryNodeType.FlowAnchor]: ['label'],
    [StoryNodeType.FlowJump]: ['target'],
    [StoryNodeType.Return]: ['value'],
    [StoryNodeType.End]: ['title'],
  };
  const typeChildren: Record<StoryNodeType, readonly string[]> = {
    [StoryNodeType.Dialogue]: ['line'],
    [StoryNodeType.Narration]: ['binding'],
    [StoryNodeType.InkBlock]: ['variable-binding', 'external-function-binding'],
    [StoryNodeType.Choice]: ['option', 'binding'],
    [StoryNodeType.Start]: [],
    [StoryNodeType.Branch]: ['binding'],
    [StoryNodeType.GetVariable]: ['output-field'],
    [StoryNodeType.SetVariable]: ['binding'],
    [StoryNodeType.CallEvent]: ['argument', 'output-port', 'result'],
    [StoryNodeType.WaitSignal]: ['match'],
    [StoryNodeType.CallSubstory]: ['argument', 'result'],
    [StoryNodeType.StartStory]: ['argument', 'result', 'binding'],
    [StoryNodeType.SwitchStory]: ['argument', 'result', 'binding'],
    [StoryNodeType.ResumeStory]: ['result', 'binding'],
    [StoryNodeType.EndStoryInstance]: ['result', 'binding'],
    [StoryNodeType.Reroute]: [],
    [StoryNodeType.FlowAnchor]: [],
    [StoryNodeType.FlowJump]: [],
    [StoryNodeType.Return]: ['result', 'binding'],
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
      const lineNodes = node.findNodesByName('line');
      if (lineNodes.length === 0) {
        throw new StoryFormatError(`${id} must contain at least one dialogue line`);
      }
      const lines: DialogueLine[] = lineNodes.map((lineNode) => {
        assertShape(lineNode, `${id}.line`, {
          arguments: 3,
          properties: ['speaker', 'voice', 'emotion'],
          children: ['tag', 'binding'],
        });
        assertBindingTargets(lineNode, ['text'], `${id}.line`);
        const lineId = requiredId(lineNode.getArgument(0), 'line', `${id}.line.id`);
        const textId = requiredId(lineNode.getArgument(1), 'text', `${lineId}.text-id`);
        const tags = lineNode.findNodesByName('tag').map((tagNode) => {
          assertShape(tagNode, `${lineId}.tag`, { arguments: 1 });
          return requiredString(tagNode.getArgument(0), `${lineId}.tag`);
        });
        return {
          id: lineId,
          textId,
          text: textTemplateSource(lineNode.getArgument(2), `${lineId}.text`, lineNode, 'text'),
          ...(lineNode.getProperty('speaker')
            ? {
                speakerId: requiredId(
                  lineNode.getProperty('speaker'),
                  'character',
                  `${lineId}.speaker`,
                ),
              }
            : {}),
          ...(lineNode.getProperty('voice')
            ? { voiceId: requiredId(lineNode.getProperty('voice'), 'asset', `${lineId}.voice`) }
            : {}),
          ...(lineNode.getProperty('emotion') !== undefined
            ? { emotion: optionalString(lineNode.getProperty('emotion'), `${lineId}.emotion`) }
            : {}),
          ...(tags.length > 0 ? { tags } : {}),
        };
      });
      data = { lines };
      break;
    }
    case StoryNodeType.Narration:
      assertBindingTargets(node, ['text'], id);
      data = {
        textId: requiredId(node.getProperty('text-id'), 'text', `${id}.text-id`),
        text: textTemplateSource(node.getProperty('text'), `${id}.text`, node, 'text'),
        ...(node.getProperty('voice')
          ? { voiceId: requiredId(node.getProperty('voice'), 'asset', `${id}.voice`) }
          : {}),
      };
      break;
    case StoryNodeType.InkBlock: {
      const sourceMode =
        optionalString(node.getProperty('source-mode'), `${id}.source-mode`) ?? 'embedded';
      if (sourceMode !== 'embedded' && sourceMode !== 'linked') {
        throw new StoryFormatError(`${id}.source-mode must be embedded or linked`);
      }
      const variableBindings = node
        .findNodesByName('variable-binding')
        .map((bindingNode, index) => {
          assertShape(bindingNode, `${id}.variable-binding[${index}]`, {
            arguments: 2,
            properties: ['direction'],
          });
          const direction = requiredString(
            bindingNode.getProperty('direction'),
            `${id}.variable-binding[${index}].direction`,
          );
          if (
            direction !== 'story-to-ink' &&
            direction !== 'ink-to-story' &&
            direction !== 'two-way'
          ) {
            throw new StoryFormatError(`${id}.variable-binding[${index}].direction is invalid`);
          }
          return {
            inkName: requiredString(
              bindingNode.getArgument(0),
              `${id}.variable-binding[${index}].ink-name`,
            ),
            variableId: requiredId(
              bindingNode.getArgument(1),
              'variable',
              `${id}.variable-binding[${index}].variable-id`,
            ),
            direction: direction as InkVariableDirection,
          };
        });
      const externalFunctionBindings = node
        .findNodesByName('external-function-binding')
        .map((bindingNode, index) => {
          assertShape(bindingNode, `${id}.external-function-binding[${index}]`, {
            arguments: 2,
            properties: [],
            children: [],
          });
          return {
            inkName: requiredString(
              bindingNode.getArgument(0),
              `${id}.external-function-binding[${index}].ink-name`,
            ),
            functionId: requiredId(
              bindingNode.getArgument(1),
              'event',
              `${id}.external-function-binding[${index}].function-id`,
            ),
          };
        });
      data =
        sourceMode === 'embedded'
          ? {
              sourceMode,
              source: requiredString(node.getProperty('source'), `${id}.source`),
              entryKnot: optionalString(node.getProperty('entry-knot'), `${id}.entry-knot`),
              ...(variableBindings.length > 0 ? { variableBindings } : {}),
              ...(externalFunctionBindings.length > 0 ? { externalFunctionBindings } : {}),
            }
          : {
              sourceMode,
              path: requiredString(node.getProperty('path'), `${id}.path`),
              entryKnot: optionalString(node.getProperty('entry-knot'), `${id}.entry-knot`),
              ...(variableBindings.length > 0 ? { variableBindings } : {}),
              ...(externalFunctionBindings.length > 0 ? { externalFunctionBindings } : {}),
            };
      break;
    }
    case StoryNodeType.Choice: {
      const optionIds = new Set<string>();
      const options = node.findNodesByName('option').map((optionNode): ChoiceOption => {
        assertShape(optionNode, `${id}.option`, {
          arguments: 2,
          properties: [
            'visible-if',
            'enabled-if',
            'visible-condition-ref',
            'enabled-condition-ref',
          ],
          children: ['binding'],
        });
        assertBindingTargets(optionNode, ['text', 'visible-if', 'enabled-if'], `${id}.option`);
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
        const visibleCondition = optionNode.getProperty('visible-condition-ref');
        const enabledCondition = optionNode.getProperty('enabled-condition-ref');
        return {
          id: optionId,
          text: textTemplateSource(
            optionNode.getArgument(1),
            `${optionId}.text`,
            optionNode,
            'text',
          ),
          visibleIf: visible
            ? expressionSource(visible, `${optionId}.visible-if`, optionNode, 'visible-if')
            : undefined,
          enabledIf: enabled
            ? expressionSource(enabled, `${optionId}.enabled-if`, optionNode, 'enabled-if')
            : undefined,
          ...(visibleCondition === undefined
            ? {}
            : {
                visibleConditionId: requiredId(
                  visibleCondition,
                  'condition',
                  `${optionId}.visible-condition-ref`,
                ),
              }),
          ...(enabledCondition === undefined
            ? {}
            : {
                enabledConditionId: requiredId(
                  enabledCondition,
                  'condition',
                  `${optionId}.enabled-condition-ref`,
                ),
              }),
        };
      });
      data = {
        prompt: textTemplateSource(node.getProperty('prompt'), `${id}.prompt`, node, 'prompt'),
        options,
      };
      assertBindingTargets(node, ['prompt'], id);
      break;
    }
    case StoryNodeType.Branch: {
      assertBindingTargets(node, ['condition'], id);
      const conditionRef = node.getProperty('condition-ref');
      const condition = node.getProperty('condition');
      if (conditionRef === undefined && condition === undefined) {
        throw new StoryFormatError(`${id} must define condition or condition-ref`);
      }
      data = {
        condition:
          condition === undefined
            ? { source: 'true', bindings: {} }
            : expressionSource(condition, `${id}.condition`, node, 'condition'),
        ...(conditionRef === undefined
          ? {}
          : { conditionId: requiredId(conditionRef, 'condition', `${id}.condition-ref`) }),
      };
      break;
    }
    case StoryNodeType.GetVariable: {
      assertBindingTargets(node, ['index'], id);
      const exposedFields = node.findNodesByName('output-field').map((fieldNode, index) => {
        assertShape(fieldNode, `${id}.output-field[${index}]`, {
          arguments: 2,
          properties: ['display-name', 'type'],
        });
        return {
          fieldId: requiredId(
            fieldNode.getArgument(0),
            'engineField',
            `${id}.output-field[${index}].id`,
          ),
          member: requiredString(fieldNode.getArgument(1), `${id}.output-field[${index}].member`),
          displayName: requiredString(
            fieldNode.getProperty('display-name'),
            `${id}.output-field[${index}].display-name`,
          ),
          valueType: JSON.parse(
            requiredString(fieldNode.getProperty('type'), `${id}.output-field[${index}].type`),
          ) as ValueType,
        };
      });
      data = {
        variableId: node.getProperty('variable')
          ? requiredId(node.getProperty('variable'), 'variable', `${id}.variable`)
          : undefined,
        outputValueType: node.getProperty('output-value-type')
          ? (JSON.parse(
              requiredString(node.getProperty('output-value-type'), `${id}.output-value-type`),
            ) as ValueType)
          : undefined,
        accessor:
          node.getProperty('member') !== undefined
            ? {
                kind: 'member',
                member: requiredString(node.getProperty('member'), `${id}.member`),
                valueType: JSON.parse(
                  requiredString(node.getProperty('output-type'), `${id}.output-type`),
                ) as ValueType,
              }
            : node.getProperty('index') !== undefined
              ? {
                  kind: 'index',
                  index: expressionSource(node.getProperty('index'), `${id}.index`, node, 'index'),
                  valueType: JSON.parse(
                    requiredString(node.getProperty('output-type'), `${id}.output-type`),
                  ) as ValueType,
                }
              : undefined,
        ...(exposedFields.length > 0 ? { exposedFields } : {}),
      };
      break;
    }
    case StoryNodeType.SetVariable:
      assertBindingTargets(node, ['value', 'key'], id);
      data = {
        variableId: node.getProperty('variable')
          ? requiredId(node.getProperty('variable'), 'variable', `${id}.variable`)
          : undefined,
        value: expressionSource(node.getProperty('value'), `${id}.value`, node, 'value'),
        containerOperation: node.getProperty('container-operation') as
          'append' | 'set-entry' | 'set-field' | undefined,
        key:
          node.getProperty('key') === undefined
            ? undefined
            : expressionSource(node.getProperty('key'), `${id}.key`, node, 'key'),
        fieldId: node.getProperty('field-id')
          ? requiredId(node.getProperty('field-id'), 'engineField', `${id}.field-id`)
          : undefined,
        fieldName: optionalString(node.getProperty('field-name'), `${id}.field-name`),
        fieldValueType: node.getProperty('field-type')
          ? (JSON.parse(
              requiredString(node.getProperty('field-type'), `${id}.field-type`),
            ) as ValueType)
          : undefined,
        valueInputType: node.getProperty('value-input-type')
          ? (JSON.parse(
              requiredString(node.getProperty('value-input-type'), `${id}.value-input-type`),
            ) as ValueType)
          : undefined,
        keyInputType: node.getProperty('key-input-type')
          ? (JSON.parse(
              requiredString(node.getProperty('key-input-type'), `${id}.key-input-type`),
            ) as ValueType)
          : undefined,
      };
      break;
    case StoryNodeType.CallEvent: {
      const outputPorts = node.findNodesByName('output-port').map((port, index) => {
        const path = `${id}.output-port[${index}]`;
        assertShape(port, path, { arguments: 1, properties: ['label', 'type'] });
        const label = optionalString(port.getProperty('label'), `${path}.label`);
        if (!label) throw new StoryFormatError(`${path}.label must be a non-empty string`);
        const typeSource = requiredString(port.getProperty('type'), `${path}.type`);
        let valueType: ValueType;
        try {
          valueType = JSON.parse(typeSource) as ValueType;
        } catch (error) {
          throw new StoryFormatError(
            `${path}.type is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return {
          id: requiredId(port.getArgument(0), 'eventOutput', `${path}.id`),
          label,
          valueType,
        };
      });
      data = {
        eventId: node.getProperty('event')
          ? requiredId(node.getProperty('event'), 'event', `${id}.event`)
          : undefined,
        arguments: Object.fromEntries(
          node.findNodesByName('argument').map((argument, index) => {
            const path = `${id}.argument[${index}]`;
            assertShape(argument, path, { arguments: 2, children: ['binding'] });
            assertBindingTargets(argument, ['value'], path);
            return [
              requiredString(argument.getArgument(0), `${path}.name`),
              expressionSource(argument.getArgument(1), `${path}.value`, argument, 'value'),
            ];
          }),
        ),
        resultVariableIds: Object.fromEntries(
          node.findNodesByName('result').map((result, index) => {
            const path = `${id}.result[${index}]`;
            assertShape(result, path, { arguments: 2 });
            return [
              requiredId(result.getArgument(0), 'eventOutput', `${path}.output`),
              requiredId(result.getArgument(1), 'variable', `${path}.variable`),
            ];
          }),
        ),
        ...(outputPorts.length > 0 ? { outputPorts } : {}),
      };
      break;
    }
    case StoryNodeType.WaitSignal:
      data = {
        signalId: node.getProperty('signal')
          ? requiredId(node.getProperty('signal'), 'signal', `${id}.signal`)
          : undefined,
        matches: Object.fromEntries(
          node.findNodesByName('match').map((match, index) => {
            const path = `${id}.match[${index}]`;
            assertShape(match, path, { arguments: 2, children: ['binding'] });
            assertBindingTargets(match, ['value'], path);
            return [
              requiredString(match.getArgument(0), `${path}.name`),
              expressionSource(match.getArgument(1), `${path}.value`, match, 'value'),
            ];
          }),
        ),
      };
      break;
    case StoryNodeType.CallSubstory:
      data = {
        chapterId: node.getProperty('chapter')
          ? requiredId(node.getProperty('chapter'), 'chapter', `${id}.chapter`)
          : undefined,
        resultVariableIds: Object.fromEntries([
          ...node.findNodesByName('result').map((result, index) => {
            const path = `${id}.result[${index}]`;
            assertShape(result, path, { arguments: 2 });
            return [
              requiredId(result.getArgument(0), 'variable', `${path}.output`),
              requiredId(result.getArgument(1), 'variable', `${path}.variable`),
            ] as const;
          }),
          ...(node.getProperty('result-variable')
            ? [
                [
                  legacyResultOutputId,
                  requiredId(
                    node.getProperty('result-variable'),
                    'variable',
                    `${id}.result-variable`,
                  ),
                ] as const,
              ]
            : []),
        ]),
        arguments: Object.fromEntries(
          node.findNodesByName('argument').map((argument, index) => {
            const path = `${id}.argument[${index}]`;
            assertShape(argument, path, { arguments: 2, children: ['binding'] });
            assertBindingTargets(argument, ['value'], path);
            return [
              requiredId(argument.getArgument(0), 'variable', `${path}.parameter`),
              expressionSource(argument.getArgument(1), `${path}.value`, argument, 'value'),
            ];
          }),
        ),
      };
      break;
    case StoryNodeType.StartStory:
    case StoryNodeType.SwitchStory:
    case StoryNodeType.ResumeStory:
    case StoryNodeType.EndStoryInstance: {
      const isResume = type === StoryNodeType.ResumeStory;
      const isEnd = type === StoryNodeType.EndStoryInstance;
      const instanceValue = node.getProperty('instance-id');
      if (!instanceValue && (isResume || isEnd)) {
        throw new StoryFormatError(`${id}.instance-id is required`);
      }
      if (instanceValue) assertBindingTargets(node, ['instance-id'], id);
      const argumentsValue = Object.fromEntries(
        node.findNodesByName('argument').map((argument, index) => {
          const path = `${id}.argument[${index}]`;
          assertShape(argument, path, { arguments: 2, children: ['binding'] });
          assertBindingTargets(argument, ['value'], path);
          return [
            requiredId(argument.getArgument(0), 'variable', `${path}.parameter`),
            expressionSource(argument.getArgument(1), `${path}.value`, argument, 'value'),
          ];
        }),
      );
      const resultVariableIds = Object.fromEntries(
        node.findNodesByName('result').map((result, index) => {
          const path = `${id}.result[${index}]`;
          assertShape(result, path, { arguments: 2 });
          return [
            requiredString(result.getArgument(0), `${path}.output`),
            requiredId(result.getArgument(1), 'variable', `${path}.variable`),
          ];
        }),
      );
      const instanceId = instanceValue
        ? expressionSource(instanceValue, `${id}.instance-id`, node, 'instance-id')
        : undefined;
      const instanceVariableId = node.getProperty('instance-variable')
        ? requiredId(node.getProperty('instance-variable'), 'variable', `${id}.instance-variable`)
        : undefined;
      if (isEnd) {
        data = { instanceId, resultVariableIds } as StoryNodeDataMap[typeof type];
      } else if (isResume) {
        data = {
          instanceId,
          resultVariableIds,
          instanceVariableId,
          waitForCompletion: node.getProperty('wait-for-completion') === 'true',
        } as StoryNodeDataMap[typeof type];
      } else {
        data = {
          storyId: node.getProperty('story')
            ? requiredId(node.getProperty('story'), 'story', `${id}.story`)
            : undefined,
          instanceId,
          arguments: argumentsValue,
          resultVariableIds,
          instanceVariableId,
          waitForCompletion: node.getProperty('wait-for-completion') === 'true',
        } as StoryNodeDataMap[typeof type];
      }
      break;
    }
    case StoryNodeType.Reroute: {
      const kind = node.getProperty('kind');
      if (kind !== undefined && kind !== 'data' && kind !== 'execution') {
        throw new StoryFormatError(`${id}.kind must be \"data\" or \"execution\"`);
      }
      if (kind === 'data') {
        const valueTypeSource = node.getProperty('value-type');
        let valueType: ValueType = { kind: 'any' };
        if (typeof valueTypeSource === 'string') {
          try {
            valueType = JSON.parse(valueTypeSource) as ValueType;
          } catch (error) {
            throw new StoryFormatError(
              `${id}.value-type is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        data = { kind: 'data', valueType };
      } else {
        data = {};
      }
      break;
    }
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
    case StoryNodeType.Return: {
      const legacyValue = optionalString(node.getProperty('value'), `${id}.value`);
      if (legacyValue) assertBindingTargets(node, ['value'], id);
      data = {
        values: Object.fromEntries([
          ...node.findNodesByName('result').map((result, index) => {
            const path = `${id}.result[${index}]`;
            assertShape(result, path, { arguments: 2, children: ['binding'] });
            assertBindingTargets(result, ['value'], path);
            return [
              requiredId(result.getArgument(0), 'variable', `${path}.output`),
              expressionSource(result.getArgument(1), `${path}.value`, result, 'value'),
            ] as const;
          }),
          ...(legacyValue && legacyOutputId
            ? [
                [
                  legacyOutputId,
                  expressionSource(legacyValue, `${id}.value`, node, 'value'),
                ] as const,
              ]
            : []),
        ]),
      };
      break;
    }
  }
  const definitionVersionValue = node.getProperty('definition-version');
  const name = optionalString(node.getProperty('name'), `${id}.name`);
  return {
    id,
    ...(name ? { name } : {}),
    type,
    definitionVersion:
      definitionVersionValue === undefined
        ? 1
        : requiredInteger(definitionVersionValue, `${id}.definition-version`),
    position,
    data: data as unknown as Readonly<Record<string, unknown>>,
  };
}

function parseGraph(graph: Node, legacyOutputId?: VariableDefinition['id']): SourceGraph {
  assertShape(graph, 'story.graph', {
    arguments: 0,
    children: [...Object.values(StoryNodeType), 'link', 'layout'],
  });
  const layouts = graph.findNodesByName('layout');
  if (layouts.length !== 1) throw new StoryFormatError('story.graph must contain one layout');
  const layout = layouts[0];
  assertShape(layout, 'story.graph.layout', { arguments: 0, children: ['position'] });
  const positions = new Map<string, { x: number; y: number }>();
  for (const position of layout.findNodesByName('position')) {
    assertShape(position, 'story.graph.layout.position', {
      arguments: 1,
      properties: ['x', 'y'],
    });
    const nodeId = requiredId(position.getArgument(0), 'node', 'layout.position.node');
    if (positions.has(nodeId)) {
      throw new StoryFormatError(`Duplicate layout position: ${nodeId}`);
    }
    positions.set(nodeId, {
      x: requiredInteger(position.getProperty('x'), `${nodeId}.x`),
      y: requiredInteger(position.getProperty('y'), `${nodeId}.y`),
    });
  }
  const nodes: SourceNode[] = [];
  const nodeIds = new Set<string>();
  const nodeNames = new Set<string>();
  for (const node of graph.children?.nodes ?? []) {
    if (node.getName() === 'link' || node.getName() === 'layout') continue;
    const nodeId = requiredId(node.getArgument(0), 'node', `${node.getName()}.id`);
    const position = positions.get(nodeId);
    if (!position) throw new StoryFormatError(`Missing layout position: ${nodeId}`);
    const sourceNode = parseSourceNode(node, position, legacyOutputId);
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
  for (const nodeId of positions.keys()) {
    if (!nodeIds.has(nodeId))
      throw new StoryFormatError(`Layout references missing node: ${nodeId}`);
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
  const serialized = requiredString(value, path);
  try {
    return parseValueTypeDescriptor(serialized);
  } catch (error) {
    throw new StoryFormatError(
      `${path} contains unsupported type: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseVariableDefault(valueType: ValueType, value: unknown, path: string): RuntimeValue {
  if (valueType.kind === 'any') {
    if (typeof value !== 'string') return value as RuntimeValue;
    try {
      return JSON.parse(value) as RuntimeValue;
    } catch {
      // Accept early files that stored an Any string without JSON encoding.
      return value;
    }
  }
  if (
    valueType.kind === 'json' ||
    valueType.kind === 'array' ||
    valueType.kind === 'map' ||
    valueType.kind === 'struct'
  ) {
    if (typeof value !== 'string') throw new StoryFormatError(`${path} must contain JSON text`);
    try {
      const parsed = JSON.parse(value) as RuntimeValue;
      if (valueType.kind === 'array' && !Array.isArray(parsed)) {
        throw new StoryFormatError(`${path} must contain a JSON array`);
      }
      if (
        (valueType.kind === 'map' || valueType.kind === 'struct') &&
        (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      ) {
        throw new StoryFormatError(`${path} must contain a JSON object`);
      }
      if (!runtimeValueMatchesType(parsed, valueType)) {
        throw new StoryFormatError(`${path} contains values that do not match ${valueType.kind}`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof StoryFormatError) throw error;
      throw new StoryFormatError(`${path} contains invalid JSON`);
    }
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    if (!runtimeValueMatchesType(value, valueType)) {
      throw new StoryFormatError(`${path} contains a value that does not match ${valueType.kind}`);
    }
    return value;
  }
  throw new StoryFormatError(`${path} must be a scalar`);
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
    const defaultValue = parseVariableDefault(
      valueType,
      node.getProperty('default'),
      `${id}.default`,
    );
    return {
      id,
      name,
      displayName: optionalString(node.getProperty('display-name'), `${id}.display-name`) ?? name,
      scope: scopeValue as VariableScope,
      valueType,
      defaultValue,
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
      properties: ['name', 'display-name', 'description', 'dialogue-style', 'portrait'],
      children: ['emotion', 'field', 'relationship', 'tag', 'meta'],
    });
    const id = requiredId(node.getArgument(0), 'character', 'character.id');
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate character ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate character name: ${name}`);
    ids.add(id);
    names.add(name);
    const fieldIds = new Set<string>();
    const fieldNames = new Set<string>();
    const tags = node.findNodesByName('tag').map((tagNode) => {
      assertShape(tagNode, `${id}.tag`, { arguments: 1 });
      const tag = requiredString(tagNode.getArgument(0), `${id}.tag`);
      if (!tag.trim()) throw new StoryFormatError(`${id}.tag cannot be empty`);
      return tag;
    });
    if (new Set(tags).size !== tags.length) throw new StoryFormatError(`Duplicate tag in ${id}`);
    const metadataKeys = new Set<string>();
    const metadata = Object.fromEntries(
      node.findNodesByName('meta').map((metaNode) => {
        assertShape(metaNode, `${id}.meta`, { arguments: 2 });
        const key = requiredString(metaNode.getArgument(0), `${id}.meta.key`);
        const value = metaNode.getArgument(1);
        if (!key.trim()) throw new StoryFormatError(`${id}.metadata key cannot be empty`);
        if (metadataKeys.has(key)) throw new StoryFormatError(`Duplicate metadata key ${key}`);
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          throw new StoryFormatError(`${id}.${key}.metadata value must be scalar`);
        }
        metadataKeys.add(key);
        return [key, value];
      }),
    );
    const fields = node.findNodesByName('field').map((fieldNode) => {
      assertShape(fieldNode, `${id}.field`, {
        arguments: 1,
        properties: ['name', 'display-name', 'type', 'default'],
      });
      const fieldId = requiredId(fieldNode.getArgument(0), 'variable', `${id}.field.id`);
      const fieldName = requiredString(fieldNode.getProperty('name'), `${fieldId}.name`);
      if (fieldIds.has(fieldId)) throw new StoryFormatError(`Duplicate field ID: ${fieldId}`);
      if (fieldNames.has(fieldName))
        throw new StoryFormatError(`Duplicate field name: ${fieldName}`);
      fieldIds.add(fieldId);
      fieldNames.add(fieldName);
      const valueType = parseValueType(fieldNode.getProperty('type'), `${fieldId}.type`);
      const defaultValue = parseVariableDefault(
        valueType,
        fieldNode.getProperty('default'),
        `${fieldId}.default`,
      );
      return {
        id: fieldId,
        name: fieldName,
        displayName:
          optionalString(fieldNode.getProperty('display-name'), `${fieldId}.display-name`) ??
          fieldName,
        scope: 'character' as const,
        valueType,
        defaultValue,
      };
    });
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
            ...(emotion.getProperty('portrait')
              ? {
                  portraitId: requiredId(
                    emotion.getProperty('portrait'),
                    'asset',
                    `${id}.${key}.portrait`,
                  ),
                }
              : {}),
          },
        ];
      }),
    );
    const relationshipTargets = new Set<string>();
    const relationships: NonNullable<CharacterSource['relationships']> = Object.fromEntries(
      node.findNodesByName('relationship').map((relationship) => {
        assertShape(relationship, `${id}.relationship`, {
          arguments: 1,
          properties: ['label', 'description'],
        });
        const targetId = requiredId(
          relationship.getArgument(0),
          'character',
          `${id}.relationship.target`,
        );
        if (targetId === id) throw new StoryFormatError(`${id} cannot relate to itself`);
        if (relationshipTargets.has(targetId)) {
          throw new StoryFormatError(`Duplicate relationship target ${targetId}`);
        }
        relationshipTargets.add(targetId);
        const label = requiredString(relationship.getProperty('label'), `${id}.${targetId}.label`);
        if (!label.trim()) throw new StoryFormatError(`${id}.${targetId}.label cannot be empty`);
        return [
          targetId,
          {
            label,
            description: optionalString(
              relationship.getProperty('description'),
              `${id}.${targetId}.description`,
            ),
          },
        ];
      }),
    );
    return {
      id,
      name,
      displayName: requiredString(node.getProperty('display-name'), `${id}.display-name`),
      ...(node.getProperty('description') !== undefined
        ? { description: optionalString(node.getProperty('description'), `${id}.description`) }
        : {}),
      ...(node.getProperty('dialogue-style') !== undefined
        ? {
            dialogueStyle: optionalString(
              node.getProperty('dialogue-style'),
              `${id}.dialogue-style`,
            ),
          }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
      ...(node.getProperty('portrait')
        ? { defaultPortraitId: requiredId(node.getProperty('portrait'), 'asset', `${id}.portrait`) }
        : {}),
      emotions,
      ...(fields.length > 0 ? { fields } : {}),
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
      ...(Object.keys(locales).length > 0 ? { locales } : {}),
    };
  });
}

function parseConditionTree(node: Node, path: string): ConditionTreeNode {
  switch (node.getName()) {
    case 'expression':
      assertShape(node, path, { arguments: 1, children: ['binding'] });
      assertBindingTargets(node, ['value'], path);
      return {
        kind: 'expression',
        expression: expressionSource(node.getArgument(0), `${path}.source`, node, 'value'),
      };
    case 'all':
    case 'any': {
      assertShape(node, path, {
        arguments: 0,
        children: ['expression', 'all', 'any', 'not', 'reference'],
      });
      const children = (node.children?.nodes ?? []).map((child, index) =>
        parseConditionTree(child, `${path}.${node.getName()}[${index}]`),
      );
      return node.getName() === 'all' ? { kind: 'all', children } : { kind: 'any', children };
    }
    case 'not': {
      assertShape(node, path, {
        arguments: 0,
        children: ['expression', 'all', 'any', 'not', 'reference'],
      });
      const children = node.children?.nodes ?? [];
      if (children.length !== 1) throw new StoryFormatError(`${path} must contain one child`);
      return { kind: 'not', child: parseConditionTree(children[0]!, `${path}.child`) };
    }
    case 'reference':
      assertShape(node, path, { arguments: 1 });
      return {
        kind: 'reference',
        conditionId: requiredId(node.getArgument(0), 'condition', `${path}.condition`),
      };
    default:
      throw new StoryFormatError(`${path} contains unsupported condition node ${node.getName()}`);
  }
}

function parseConditions(container: Node | undefined): ConditionSource[] {
  if (!container) return [];
  assertShape(container, 'story.conditions', { arguments: 0, children: ['condition'] });
  const ids = new Set<string>();
  const names = new Set<string>();
  return container.findNodesByName('condition').map((node, index) => {
    const path = `story.conditions.condition[${index}]`;
    assertShape(node, path, {
      arguments: 1,
      properties: ['name', 'display-name', 'description'],
      children: ['expression', 'all', 'any', 'not', 'reference'],
    });
    const id = requiredId(node.getArgument(0), 'condition', `${path}.id`);
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate condition ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate condition name: ${name}`);
    const children = node.children?.nodes ?? [];
    if (children.length !== 1) throw new StoryFormatError(`${path} must contain one root node`);
    ids.add(id);
    names.add(name);
    return {
      id,
      name,
      displayName: optionalString(node.getProperty('display-name'), `${id}.display-name`) ?? name,
      description: optionalString(node.getProperty('description'), `${id}.description`),
      root: parseConditionTree(children[0]!, `${path}.root`),
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
      properties: ['name', 'display-name', 'return-type'],
      children: ['parameter', 'output', 'local', 'graph'],
    });
    if (node.findNodesByName('graph').length !== 1) {
      throw new StoryFormatError('Chapter must contain exactly one graph');
    }
    const id = requiredId(node.getArgument(0), 'chapter', 'chapter.id');
    const legacyReturnType = node.getProperty('return-type')
      ? parseValueType(node.getProperty('return-type'), `${id}.return-type`)
      : undefined;
    const legacyOutputId = legacyReturnType
      ? (`v_${id.slice(id.indexOf('_') + 1)}_result` as VariableDefinition['id'])
      : undefined;
    const name = requiredString(node.getProperty('name'), `${id}.name`);
    if (ids.has(id)) throw new StoryFormatError(`Duplicate chapter ID: ${id}`);
    if (names.has(name)) throw new StoryFormatError(`Duplicate chapter name: ${name}`);
    ids.add(id);
    names.add(name);
    const interfaceIds = new Set<string>();
    const interfaceNames = new Set<string>();
    const parseInterfaceVariable = (
      variableNode: Node,
      kind: 'parameter' | 'output' | 'local',
    ): VariableDefinition => {
      const path = `${id}.${kind}`;
      assertShape(variableNode, path, {
        arguments: 1,
        properties: ['name', 'display-name', 'type', 'default'],
      });
      const variableId = requiredId(variableNode.getArgument(0), 'variable', `${path}.id`);
      const variableName = requiredString(variableNode.getProperty('name'), `${path}.name`);
      if (interfaceIds.has(variableId))
        throw new StoryFormatError(`Duplicate chapter variable ID: ${variableId}`);
      if (interfaceNames.has(variableName))
        throw new StoryFormatError(`Duplicate chapter variable name: ${variableName}`);
      interfaceIds.add(variableId);
      interfaceNames.add(variableName);
      const valueType = parseValueType(variableNode.getProperty('type'), `${path}.type`);
      const defaultValue = parseVariableDefault(
        valueType,
        variableNode.getProperty('default'),
        `${path}.default`,
      );
      return {
        id: variableId,
        name: variableName,
        displayName:
          optionalString(variableNode.getProperty('display-name'), `${path}.display-name`) ??
          variableName,
        scope: 'local',
        valueType,
        defaultValue,
      };
    };
    return {
      id,
      name,
      displayName: optionalString(node.getProperty('display-name'), `${id}.display-name`) ?? name,
      parameters: node.findNodesByName('parameter').map((parameter) => ({
        direction: 'input' as const,
        variable: parseInterfaceVariable(parameter, 'parameter'),
      })),
      outputs: [
        ...node.findNodesByName('output').map((output) => ({
          direction: 'output' as const,
          variable: parseInterfaceVariable(output, 'output'),
        })),
        ...(legacyReturnType && legacyOutputId
          ? [
              {
                direction: 'output' as const,
                variable: {
                  id: legacyOutputId,
                  name: 'result',
                  displayName: 'Result',
                  scope: 'local' as const,
                  valueType: legacyReturnType,
                  defaultValue:
                    legacyReturnType.kind === 'boolean'
                      ? false
                      : legacyReturnType.kind === 'number'
                        ? 0
                        : '',
                },
              },
            ]
          : []),
      ],
      localVariables: node
        .findNodesByName('local')
        .map((local) => parseInterfaceVariable(local, 'local')),
      graph: parseGraph(node.findNodeByName('graph')!, legacyOutputId),
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
    children: ['variables', 'characters', 'assets', 'conditions', 'chapters', 'graph'],
  });
  if (story.findNodesByName('graph').length !== 1) {
    throw new StoryFormatError('Story must contain exactly one graph');
  }
  for (const section of ['variables', 'characters', 'assets', 'conditions', 'chapters'] as const) {
    if (story.findNodesByName(section).length > 1) {
      throw new StoryFormatError(`Story may contain at most one ${section} section`);
    }
  }
  const formatName = requiredString(story.getProperty('format'), 'story.format');
  const version = requiredInteger(story.getProperty('version'), 'story.version');
  if (formatName !== STORY_SOURCE_FORMAT || ![4, STORY_SOURCE_VERSION].includes(version)) {
    throw new StoryFormatError(
      `Unsupported Story Source format or version: ${formatName}@${version}`,
    );
  }
  const name = requiredString(story.getProperty('name'), 'story.name');
  const conditionsContainer = story.findNodeByName('conditions');
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
    ...(conditionsContainer ? { conditions: parseConditions(conditionsContainer) } : {}),
    chapters: parseChapters(story.findNodeByName('chapters')),
    events: [],
  };
  for (const graph of [source.root, ...source.chapters.map((chapter) => chapter.graph)]) {
    for (const node of graph.nodes) {
      if (node.type !== StoryNodeType.CallSubstory) continue;
      const data = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      const legacyTarget = data.resultVariableIds?.[legacyResultOutputId];
      if (!legacyTarget || !data.chapterId) continue;
      const outputId = source.chapters.find((chapter) => chapter.id === data.chapterId)?.outputs[0]
        ?.variable.id;
      if (!outputId) continue;
      node.data = {
        ...data,
        resultVariableIds: { [outputId]: legacyTarget },
      } as unknown as Readonly<Record<string, unknown>>;
    }
  }
  validateStoryReferences(source);
  return source;
}
