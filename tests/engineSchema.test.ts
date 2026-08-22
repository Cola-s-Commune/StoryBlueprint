import { describe, expect, it } from 'vitest';
import {
  migrateEngineJsonValue,
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
});
