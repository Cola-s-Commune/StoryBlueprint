import {
  StoryNodeType,
  type ChapterId,
  type ExpressionSource,
  type NodeId,
  type StoryNodeDataMap,
  type CharacterSource,
  type TextTemplateSource,
  type VariableDefinition,
  type VariableId,
} from '@story-blueprint/common';
import type { EditorGraphNode, EditorGraphState } from './editorGraph';

export type VariableReferenceKind = 'target' | 'expression' | 'text-template';

export interface VariableReference {
  graphId: 'root' | ChapterId;
  graphLabel: string;
  nodeId: NodeId;
  nodeType: StoryNodeType;
  nodeLabel: string;
  field: string;
  kind: VariableReferenceKind;
}

export interface VariableReferenceGraph {
  id: 'root' | ChapterId;
  label: string;
  graph: EditorGraphState;
}

interface IdentifierRange {
  start: number;
  end: number;
  value: string;
}

function expressionIdentifiers(source: string): IdentifierRange[] {
  const result: IdentifierRange[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (/[a-zA-Z_]/.test(character)) {
      const start = index++;
      while (/[a-zA-Z0-9_]/.test(source[index] ?? '')) index += 1;
      result.push({ start, end: index, value: source.slice(start, index) });
      continue;
    }
    index += 1;
  }
  return result;
}

interface QualifiedIdentifierRange extends IdentifierRange {
  characterName: string;
  fieldName: string;
}

function qualifiedExpressionIdentifiers(source: string): QualifiedIdentifierRange[] {
  const identifiers = expressionIdentifiers(source);
  const result: QualifiedIdentifierRange[] = [];
  for (let index = 0; index < identifiers.length - 1; index += 1) {
    const left = identifiers[index]!;
    const right = identifiers[index + 1]!;
    if (source.slice(left.end, right.start) !== '.') continue;
    result.push({
      start: left.start,
      end: right.end,
      value: source.slice(left.start, right.end),
      characterName: left.value,
      fieldName: right.value,
    });
  }
  return result;
}

export function bindCharacterFieldExpression(
  expression: ExpressionSource,
  characters: readonly CharacterSource[],
): ExpressionSource {
  const bindings = { ...expression.bindings };
  for (const identifier of qualifiedExpressionIdentifiers(expression.source)) {
    const character = characters.find((candidate) => candidate.name === identifier.characterName);
    const field = character?.fields?.find((candidate) => candidate.name === identifier.fieldName);
    if (field) bindings[identifier.value] = field.id;
  }
  return { ...expression, bindings };
}

export function expressionReferencesCharacterField(
  expression: ExpressionSource,
  characterName: string,
  field: Pick<VariableDefinition, 'id' | 'name'>,
): boolean {
  return qualifiedExpressionIdentifiers(expression.source).some((identifier) => {
    const boundId = expression.bindings[identifier.value];
    return (
      boundId === field.id ||
      (boundId === undefined &&
        identifier.characterName === characterName &&
        identifier.fieldName === field.name)
    );
  });
}

function renameCharacterFieldExpression(
  expression: ExpressionSource,
  fieldId: VariableId,
  oldQualifiedName: string,
  newQualifiedName: string,
): ExpressionSource {
  const ranges = qualifiedExpressionIdentifiers(expression.source).filter((identifier) => {
    const boundId = expression.bindings[identifier.value];
    return boundId === fieldId || (boundId === undefined && identifier.value === oldQualifiedName);
  });
  if (ranges.length === 0 && expression.bindings[oldQualifiedName] !== fieldId) return expression;
  let source = expression.source;
  for (const range of ranges.reverse()) {
    source = `${source.slice(0, range.start)}${newQualifiedName}${source.slice(range.end)}`;
  }
  const bindings = { ...expression.bindings };
  if (bindings[oldQualifiedName] === fieldId) delete bindings[oldQualifiedName];
  bindings[newQualifiedName] = fieldId;
  return { source, bindings };
}

function identifierReferencesVariable(
  identifier: string,
  expression: ExpressionSource,
  variable: Pick<VariableDefinition, 'id' | 'name'>,
): boolean {
  const boundVariableId = expression.bindings[identifier];
  return (
    boundVariableId === variable.id ||
    (boundVariableId === undefined && identifier === variable.name)
  );
}

