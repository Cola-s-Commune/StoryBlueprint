import {
  StoryNodeType,
  type ChapterId,
  type ExpressionSource,
  type NodeId,
  type StoryNodeDataMap,
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

function expressionEntries(node: EditorGraphNode): Array<[field: string, value: ExpressionSource]> {
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

function templateEntries(node: EditorGraphNode): Array<[field: string, value: string]> {
  if (node.type === StoryNodeType.Dialogue) {
    return (node.data as StoryNodeDataMap[StoryNodeType.Dialogue]).lines.map((line, index) => [
      `Line ${index + 1}`,
      line.text.source,
    ]);
  }
  if (node.type === StoryNodeType.Choice) {
    const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
    return [
      ['Prompt', data.prompt.source],
      ...data.options.map(
        (option, index) => [`Option ${index + 1} Text`, option.text.source] as [string, string],
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
      for (const [field, source] of templateEntries(node)) {
        if (templateReferencesVariable(source, variable)) {
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
