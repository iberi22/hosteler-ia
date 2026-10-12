import { describe, it, expect, beforeEach } from 'vitest';
import { GET as resolveQr } from '../pages/api/qr/[code]';
import { createStorageAdapter } from './storageAdapter';

describe('QR Public Endpoint Internal Leak Prevention', () => {
  beforeEach(async () => {
    const adapter = createStorageAdapter();
    const tables = await adapter.list('table', 'default');
    for (const t of tables) {
      await adapter.del('table', t.id, 'default');
    }
    const restaurants = await adapter.list('restaurant', 'default');
    for (const r of restaurants) {
      await adapter.del('restaurant', r.id, 'default');
    }
    const menuItems = await adapter.list('menuItem', 'default');
    for (const m of menuItems) {
      await adapter.del('menuItem', m.id, 'default');
    }
  });

  const mockContext = (req: Request, params: Record<string, string> = {}) =>
    ({
      request: req,
      params,
      locals: {},
    }) as any;

  it('GET /api/qr/[code] returns public data without leaking internal fields like qrCode, sealed, or r2_key', async () => {
    const adapter = createStorageAdapter();

    // Populate storage with records containing internal/sensitive metadata
    await adapter.create(
      'table',
      {
        id: 'table-101',
        instance_id: 'default',
        number: 12,
        capacity: 4,
        qrCode: 'SECRET_QR_CODE_STRING',
        restaurantId: 'rest-1',
        sealed: 'SEALED_TOKEN_123',
        r2_key: 'R2_INTERNAL_STORAGE_KEY',
        secret: 'TOP_SECRET_INTERNAL_KEY',
      } as any,
    );

    await adapter.create(
      'restaurant',
      {
        id: 'rest-1',
        instance_id: 'default',
        name: 'El Sabor',
        slug: 'el-sabor',
        address: 'Calle Mayor 1',
        sealed: 'REST_SEALED_DATA',
        r2_key: 'REST_R2_KEY',
      } as any,
    );

    await adapter.create(
      'menuItem',
      {
        id: 'item-1',
        instance_id: 'default',
        name: 'Paella',
        price: 15,
        categoryId: 'cat-1',
        cost: 4.5,
        recipe: [{ inventoryId: 'inv-1', qty: 2 }],
        sealed: 'ITEM_SEALED_DATA',
        r2_key: 'ITEM_R2_KEY',
      } as any,
    );

    const req = new Request('http://localhost/api/qr/SECRET_QR_CODE_STRING');
    const res = await resolveQr(mockContext(req, { code: 'SECRET_QR_CODE_STRING' }));

    expect(res.status).toBe(200);

    const rawText = await res.text();
    const data = JSON.parse(rawText);

    // Verify expected public properties exist
    expect(data.table.id).toBe('table-101');
    expect(data.table.number).toBe(12);
    expect(data.table.capacity).toBe(4);
    expect(data.restaurant.name).toBe('El Sabor');
    expect(data.menuItems).toHaveLength(1);

    // Assert absence of internal sensitive fields in response payload
    expect(data.table.qrCode).toBeUndefined();
    expect(rawText).not.toContain('qrCode');
    expect(rawText).not.toContain('sealed');
    expect(rawText).not.toContain('r2_key');
    expect(rawText).not.toContain('secret');
  });

  it('GET /api/qr/[code] 404 response does not leak internal error trace or sensitive keys', async () => {
    const req = new Request('http://localhost/api/qr/nonexistent');
    const res = await resolveQr(mockContext(req, { code: 'nonexistent' }));

    expect(res.status).toBe(404);

    const rawText = await res.text();
    expect(rawText).not.toContain('qrCode');
    expect(rawText).not.toContain('sealed');
    expect(rawText).not.toContain('r2_key');
  });
});
