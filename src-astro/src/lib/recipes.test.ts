import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter } from './domain';
import { appendTx, stockOf, txHistory } from './inventoryLedger';
import { assertValidRecipe, deductRecipe, isRecipeLine, recipeOf } from './recipes';

describe('recipes', () => {
  const adapter = getMemoryAdapter();

  beforeEach(() => {
    adapter.clear();
  });

  const seedInventory = async (id: string, stock = 0) => {
    const now = new Date().toISOString();
    await adapter.create('inventoryItem', {
      id,
      instance_id: 'default',
      name: id,
      stock: 0,
      unit: 'u',
      created_at: now,
      updated_at: now,
    });
    if (stock > 0) await appendTx(adapter, 'default', id, 'purchase', stock);
  };

  it('isRecipeLine / recipeOf - accepts valid lines, drops garbage', () => {
    expect(isRecipeLine({ inventoryId: 'i1', qty: 2 })).toBe(true);
    expect(isRecipeLine({ inventoryId: '', qty: 2 })).toBe(false);
    expect(isRecipeLine({ inventoryId: 'i1', qty: 0 })).toBe(false);
    expect(isRecipeLine({ inventoryId: 'i1', qty: -1 })).toBe(false);
    expect(isRecipeLine(null)).toBe(false);
    expect(recipeOf({ recipe: [{ inventoryId: 'i1', qty: 1 }, { inventoryId: '', qty: 1 }] })).toHaveLength(1);
    expect(recipeOf({})).toEqual([]);
  });

  it('deductRecipe - discounts qty*times per line via use movements', async () => {
    await seedInventory('inv1', 10);
    await seedInventory('inv2', 8);
    const menuItem = { recipe: [{ inventoryId: 'inv1', qty: 2 }, { inventoryId: 'inv2', qty: 0.5 }] };

    const movements = await deductRecipe(adapter, 'default', menuItem, 3, 'o1');

    expect(movements).toBe(2);
    expect(await stockOf(adapter, 'default', 'inv1')).toBe(10 - 6);
    expect(await stockOf(adapter, 'default', 'inv2')).toBe(8 - 1.5);
    const history = await txHistory(adapter, 'default', 'inv1');
    expect(history).toHaveLength(2);
    const use = history.find((t) => (t as Record<string, unknown>).kind === 'use');
    expect((use as Record<string, unknown>).note).toBe('order:o1');
  });

  it('deductRecipe - no-op without recipe or with empty recipe', async () => {
    await seedInventory('inv1', 10);

    expect(await deductRecipe(adapter, 'default', {}, 2, 'o1')).toBe(0);
    expect(await deductRecipe(adapter, 'default', { recipe: [] }, 2, 'o1')).toBe(0);
    expect(await stockOf(adapter, 'default', 'inv1')).toBe(10);
    expect(await txHistory(adapter, 'default', 'inv1')).toHaveLength(1);
  });

  it('assertValidRecipe - accepts lines pointing at live inventory items', async () => {
    await seedInventory('inv1');
    const lines = await assertValidRecipe([{ inventoryId: 'inv1', qty: 1.5 }], adapter, 'default');
    expect(lines).toHaveLength(1);
    expect(await assertValidRecipe([], adapter, 'default')).toEqual([]);
  });

  it('assertValidRecipe - rejects non-array, bad lines, unknown or deleted inventory ids', async () => {
    await seedInventory('inv1');
    await adapter.update('inventoryItem', 'inv1', { deleted_at: new Date().toISOString() }, 'default');

    await expect(assertValidRecipe('nope', adapter, 'default')).rejects.toThrow('array');
    await expect(assertValidRecipe([{ inventoryId: 'ghost', qty: 1 }], adapter, 'default')).rejects.toThrow(
      'unknown inventory item: ghost',
    );
    await expect(assertValidRecipe([{ inventoryId: 'inv1', qty: 1 }], adapter, 'default')).rejects.toThrow(
      'unknown inventory item: inv1',
    );
    await expect(assertValidRecipe([{ inventoryId: 'inv1', qty: 0 }], adapter, 'default')).rejects.toThrow(
      'Invalid recipe line',
    );
    await expect(assertValidRecipe([{ inventoryId: '', qty: 2 }], adapter, 'default')).rejects.toThrow(
      'Invalid recipe line',
    );
  });
});
