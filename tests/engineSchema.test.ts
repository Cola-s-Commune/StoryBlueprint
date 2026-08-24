import { describe, expect, it } from 'vitest';
import {
  migrateEngineJsonValue,
  migrateEmbeddedEngineObjects,
  normalizeEngineTypeDefaults,
  stripEngineObjectTypeMarkers,
  engineValueMatchesFieldType,
  summarizeEngineSchemaMigration,
  type EngineTypeDefinition,
} from '../packages/common/src';

const previous: EngineTypeDefinition = {
  id: 'et_rewardpayload',
  name: 'RewardPayload',
  displayName: 'Reward Payload',
  fields: [
    {
      id: 'ef_itemid',
      name: 'itemId',
      displayName: 'Item ID',
      type: { kind: 'string' },
      defaultValue: '',
    },
    {
      id: 'ef_amount',
      name: 'amount',
      displayName: 'Amount',
      type: { kind: 'number' },
      defaultValue: 1,
    },
    {
      id: 'ef_tags',
      name: 'tags',
      displayName: 'Tags',
      type: { kind: 'array', elementType: { kind: 'string' } },
      defaultValue: [],
    },
  ],
};

describe('Engine Type Schema migration', () => {
  it('accepts heterogeneous JSON arrays only through explicit Any JSON items', () => {
    const type = { kind: 'array' as const, elementType: { kind: 'any' as const } };
    expect(
      engineValueMatchesFieldType([null, true, 3, 'text', ['nested'], { field: false }], type, []),
    ).toBe(true);
    expect(engineValueMatchesFieldType([1, Number.NaN], type, [])).toBe(false);
  });

  it('preserves renamed fields, adds defaults, removes fields, and resets incompatible values', () => {
    const next: EngineTypeDefinition = {
      ...previous,
      fields: [
        {
          id: 'ef_itemid',
          name: 'assetId',
          displayName: 'Asset ID',
          type: { kind: 'string' },
          defaultValue: '',
        },
        {
          id: 'ef_amount',
          name: 'amount',
          displayName: 'Amount',
          type: { kind: 'string' },
          defaultValue: '1',
        },
        {
          id: 'ef_rare',
          name: 'rare',
          displayName: 'Rare',
          type: { kind: 'boolean' },
          defaultValue: false,
        },
      ],
    };

    expect(summarizeEngineSchemaMigration(previous, next)).toEqual({
      addedFields: ['rare'],
      removedFields: ['tags'],
      renamedFields: [{ from: 'itemId', to: 'assetId' }],
      changedTypeFields: ['amount'],
    });
    expect(
      migrateEngineJsonValue(
        { itemId: 'gold', amount: 3, tags: ['quest'] },
        previous,
        next,
        [previous],
        [next],
      ),
    ).toEqual({ assetId: 'gold', amount: '1', rare: false });
  });

  it('migrates array elements of nested Engine Types', () => {
    const oldItem: EngineTypeDefinition = {
      id: 'et_item',
      name: 'Item',
      displayName: 'Item',
      fields: [
        { id: 'ef_id', name: 'id', displayName: 'ID', type: { kind: 'string' }, defaultValue: '' },
      ],
    };
    const newItem: EngineTypeDefinition = {
      ...oldItem,
      fields: [
        {
          id: 'ef_id',
          name: 'assetId',
          displayName: 'Asset ID',
          type: { kind: 'string' },
          defaultValue: '',
        },
      ],
    };
    const oldList: EngineTypeDefinition = {
      id: 'et_inventory',
      name: 'Inventory',
      displayName: 'Inventory',
      fields: [
        {
          id: 'ef_items',
          name: 'items',
          displayName: 'Items',
          type: { kind: 'array', elementType: { kind: 'object', typeName: 'Item' } },
          defaultValue: [],
        },
      ],
    };
    const newList: EngineTypeDefinition = { ...oldList };
    expect(
      migrateEngineJsonValue(
        { items: [{ id: 'sword' }] },
        oldList,
        newList,
        [oldList, oldItem],
        [newList, newItem],
      ),
    ).toEqual({ items: [{ assetId: 'sword' }] });
  });

  it('treats nullable changes as a migration while stable IDs survive renames', () => {
    const nullable: EngineTypeDefinition = {
      ...previous,
      fields: previous.fields.map((field) =>
        field.id === 'ef_itemid' ? { ...field, name: 'assetId', nullable: true } : field,
      ),
    };
    const required: EngineTypeDefinition = {
      ...nullable,
      fields: nullable.fields.map((field) =>
        field.id === 'ef_itemid'
          ? { ...field, nullable: undefined, defaultValue: 'fallback' }
          : field,
      ),
    };
    expect(summarizeEngineSchemaMigration(previous, nullable).renamedFields).toEqual([
      { from: 'itemId', to: 'assetId' },
    ]);
    expect(summarizeEngineSchemaMigration(nullable, required).changedTypeFields).toEqual([
      'assetId',
    ]);
    expect(
      migrateEngineJsonValue(
        { assetId: null, amount: 1, tags: [] },
        nullable,
        required,
        [nullable],
        [required],
      ),
    ).toMatchObject({ assetId: 'fallback' });
  });

  it('recursively migrates Engine Type values stored inside Maps', () => {
    const oldItem: EngineTypeDefinition = {
      id: 'et_mapitem',
      name: 'MapItem',
      displayName: 'Map Item',
      fields: [
        {
          id: 'ef_label',
          name: 'label',
          displayName: 'Label',
          type: { kind: 'string' },
          defaultValue: '',
        },
      ],
    };
    const newItem: EngineTypeDefinition = {
      ...oldItem,
      fields: [
        {
          id: 'ef_label',
          name: 'title',
          displayName: 'Title',
          type: { kind: 'string' },
          defaultValue: '',
        },
      ],
    };
    const oldMap: EngineTypeDefinition = {
      id: 'et_mapcontainer',
      name: 'MapContainer',
      displayName: 'Map Container',
      fields: [
        {
          id: 'ef_entries',
          name: 'entries',
          displayName: 'Entries',
          type: {
            kind: 'map',
            keyType: { kind: 'string' },
            valueType: { kind: 'object', typeName: 'MapItem' },
          },
          defaultValue: {},
        },
      ],
    };
    const newMap: EngineTypeDefinition = { ...oldMap };
    expect(
      migrateEngineJsonValue(
        { entries: { first: { label: 'One' } } },
        oldMap,
        newMap,
        [oldMap, oldItem],
        [newMap, newItem],
      ),
    ).toEqual({ entries: { first: { title: 'One' } } });
  });

  it('normalizes defaults in Object types that reference a changed Object', () => {
    const oldChild: EngineTypeDefinition = {
      id: 'et_child',
      name: 'Child',
      displayName: 'Child',
      fields: [
        {
          id: 'ef_child_name',
          name: 'oldName',
          displayName: 'Old Name',
          type: { kind: 'string' },
          defaultValue: 'before',
        },
      ],
    };
    const newChild: EngineTypeDefinition = {
      ...oldChild,
      fields: [{ ...oldChild.fields[0]!, name: 'newName', displayName: 'New Name' }],
    };
    const parent: EngineTypeDefinition = {
      id: 'et_parent',
      name: 'Parent',
      displayName: 'Parent',
      fields: [
        {
          id: 'ef_parent_child',
          name: 'child',
          displayName: 'Child',
          type: { kind: 'object', typeName: 'Child' },
          defaultValue: { oldName: 'custom' },
        },
      ],
    };

    const normalized = normalizeEngineTypeDefaults(
      [oldChild, parent],
      [newChild, parent],
    );
    expect(normalized.find((item) => item.name === 'Parent')?.fields[0]?.defaultValue).toEqual({
      newName: 'custom',
    });
  });

  it('keeps a named Object recognizable when it is nested in Any JSON', () => {
    const oldChild: EngineTypeDefinition = {
      id: 'et_any_child',
      name: 'AnyChild',
      displayName: 'Any Child',
      fields: [
        {
          id: 'ef_any_name',
          name: 'oldName',
          displayName: 'Old Name',
          type: { kind: 'string' },
          defaultValue: '',
        },
      ],
    };
    const newChild: EngineTypeDefinition = {
      ...oldChild,
      fields: [{ ...oldChild.fields[0]!, name: 'newName', displayName: 'New Name' }],
    };
    const container: EngineTypeDefinition = {
      id: 'et_any_container',
      name: 'AnyContainer',
      displayName: 'Any Container',
      fields: [
        {
          id: 'ef_any_payload',
          name: 'payload',
          displayName: 'Payload',
          type: { kind: 'any' },
          defaultValue: { oldName: 'kept' },
        },
      ],
    };

    expect(
      migrateEmbeddedEngineObjects(
        [{ oldName: 'kept' }],
        [oldChild, container],
        [newChild, container],
      ),
    ).toEqual([{ $storyBlueprintType: 'et_any_child', newName: 'kept' }]);
    expect(
      normalizeEngineTypeDefaults(
        [oldChild, container],
        [newChild, container],
      ).find((item) => item.name === 'AnyContainer')?.fields[0]?.defaultValue,
    ).toEqual({ $storyBlueprintType: 'et_any_child', newName: 'kept' });
    expect(
      stripEngineObjectTypeMarkers({
        items: [{ $storyBlueprintType: 'et_any_child', newName: 'kept' }],
      }),
    ).toEqual({ items: [{ newName: 'kept' }] });
  });
});
