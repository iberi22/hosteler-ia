import { describe, it, expect, beforeEach } from 'vitest';
import { loadTableOrder } from './tableQr';
import { getMemoryAdapter } from './domain';

describe('table QR loader', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const seed = async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    const mk = (entity: string, id: string, extra: Record<string, unknown> = {}) =>
      adapter.create(entity, { id, instance_id: 'default', created_at: now, updated_at: now, ...extra } as any);
    await mk('restaurant', 'r1', { name: 'Casa Paco' });
    await mk('table', 't1', { number: 3, capacity: 2, qrCode: 'qr-abc', restaurantId: 'r1' });
    await mk('menuItem', 'm1', { name: 'Olivas', price: 3, categoryId: 'c1' });
    return adapter;
  };

  it('resolves table + restaurant + menu by QR code', async () => {
    const data = await loadTableOrder(await seed(), 'default', 'qr-abc');
    expect(data?.table.number).toBe(3);
    expect(data?.restaurant?.name).toBe('Casa Paco');
    expect(data?.menuItems).toHaveLength(1);
  });

  it('returns null for unknown codes', async () => {
    expect(await loadTableOrder(await seed(), 'default', 'nope')).toBeNull();
  });

  it('exposes no internal fields (no instance_id, no deleted)', async () => {
    const data = await loadTableOrder(await seed(), 'default', 'qr-abc');
    expect(data).not.toHaveProperty('instance_id');
    expect((data as any).table.qrCode).toBeUndefined();
  });
});
