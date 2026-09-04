import {
  collectEngineResourceValueReferences,
  isStableId,
  StoryNodeType,
  type AssetId,
  type ChapterId,
  type CharacterId,
  type CharacterSource,
  type EngineFieldType,
  type EngineTypeDefinition,
  type EventSource,
  type NodeId,
  type RuntimeValue,
  type SignalSource,
  type StoryId,
  type StoryNodeDataMap,
  type VariableDefinition,
  type VariableId,
  type ValueType,
} from '@story-blueprint/common';
import type { EditorGraphNode, EditorGraphState } from './editorGraph';
import {
  expressionEntries,
  expressionReferencesCharacterField,
  templateEntries,
  templateReferencesCharacterField,
} from './variableReferences';

export interface ResourceReferenceStory {
  id: StoryId;
  label: string;
  rootGraph: EditorGraphState;
  variables?: readonly VariableDefinition[];
  chapters: readonly {
    id: ChapterId;
    label: string;
    graph: EditorGraphState;
    parameters?: readonly VariableDefinition[];
    outputs?: readonly VariableDefinition[];
    localVariables?: readonly VariableDefinition[];
  }[];
}

export interface StoryResourceReferenceContext {
  engineTypes: readonly EngineTypeDefinition[];
  projectVariables: readonly VariableDefinition[];
  events: readonly EventSource[];
  signals: readonly SignalSource[];
}

export interface ResourceReferenceCharacter {
  character: CharacterSource;
  storyId?: StoryId;
  storyLabel?: string;
}

export type StoryResourceReferenceTarget =
  | {
      kind: 'node';
      storyId: StoryId;
      graphId: 'root' | ChapterId;
      nodeId: NodeId;
    }
  | { kind: 'character'; characterId: CharacterId; storyId?: StoryId }
  | { kind: 'variable'; variableId: VariableId; storyId?: StoryId }
  | { kind: 'engine-type'; name: string };

export interface StoryResourceReference {
  id: string;
  label: string;
  location: string;
  field: string;
  target: StoryResourceReferenceTarget;
}

export interface StoryResourceReferenceIndex {
  characters: ReadonlyMap<CharacterId, readonly StoryResourceReference[]>;
  emotions: ReadonlyMap<string, readonly StoryResourceReference[]>;
  assets: ReadonlyMap<AssetId, readonly StoryResourceReference[]>;
  characterFields: ReadonlyMap<VariableId, readonly StoryResourceReference[]>;
}

export function emotionReferenceKey(characterId: CharacterId, emotion: string): string {
  return `${characterId}\0${emotion}`;
}

function nodeLabel(node: EditorGraphNode): string {
  return node.name?.trim() || node.type.replaceAll('-', ' ');
}

function storyGraphs(story: ResourceReferenceStory) {
  return [
    {
      id: 'root' as const,
      label: 'Main Story',
      graph: story.rootGraph,
      variables: story.variables ?? [],
    },
    ...story.chapters.map((chapter) => ({
      ...chapter,
      variables: [
        ...(chapter.parameters ?? []),
        ...(chapter.outputs ?? []),
        ...(chapter.localVariables ?? []),
      ],
    })),
  ];
}

function dialogueLines(node: EditorGraphNode) {
  return node.type === StoryNodeType.Dialogue
    ? (node.data as StoryNodeDataMap[StoryNodeType.Dialogue]).lines
    : [];
}

function addReference<Key>(
  index: Map<Key, StoryResourceReference[]>,
  key: Key,
  reference: StoryResourceReference,
): void {
  const references = index.get(key);
  if (references) references.push(reference);
  else index.set(key, [reference]);
}

function parseJsonValue(source: string): RuntimeValue | undefined {
  try {
    return JSON.parse(source) as RuntimeValue;
  } catch {
    return undefined;
  }
}

function visitEngineResourceReferences(
  value: RuntimeValue,
  type: EngineFieldType,
  definitions: readonly EngineTypeDefinition[],
  path: string,
  visit: (kind: 'character' | 'asset', id: string, path: string) => void,
): void {
  for (const reference of collectEngineResourceValueReferences(value, type, definitions, path)) {
    visit(reference.kind, reference.id, reference.path);
  }
}