export function expressionReferencesVariable(
  expression: ExpressionSource,
  variable: Pick<VariableDefinition, 'id' | 'name'>,
): boolean {
  return expressionIdentifiers(expression.source).some((identifier) =>
    identifierReferencesVariable(identifier.value, expression, variable),
  );
}

export function renameExpressionVariable(
  expression: ExpressionSource,
  variableId: VariableId,
  oldName: string,
  newName: string,
): ExpressionSource {
  const ranges = expressionIdentifiers(expression.source).filter(
    (identifier) =>
      identifier.value === oldName &&
      (expression.bindings[identifier.value] === undefined ||
        expression.bindings[identifier.value] === variableId),
  );
  if (ranges.length === 0 && expression.bindings[oldName] !== variableId) return expression;
  let source = expression.source;
  for (const range of ranges.reverse()) {
    source = `${source.slice(0, range.start)}${newName}${source.slice(range.end)}`;
  }
  const bindings = { ...expression.bindings };
  if (bindings[oldName] === variableId) {
    delete bindings[oldName];
    bindings[newName] = variableId;
  }
  return { source, bindings };
}

function mapTemplateExpressions(source: string, transform: (expression: string) => string): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('{{', index) || source.startsWith('}}', index)) {
      result += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (source[index] !== '{') {
      result += source[index++];
      continue;
    }
    const end = source.indexOf('}', index + 1);
    if (end < 0) return result + source.slice(index);
    result += `{${transform(source.slice(index + 1, end))}}`;
    index = end + 1;
  }
  return result;
}

export function templateReferencesVariable(
  source: string,
  variable: Pick<VariableDefinition, 'id' | 'name'>,
): boolean {
  let referenced = false;
  mapTemplateExpressions(source, (expression) => {
    if (expressionReferencesVariable({ source: expression, bindings: {} }, variable)) {
      referenced = true;
    }
    return expression;
  });
  return referenced;
}

export function templateReferencesCharacterField(
  template: TextTemplateSource,
  characterName: string,
  field: Pick<VariableDefinition, 'id' | 'name'>,
): boolean {
  let referenced = false;
  mapTemplateExpressions(template.source, (source) => {
    if (
      expressionReferencesCharacterField(
        { source, bindings: template.bindings ?? {} },
        characterName,
        field,
      )
    ) {
      referenced = true;
    }
    return source;
  });
  return referenced;
}

function renameCharacterFieldTemplate(
  template: TextTemplateSource,
  fieldId: VariableId,
  oldQualifiedName: string,
  newQualifiedName: string,
): TextTemplateSource {
  let bindings = { ...(template.bindings ?? {}) };
  const source = mapTemplateExpressions(template.source, (fragment) => {
    const renamed = renameCharacterFieldExpression(
      { source: fragment, bindings },
      fieldId,
      oldQualifiedName,
      newQualifiedName,
    );
    bindings = { ...renamed.bindings };
    return renamed.source;
  });
  return Object.keys(bindings).length > 0 ? { source, bindings } : { source };
}

function bindCharacterFieldTemplate(
  template: TextTemplateSource,
  characters: readonly CharacterSource[],
): TextTemplateSource {
  let bindings = { ...(template.bindings ?? {}) };
  mapTemplateExpressions(template.source, (source) => {
    bindings = bindCharacterFieldExpression({ source, bindings }, characters).bindings;
    return source;
  });
  return Object.keys(bindings).length > 0 ? { ...template, bindings } : { source: template.source };
}

export function renameTemplateVariable(source: string, oldName: string, newName: string): string {
  return mapTemplateExpressions(
    source,
    (expression) =>
      renameExpressionVariable(
        { source: expression, bindings: {} },
        '' as VariableId,
        oldName,
        newName,
      ).source,
  );
}

function nodeLabel(node: EditorGraphNode): string {
  return node.name?.trim() || node.type.replaceAll('-', ' ');
}

