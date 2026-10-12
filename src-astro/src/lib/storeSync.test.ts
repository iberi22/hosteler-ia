import { describe, it, expect, vi } from 'vitest';
import {
  mapInventoryItem,
  mapCategory,
  mapMenuItem,
  mapOrder,
  mapSession,
  fetchCollection,
} from './storeSync';
import type { DomainRecord } from './domain';

const rec = (over: Record<string, unknown>): DomainRecord =>
  ({
    id: 'x1',
    instance_id: 'default',
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
    ...over,
  }) as DomainRecord;

describe('storeSync mappers', () => {
  it('maps inventory items with safe defaults', () => {
    const m = mapInventoryItem(rec({ name: 'Harina', unit: 'kg', stock: 4 }));
    expect(m).toMatchObject({ name: 'Harina', unit: 'kg', stock: 4, minStock: 0, costPerUnit: 0 });
    expect(mapInventoryItem(rec({})).unit).toBe('ud');
  });

  it('maps categories and menu items', () => {
    expect(mapCategory(rec({ name: 'A' }), 2)).toMatchObject({ name: 'A', sortOrder: 3, isActive: true });
    const mi = mapMenuItem(rec({ name: 'T', price: 9.5, categoryId: 'c1' }));
    expect(mi).toMatchObject({ price: 9.5, categoryId: 'c1', isAvailable: true, tags: [] });
  });

  it('maps orders computing totals from items', () => {
    const o = mapOrder(
      rec({
        tableId: 't1',
        status: 'preparing',
        items: [
          { menuItemId: 'm1', qty: 2, price: 5 },
          { menuItemId: 'm2', qty: 1, price: 3 },
        ],
      }),
    );
    expect(o.totalPrice).toBe(13);
    expect(o.items[0]).toMatchObject({ menuItemId: 'm1', quantity: 2, unitPrice: 5 });
    expect(o.status).toBe('preparing');
  });

  it('maps sessions, null-safe', () => {
    expect(mapSession(null)).toEqual({ user: null, profile: null });
    const s = mapSession({ user: { id: 'u', email: 'a@b.c' }, profile: null } as any);
    expect(s.user?.email).toBe('a@b.c');
    expect(s.profile).toBeNull();
  });

  it('fetchCollection builds instance-scoped URLs and throws on HTTP error', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => [{ id: 'a' }] }) as any);
    const list = await fetchCollection(ok as any, 'inventory', 'r1');
    expect(ok).toHaveBeenCalledWith('/api/inventory?instance_id=r1');
    expect(list).toHaveLength(1);

    const bad = vi.fn(async () => ({ ok: false, status: 500 }) as any);
    await expect(fetchCollection(bad as any, 'inventory')).rejects.toThrow('500');
  });
});