function visitTypedResourceReferences(
  value: RuntimeValue,
  type: ValueType,
  path: string,
  visit: (kind: 'character' | 'asset', id: string, path: string) => void,
): void {
  if (value === null) return;
  if (
    type.kind === 'character-ref' &&
    typeof value === 'string' &&
    isStableId(value, 'character')
  ) {
    visit('character', value, path);
    return;
  }
  if (type.kind === 'asset-ref' && typeof value === 'string' && isStableId(value, 'asset')) {
    visit('asset', value, path);
    return;
  }
  if (type.kind === 'array' && Array.isArray(value) && type.elementType) {
    value.forEach((item, index) =>
      visitTypedResourceReferences(item, type.elementType!, `${path}[${index}]`, visit),
    );
    return;
  }
  if (type.kind === 'map' && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (type.keyType === 'character-ref' && isStableId(key, 'character'))
        visit('character', key, `${path}.${key}.[key]`);
      if (type.keyType === 'asset-ref' && isStableId(key, 'asset'))
        visit('asset', key, `${path}.${key}.[key]`);
      if (type.valueType)
        visitTypedResourceReferences(item, type.valueType, `${path}.${key}`, visit);
    }
  }
}

export function buildStoryResourceReferenceIndex(
  stories: readonly ResourceReferenceStory[],
  characters: readonly ResourceReferenceCharacter[],
  context: StoryResourceReferenceContext = {
    engineTypes: [],
    projectVariables: [],
    events: [],
    signals: [],
  },
): StoryResourceReferenceIndex {
  const characterIndex = new Map<CharacterId, StoryResourceReference[]>();
  const emotionIndex = new Map<string, StoryResourceReference[]>();
  const assetIndex = new Map<AssetId, StoryResourceReference[]>();
  const characterFieldIndex = new Map<VariableId, StoryResourceReference[]>();
  const uniqueCharacters = [
    ...new Map(characters.map((owner) => [owner.character.id, owner.character])).values(),
  ];
  const addEngineReferences = (
    value: RuntimeValue,
    typeName: string,
    reference: (field: string) => StoryResourceReference,
    fieldPrefix = '',
  ) => {
    if (!context.engineTypes.some((candidate) => candidate.name === typeName)) return;
    visitEngineResourceReferences(
      value,
      { kind: 'object', typeName },
      context.engineTypes,
      fieldPrefix,
      (kind, id, path) => {
        if (kind === 'character') {
          addReference(characterIndex, id as CharacterId, reference(path || 'Character Reference'));
        } else {
          addReference(assetIndex, id as AssetId, reference(path || 'Asset Reference'));
        }
      },
    );
  };
  const scanVariable = (
    variable: VariableDefinition,
    reference: (field: string) => StoryResourceReference,
  ) => {
    if (variable.valueType.kind === 'json') {
      addEngineReferences(variable.defaultValue, variable.valueType.name, reference, 'Default');
    }
    if (
      variable.valueType.kind === 'character-ref' ||
      variable.valueType.kind === 'asset-ref' ||
      variable.valueType.kind === 'array' ||
      variable.valueType.kind === 'map'
    ) {
      visitTypedResourceReferences(
        variable.defaultValue,
        variable.valueType,
        'Default',
        (kind, id, path) => {
          if (kind === 'character')
            addReference(characterIndex, id as CharacterId, reference(path));
          else addReference(assetIndex, id as AssetId, reference(path));
        },
      );
    }
  };
  for (const variable of context.projectVariables) {
    scanVariable(variable, (field) => ({
      id: `project-variable:${variable.id}:${field}`,
      label: variable.displayName,
      location: 'Project Variables',
      field,
      target: { kind: 'variable', variableId: variable.id },
    }));
  }
  for (const definition of context.engineTypes) {
    for (const field of definition.fields) {
      visitEngineResourceReferences(
        field.defaultValue,
        field.type,
        context.engineTypes,
        `${field.name}.default`,
        (kind, id, path) => {
          const reference: StoryResourceReference = {
            id: `engine-type:${definition.id}:${field.id}:${path}`,
            label: definition.displayName,
            location: 'Engine Types',
            field: path,
            target: { kind: 'engine-type', name: definition.name },
          };
          if (kind === 'character') addReference(characterIndex, id as CharacterId, reference);
          else addReference(assetIndex, id as AssetId, reference);
        },
      );
    }
  }
  for (const story of stories) {
    for (const variable of story.variables ?? []) {
      scanVariable(variable, (field) => ({
        id: `${story.id}:variable:${variable.id}:${field}`,
        label: variable.displayName,
        location: `${story.label} · Variables`,
        field,
        target: { kind: 'variable', variableId: variable.id, storyId: story.id },
      }));
    }
    for (const chapter of story.chapters) {
      for (const variable of [
        ...(chapter.parameters ?? []),
        ...(chapter.outputs ?? []),
        ...(chapter.localVariables ?? []),
      ]) {
        scanVariable(variable, (field) => ({
          id: `${story.id}:${chapter.id}:variable:${variable.id}:${field}`,
          label: variable.displayName,
          location: `${story.label} · ${chapter.label}`,
          field,
          target: { kind: 'variable', variableId: variable.id, storyId: story.id },
        }));
      }
    }
    for (const graph of storyGraphs(story)) {
      for (const node of graph.graph.nodes) {
        const reference = (field: string): StoryResourceReference => ({
          id: `${story.id}:${graph.id}:${node.id}:${field}`,
          label: nodeLabel(node),
          location: `${story.label} · ${graph.label}`,
          field,
          target: {
            kind: 'node',
            storyId: story.id,
            graphId: graph.id,
            nodeId: node.id,
          },
        });
        dialogueLines(node).forEach((line, index) => {
          if (line.speakerId) {
            addReference(characterIndex, line.speakerId, reference(`Line ${index + 1} Speaker`));
            if (line.emotion) {
              addReference(
                emotionIndex,
                emotionReferenceKey(line.speakerId, line.emotion),
                reference(`Line ${index + 1} Emotion`),
              );
            }
          }
          if (line.voiceId) {
            addReference(assetIndex, line.voiceId, reference(`Line ${index + 1} Voice`));
          }
        });
        if (node.type === StoryNodeType.Narration) {
          const narration = node.data as StoryNodeDataMap[StoryNodeType.Narration];
          if (narration.voiceId) {
            addReference(assetIndex, narration.voiceId, reference('Narration Voice'));
          }
        }
        const scanExpression = (
          expression: { source: string } | undefined,
          valueType: VariableDefinition['valueType'] | undefined,
          field: string,
        ) => {
          if (!expression || !valueType) return;
          const value = parseJsonValue(expression.source);
          if (value === undefined) return;
          if (valueType.kind === 'json')
            addEngineReferences(value, valueType.name, reference, field);
          else if (
            valueType.kind === 'character-ref' ||
            valueType.kind === 'asset-ref' ||
            valueType.kind === 'array' ||
            valueType.kind === 'map'
          ) {
            visitTypedResourceReferences(value, valueType, field, (kind, id, path) => {
              if (kind === 'character')
                addReference(characterIndex, id as CharacterId, reference(path));
              else addReference(assetIndex, id as AssetId, reference(path));
            });
          }
        };
        if (node.type === StoryNodeType.SetVariable) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.SetVariable];
          const variable = [...graph.variables, ...context.projectVariables].find(
            (candidate) => candidate.id === data.variableId,
          );
          scanExpression(data.value, variable?.valueType, 'Set Variable');
        }
        if (node.type === StoryNodeType.CallEvent) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.CallEvent];
          const event = context.events.find((candidate) => candidate.id === data.eventId);
          for (const [name, expression] of Object.entries(data.arguments)) {
            scanExpression(
              expression,
              event?.parameters.find((parameter) => parameter.name === name)?.valueType,
              `Event.${name}`,
            );
          }
        }
        if (node.type === StoryNodeType.WaitSignal) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.WaitSignal];
          const signal = context.signals.find((candidate) => candidate.id === data.signalId);
          for (const [name, expression] of Object.entries(data.matches)) {
            scanExpression(
              expression,
              signal?.parameters.find((parameter) => parameter.name === name)?.valueType,
              `Signal.${name}`,
            );
          }
        }
        if (node.type === StoryNodeType.CallSubstory) {
          const data = node.data as StoryNodeDataMap[StoryNodeType.CallSubstory];
          const chapter = story.chapters.find((candidate) => candidate.id === data.chapterId);
          for (const [id, expression] of Object.entries(data.arguments ?? {})) {
            scanExpression(
              expression,
              chapter?.parameters?.find((parameter) => parameter.id === id)?.valueType,
              `Substory Input.${id}`,
            );
          }
        }
        if (
          node.type === StoryNodeType.StartStory ||
          node.type === StoryNodeType.SwitchStory ||
          node.type === StoryNodeType.ResumeStory ||
          node.type === StoryNodeType.EndStoryInstance
        ) {
          const data = node.data as {
            instanceId?: { source: string };
            arguments?: Readonly<Record<string, { source: string }>>;
          };
          scanExpression(data.instanceId, { kind: 'any' }, 'Story Instance ID');
          for (const [id, expression] of Object.entries(data.arguments ?? {})) {
            scanExpression(expression, { kind: 'any' }, `Story Argument.${id}`);
          }
        }
        if (node.type === StoryNodeType.Return && graph.id !== 'root') {
          const data = node.data as StoryNodeDataMap[StoryNodeType.Return];
          const chapter = story.chapters.find((candidate) => candidate.id === graph.id);
          for (const [id, expression] of Object.entries(data.values ?? {})) {
            scanExpression(
              expression,
              chapter?.outputs?.find((output) => output.id === id)?.valueType,
              `Return.${id}`,
            );
          }
        }
        for (const character of uniqueCharacters) {
          for (const field of character.fields ?? []) {
            if (
              (node.type === StoryNodeType.GetVariable ||
                node.type === StoryNodeType.SetVariable) &&
              node.data.variableId === field.id
            ) {
              addReference(characterFieldIndex, field.id, reference('Variable'));
            }
            for (const [label, expression] of expressionEntries(node)) {
              if (expressionReferencesCharacterField(expression, character.name, field)) {
                addReference(characterFieldIndex, field.id, reference(label));
              }
            }
            for (const [label, template] of templateEntries(node)) {
              if (templateReferencesCharacterField(template, character.name, field)) {
                addReference(characterFieldIndex, field.id, reference(label));
              }
            }
          }
        }
      }
    }
  }
  const seenCharacters = new Set<CharacterId>();
  for (const owner of characters) {
    const character = owner.character;
    if (seenCharacters.has(character.id)) continue;
    seenCharacters.add(character.id);
    const addCharacterReference = (assetId: AssetId, field: string, fieldKey = field) =>
      addReference(assetIndex, assetId, {
        id: `character:${character.id}:${fieldKey}`,
        label: character.displayName,
        location: owner.storyLabel ?? 'Project Characters',
        field,
        target: { kind: 'character', characterId: character.id, storyId: owner.storyId },
      });
    for (const field of character.fields ?? []) {
      scanVariable(field, (path) => ({
        id: `character:${character.id}:field:${field.id}:${path}`,
        label: character.displayName,
        location: owner.storyLabel ?? 'Project Characters',
        field: `${field.displayName}.${path}`,
        target: { kind: 'character', characterId: character.id, storyId: owner.storyId },
      }));
    }
    for (const [targetId, relationship] of Object.entries(character.relationships ?? {})) {
      addReference(characterIndex, targetId as CharacterId, {
        id: `character:${character.id}:relationship:${targetId}`,
        label: character.displayName,
        location: owner.storyLabel ?? 'Project Characters',
        field: `Relationship · ${relationship.label}`,
        target: { kind: 'character', characterId: character.id, storyId: owner.storyId },
      });
    }
    if (character.defaultPortraitId) {
      addCharacterReference(character.defaultPortraitId, 'Default Portrait');
    }
    for (const [key, emotion] of Object.entries(character.emotions)) {
      if (emotion.portraitId) {
        addCharacterReference(
          emotion.portraitId,
          `Emotion ${emotion.displayName || key} Portrait`,
          `emotion:${key}`,
        );
      }
    }
  }
  return {
    characters: characterIndex,
    emotions: emotionIndex,
    assets: assetIndex,
    characterFields: characterFieldIndex,
  };
}

export function findCharacterReferences(
  characterId: CharacterId,
  stories: readonly ResourceReferenceStory[],
): StoryResourceReference[] {
  return [...(buildStoryResourceReferenceIndex(stories, []).characters.get(characterId) ?? [])];
}

export function findEmotionReferences(
  characterId: CharacterId,
  emotion: string,
  stories: readonly ResourceReferenceStory[],
): StoryResourceReference[] {
  return [
    ...(buildStoryResourceReferenceIndex(stories, []).emotions.get(
      emotionReferenceKey(characterId, emotion),
    ) ?? []),
  ];
}

export function findAssetReferences(
  assetId: AssetId,
  stories: readonly ResourceReferenceStory[],
  characters: readonly ResourceReferenceCharacter[],
): StoryResourceReference[] {
  return [...(buildStoryResourceReferenceIndex(stories, characters).assets.get(assetId) ?? [])];
}