export function expressionEntries(
  node: EditorGraphNode,
): Array<[field: string, value: ExpressionSource]> {
  switch (node.type) {
    case StoryNodeType.Choice: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      return data.options.flatMap<[string, ExpressionSource]>((option, index) => [
        ...(option.visibleIf
          ? [[`Option ${index + 1} Visible If`, option.visibleIf] as [string, ExpressionSource]]
          : []),
        ...(option.enabledIf
          ? [[`Option ${index + 1} Enabled If`, option.enabledIf] as [string, ExpressionSource]]
          : []),
      ]);
    }
    case StoryNodeType.Branch:
      return [['Condition', (node.data as StoryNodeDataMap[StoryNodeType.Branch]).condition]];
    case StoryNodeType.SetVariable:
      return [['Value', (node.data as StoryNodeDataMap[StoryNodeType.SetVariable]).value]];
    case StoryNodeType.CallEvent:
      return Object.entries((node.data as StoryNodeDataMap[StoryNodeType.CallEvent]).arguments).map(
        ([name, value]) => [`Argument ${name}`, value],
      );
    case StoryNodeType.WaitSignal:
      return Object.entries((node.data as StoryNodeDataMap[StoryNodeType.WaitSignal]).matches).map(
        ([name, value]) => [`Match ${name}`, value],
      );
    default:
      return [];
  }
}

export function templateEntries(
  node: EditorGraphNode,
): Array<[field: string, value: TextTemplateSource]> {
  if (node.type === StoryNodeType.Dialogue) {
    return (node.data as StoryNodeDataMap[StoryNodeType.Dialogue]).lines.map((line, index) => [
      `Line ${index + 1}`,
      line.text,
    ]);
  }
  if (node.type === StoryNodeType.Choice) {
    const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
    return [
      ['Prompt', data.prompt],
      ...data.options.map(
        (option, index) =>
          [`Option ${index + 1} Text`, option.text] as [string, TextTemplateSource],
      ),
    ];
  }
  return [];
}

export function findVariableReferences(
  variable: Pick<VariableDefinition, 'id' | 'name'>,
  graphs: readonly VariableReferenceGraph[],
): VariableReference[] {
  const references: VariableReference[] = [];
  const add = (
    owner: VariableReferenceGraph,
    node: EditorGraphNode,
    field: string,
    kind: VariableReferenceKind,
  ) =>
    references.push({
      graphId: owner.id,
      graphLabel: owner.label,
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: nodeLabel(node),
      field,
      kind,
    });
  for (const owner of graphs) {
    for (const node of owner.graph.nodes) {
      if (
        (node.type === StoryNodeType.GetVariable || node.type === StoryNodeType.SetVariable) &&
        node.data.variableId === variable.id
      ) {
        add(owner, node, 'Variable', 'target');
      }
      for (const [field, expression] of expressionEntries(node)) {
        if (expressionReferencesVariable(expression, variable)) {
          add(owner, node, field, 'expression');
        }
      }
      for (const [field, template] of templateEntries(node)) {
        if (templateReferencesVariable(template.source, variable)) {
          add(owner, node, field, 'text-template');
        }
      }
    }
  }
  return references;
}

export function renameVariableReferencesInNode(
  node: EditorGraphNode,
  variableId: VariableId,
  oldName: string,
  newName: string,
): EditorGraphNode {
  switch (node.type) {
    case StoryNodeType.Dialogue: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
      return {
        ...node,
        data: {
          ...node.data,
          lines: data.lines.map((line) => ({
            ...line,
            text: { source: renameTemplateVariable(line.text.source, oldName, newName) },
          })),
        },
      };
    }
    case StoryNodeType.Choice: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      return {
        ...node,
        data: {
          ...node.data,
          prompt: { source: renameTemplateVariable(data.prompt.source, oldName, newName) },
          options: data.options.map((option) => ({
            ...option,
            text: { source: renameTemplateVariable(option.text.source, oldName, newName) },
            visibleIf: option.visibleIf
              ? renameExpressionVariable(option.visibleIf, variableId, oldName, newName)
              : undefined,
            enabledIf: option.enabledIf
              ? renameExpressionVariable(option.enabledIf, variableId, oldName, newName)
              : undefined,
          })),
        },
      };
    }
    case StoryNodeType.Branch: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Branch];
      return {
        ...node,
        data: {
          ...node.data,
          condition: renameExpressionVariable(data.condition, variableId, oldName, newName),
        },
      };
    }
    case StoryNodeType.SetVariable: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
      return {
        ...node,
        data: {
          ...node.data,
          value: renameExpressionVariable(data.value, variableId, oldName, newName),
        },
      };
    }
    case StoryNodeType.CallEvent: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
      return {
        ...node,
        data: {
          ...node.data,
          arguments: Object.fromEntries(
            Object.entries(data.arguments).map(([name, value]) => [
              name,
              renameExpressionVariable(value, variableId, oldName, newName),
            ]),
          ),
        },
      };
    }
    case StoryNodeType.WaitSignal: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
      return {
        ...node,
        data: {
          ...node.data,
          matches: Object.fromEntries(
            Object.entries(data.matches).map(([name, value]) => [
              name,
              renameExpressionVariable(value, variableId, oldName, newName),
            ]),
          ),
        },
      };
    }
    default:
      return node;
  }
}

