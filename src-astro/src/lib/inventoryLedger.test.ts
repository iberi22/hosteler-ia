import { describe, it, expect, beforeEach } from 'vitest';
import { TX_KINDS, isTxKind, txSign, appendTx, stockOf, txHistory } from './inventoryLedger';
import { getMemoryAdapter } from './domain';

describe('Inventory Ledger', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const seedItem = async (id = 'i1') => {
    const now = new Date().toISOString();
    await getMemoryAdapter().create('inventoryItem', {
      id,
      instance_id: 'default',
      name: 'Harina',
      unit: 'kg',
      stock: 0,
      created_at: now,
      updated_at: now,
    });
  };

  it('exposes the 4 tx kinds', () => {
    expect([...TX_KINDS]).toEqual(['purchase', 'use', 'waste', 'adjust']);
    expect(isTxKind('purchase')).toBe(true);
    expect(isTxKind('sell')).toBe(false);
  });

  it('signs quantities per kind', () => {
    expect(txSign('purchase', 5)).toBe(5);
    expect(txSign('use', 5)).toBe(-5);
    expect(txSign('waste', 5)).toBe(-5);
    expect(txSign('adjust', -2)).toBe(-2);
    expect(txSign('adjust', 3)).toBe(3);
  });

  it('stock = SUM(transactions), item denormalized on append', async () => {
    await seedItem();
    const adapter = getMemoryAdapter();

    await appendTx(adapter, 'default', 'i1', 'purchase', 10);
    await appendTx(adapter, 'default', 'i1', 'use', 3);
    await appendTx(adapter, 'default', 'i1', 'waste', 1);

    expect(await stockOf(adapter, 'default', 'i1')).toBe(6);
    const item = await adapter.get('inventoryItem', 'i1', 'default');
    expect((item as any).stock).toBe(6);
  });

  it('history is chronological and immutable (append-only)', async () => {
    await seedItem();
    const adapter = getMemoryAdapter();

    const t1 = await appendTx(adapter, 'default', 'i1', 'purchase', 4);
    const t2 = await appendTx(adapter, 'default', 'i1', 'use', 1);

    const history = await txHistory(adapter, 'default', 'i1');
    expect(history.map((t) => t.id)).toEqual([t1.id, t2.id]);
    // no update/delete path exists on txs — records keep original qty
    expect((t1 as any).qty).toBe(4);
  });
});
