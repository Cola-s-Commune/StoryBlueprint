import { describe, expect, it } from 'vitest';
import {
  parseCharacterTemplate,
  serializeCharacterTemplate,
  type CharacterId,
  type CharacterSource,
  type VariableId,
  BLUEPRINT_COMMAND_FORMAT,
  BLUEPRINT_COMMAND_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  StoryNodeType,
  createStorySemanticSnapshot,
  executeBlueprintCommandTransaction,
} from '../packages/common/src';
import {
  characterFromTemplate,
  characterToTemplate,
} from '../packages/editor/src/renderer/graph/characterManagement';

const character: CharacterSource = {
  id: 'c_mira',
  name: 'mira',
  displayName: 'Mira',
  description: 'A fleet captain.',
  dialogueStyle: 'Direct and formal.',
  tags: ['captain'],
  metadata: { faction: 'Fleet' },
  defaultPortraitId: 'a_mira',
  relationships: { c_orrin: { label: 'Mentor' } },
  emotions: { neutral: { displayName: 'Neutral', portraitId: 'a_mira' } },
  fields: [
    {
      id: 'v_trust',
      name: 'trust',
      displayName: 'Trust',
      scope: 'character',
      valueType: { kind: 'number' },
      defaultValue: 0,
    },
  ],
};

describe('Character templates', () => {
  it('omits identity, relationships, and portraits while preserving authoring defaults', () => {
    const template = characterToTemplate(character, 'captain', 'Captain');
    const text = serializeCharacterTemplate(template);
    const parsed = parseCharacterTemplate(text);

    expect(parsed).toEqual(template);
    expect(text).not.toContain('c_mira');
    expect(text).not.toContain('c_orrin');
    expect(text).not.toContain('a_mira');
    expect(text).not.toContain('v_trust');
  });

  it('lets AI instantiate a known template with explicit fresh field IDs', () => {
    const template = characterToTemplate(character, 'captain', 'Captain');
    const story = {
      format: STORY_SOURCE_FORMAT,
      version: STORY_SOURCE_VERSION,
      id: 's_test',
      name: 'test',
      displayName: 'Test',
      root: {
        nodes: [
          {
            id: 'n_start',
            type: StoryNodeType.Start,
            definitionVersion: 1,
            position: { x: 0, y: 0 },
            data: { title: 'Start' },
          },
        ],
        edges: [],
      },
      chapters: [],
      variables: [],
      characters: [],
      assets: [],
      events: [],
      signals: [],
    } as const;
    const snapshot = createStorySemanticSnapshot(story, [template]);
    const result = executeBlueprintCommandTransaction(
      story,
      {
        format: BLUEPRINT_COMMAND_FORMAT,
        version: BLUEPRINT_COMMAND_VERSION,
        baseRevision: snapshot.revision,
        operations: [
          {
            operationId: 'create-captain',
            kind: 'add-character-from-template',
            templateName: 'captain',
            character: { id: 'c_created', name: 'new_captain', displayName: 'New Captain' },
            fieldIds: { trust: 'v_createdtrust' },
          },
        ],
      },
      {
        semanticContext: {
          characters: [],
          assets: [],
          events: [],
          signals: [],
          characterTemplates: [template],
        },
      },
    );
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.document.characters[0]).toMatchObject({
      id: 'c_created',
      name: 'new_captain',
      fields: [{ id: 'v_createdtrust', name: 'trust', scope: 'character' }],
    });
  });

  it('creates fresh character and field identities from a template', () => {
    const template = characterToTemplate(character, 'captain', 'Captain');
    const created = characterFromTemplate(
      template,
      'c_created' as CharacterId,
      'new_captain',
      'New Captain',
      () => 'v_createdtrust' as VariableId,
    );

    expect(created).toMatchObject({
      id: 'c_created',
      name: 'new_captain',
      displayName: 'New Captain',
      tags: ['captain'],
      metadata: { faction: 'Fleet' },
    });
    expect(created.fields?.[0]).toMatchObject({ id: 'v_createdtrust', scope: 'character' });
    expect(created.relationships).toBeUndefined();
    expect(created.defaultPortraitId).toBeUndefined();
    expect(created.emotions.neutral?.portraitId).toBeUndefined();
  });
});