export function renameCharacterFieldReferencesInNode(
  node: EditorGraphNode,
  fieldId: VariableId,
  oldQualifiedName: string,
  newQualifiedName: string,
): EditorGraphNode {
  const renameExpression = (expression: ExpressionSource) =>
    renameCharacterFieldExpression(expression, fieldId, oldQualifiedName, newQualifiedName);
  const renameTemplate = (template: TextTemplateSource) =>
    renameCharacterFieldTemplate(template, fieldId, oldQualifiedName, newQualifiedName);
  switch (node.type) {
    case StoryNodeType.Dialogue: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
      return {
        ...node,
        data: {
          ...node.data,
          lines: data.lines.map((line) => ({ ...line, text: renameTemplate(line.text) })),
        },
      };
    }
    case StoryNodeType.Choice: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      return {
        ...node,
        data: {
          ...node.data,
          prompt: renameTemplate(data.prompt),
          options: data.options.map((option) => ({
            ...option,
            text: renameTemplate(option.text),
            visibleIf: option.visibleIf ? renameExpression(option.visibleIf) : undefined,
            enabledIf: option.enabledIf ? renameExpression(option.enabledIf) : undefined,
          })),
        },
      };
    }
    case StoryNodeType.Branch: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Branch];
      return { ...node, data: { ...node.data, condition: renameExpression(data.condition) } };
    }
    case StoryNodeType.SetVariable: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
      return { ...node, data: { ...node.data, value: renameExpression(data.value) } };
    }
    case StoryNodeType.CallEvent: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
      return {
        ...node,
        data: {
          ...node.data,
          arguments: Object.fromEntries(
            Object.entries(data.arguments).map(([name, value]) => [name, renameExpression(value)]),
          ),
        },
      };
    }
    case StoryNodeType.WaitSignal: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
      return {
        ...node,
        data: {
          ...node.data,
          matches: Object.fromEntries(
            Object.entries(data.matches).map(([name, value]) => [name, renameExpression(value)]),
          ),
        },
      };
    }
    default:
      return node;
  }
}

export function bindCharacterFieldReferencesInNode(
  node: EditorGraphNode,
  characters: readonly CharacterSource[],
): EditorGraphNode {
  const bindExpression = (expression: ExpressionSource) =>
    bindCharacterFieldExpression(expression, characters);
  const bindTemplate = (template: TextTemplateSource) =>
    bindCharacterFieldTemplate(template, characters);
  switch (node.type) {
    case StoryNodeType.Dialogue: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
      return {
        ...node,
        data: {
          ...node.data,
          lines: data.lines.map((line) => ({ ...line, text: bindTemplate(line.text) })),
        },
      };
    }
    case StoryNodeType.Choice: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      return {
        ...node,
        data: {
          ...node.data,
          prompt: bindTemplate(data.prompt),
          options: data.options.map((option) => ({
            ...option,
            text: bindTemplate(option.text),
            visibleIf: option.visibleIf ? bindExpression(option.visibleIf) : undefined,
            enabledIf: option.enabledIf ? bindExpression(option.enabledIf) : undefined,
          })),
        },
      };
    }
    case StoryNodeType.Branch: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Branch];
      return { ...node, data: { ...node.data, condition: bindExpression(data.condition) } };
    }
    case StoryNodeType.SetVariable: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
      return { ...node, data: { ...node.data, value: bindExpression(data.value) } };
    }
    case StoryNodeType.CallEvent: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
      return {
        ...node,
        data: {
          ...node.data,
          arguments: Object.fromEntries(
            Object.entries(data.arguments).map(([name, value]) => [name, bindExpression(value)]),
          ),
        },
      };
    }
    case StoryNodeType.WaitSignal: {
      const data = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
      return {
        ...node,
        data: {
          ...node.data,
          matches: Object.fromEntries(
            Object.entries(data.matches).map(([name, value]) => [name, bindExpression(value)]),
          ),
        },
      };
    }
    default:
      return node;
  }
}
