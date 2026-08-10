import {
  StoryNodeType,
  type AssetId,
  type ChapterId,
  type CharacterId,
  type CharacterSource,
  type NodeId,
  type StoryId,
  type StoryNodeDataMap,
  type VariableId,
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
  chapters: readonly { id: ChapterId; label: string; graph: EditorGraphState }[];
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
  | { kind: 'character'; characterId: CharacterId; storyId?: StoryId };

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
  return [{ id: 'root' as const, label: 'Main Story', graph: story.rootGraph }, ...story.chapters];
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

export function buildStoryResourceReferenceIndex(
  stories: readonly ResourceReferenceStory[],
  characters: readonly ResourceReferenceCharacter[],
): StoryResourceReferenceIndex {
  const characterIndex = new Map<CharacterId, StoryResourceReference[]>();
  const emotionIndex = new Map<string, StoryResourceReference[]>();
  const assetIndex = new Map<AssetId, StoryResourceReference[]>();
  const characterFieldIndex = new Map<VariableId, StoryResourceReference[]>();
  const uniqueCharacters = [
    ...new Map(characters.map((owner) => [owner.character.id, owner.character])).values(),
  ];
  for (const story of stories) {
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
