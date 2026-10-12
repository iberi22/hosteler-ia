import { describe, it, expect, beforeEach } from 'vitest';
import type { APIContext, APIRoute } from 'astro';
import { POST as createCategory } from '../pages/api/categories/index';
import { POST as createMenuItem } from '../pages/api/menu-items/index';
import { PATCH as updateMenuItem } from '../pages/api/menu-items/[id]';
import { POST as createOrder } from '../pages/api/orders/index';
import { POST as transitionOrder } from '../pages/api/orders/[id]/transition';
import { getMemoryAdapter } from './domain';
import { appendTx, stockOf } from './inventoryLedger';

describe('Recipe auto-deduction on served', () => {
  const adapter = getMemoryAdapter();

  beforeEach(() => {
    adapter.clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) =>
    ({ request: req, params, locals: { user: mockUser } }) as unknown as APIContext;

  const call = async (
    handler: APIRoute,
    url: string,
    options: { method?: string; payload?: unknown } = {},
    params: Record<string, string> = {},
  ) => {
    const hasBody = options.payload !== undefined;
    const req = new Request(url, {
      method: options.method ?? 'POST',
      headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      body: hasBody ? JSON.stringify(options.payload) : undefined,
    });
    const res = await handler(mockContext(req, params));
    if (!res) throw new Error('Route returned no response');
    return { res, json: (await res.json()) as Record<string, unknown> };
  };

  const seedInventory = async (id: string, stock: number) => {
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

  const fixtures = async () => {
    const now = new Date().toISOString();
    await seedInventory('harina', 100);
    await seedInventory('aceite', 50);
    await adapter.create('table', {
      id: 't1',
      instance_id: 'default',
      number: 1,
      capacity: 2,
      qrCode: 'qr-1',
      created_at: now,
      updated_at: now,
    });
    const cat = await call(createCategory, 'http://localhost/api/categories', { payload: { name: 'Primeros' } });
    expect(cat.res.status).toBe(201);
    return cat.json.id as string;
  };

  const createItemWithRecipe = async (categoryId: string, recipe: unknown, name = 'Tortilla') =>
    call(createMenuItem, 'http://localhost/api/menu-items', {
      payload: { name, price: 8, categoryId, recipe },
    });

  const walkToServed = async (orderId: string) => {
    for (const to of ['preparing', 'ready', 'served']) {
      const t = await call(transitionOrder, `http://localhost/api/orders/${orderId}/transition`, { payload: { to } }, { id: orderId });
      expect(t.res.status).toBe(200);
    }
  };

  it('POST/PATCH menu-items - stores and validates recipe', async () => {
    const categoryId = await fixtures();

    const created = await createItemWithRecipe(categoryId, [
      { inventoryId: 'harina', qty: 2 },
      { inventoryId: 'aceite', qty: 0.5 },
    ]);
    expect(created.res.status).toBe(201);
    expect(created.json.recipe).toEqual([
      { inventoryId: 'harina', qty: 2 },
      { inventoryId: 'aceite', qty: 0.5 },
    ]);

    const ghost = await createItemWithRecipe(categoryId, [{ inventoryId: 'ghost', qty: 1 }], 'Fantasma');
    expect(ghost.res.status).toBe(422);

    const badQty = await createItemWithRecipe(categoryId, [{ inventoryId: 'harina', qty: 0 }], 'Cero');
    expect(badQty.res.status).toBe(400);

    const itemId = created.json.id as string;
    const patched = await call(
      updateMenuItem,
      `http://localhost/api/menu-items/${itemId}`,
      { method: 'PATCH', payload: { recipe: [{ inventoryId: 'aceite', qty: 1 }] } },
      { id: itemId },
    );
    expect(patched.res.status).toBe(200);
    expect(patched.json.recipe).toEqual([{ inventoryId: 'aceite', qty: 1 }]);

    const badPatch = await call(
      updateMenuItem,
      `http://localhost/api/menu-items/${itemId}`,
      { method: 'PATCH', payload: { recipe: [{ inventoryId: 'ghost', qty: 1 }] } },
      { id: itemId },
    );
    expect(badPatch.res.status).toBe(422);
  });

  it('serving an order deducts recipe x qty exactly once', async () => {
    const categoryId = await fixtures();
    const item = await createItemWithRecipe(categoryId, [
      { inventoryId: 'harina', qty: 2 },
      { inventoryId: 'aceite', qty: 0.5 },
    ]);
    expect(item.res.status).toBe(201);

    const order = await call(createOrder, 'http://localhost/api/orders', {
      payload: { tableId: 't1', items: [{ menuItemId: item.json.id, qty: 2 }] },
    });
    expect(order.res.status).toBe(201);
    const orderId = order.json.id as string;

    await walkToServed(orderId);

    expect(await stockOf(adapter, 'default', 'harina')).toBe(100 - 4);
    expect(await stockOf(adapter, 'default', 'aceite')).toBe(50 - 1);

    const orderAfter = (await adapter.get('order', orderId, 'default')) as Record<string, unknown>;
    expect(typeof orderAfter.stockDeducted).toBe('string');

    const retry = await call(
      transitionOrder,
      `http://localhost/api/orders/${orderId}/transition`,
      { payload: { to: 'served' } },
      { id: orderId },
    );
    expect(retry.res.status).toBe(400);
    expect(await stockOf(adapter, 'default', 'harina')).toBe(96);
    expect(await stockOf(adapter, 'default', 'aceite')).toBe(49);
  });

  it('skips deduction when stockDeducted is already set', async () => {
    const categoryId = await fixtures();
    const item = await createItemWithRecipe(categoryId, [{ inventoryId: 'harina', qty: 2 }]);
    const order = await call(createOrder, 'http://localhost/api/orders', {
      payload: { tableId: 't1', items: [{ menuItemId: item.json.id, qty: 1 }] },
    });
    const orderId = order.json.id as string;
    await call(transitionOrder, `http://localhost/api/orders/${orderId}/transition`, { payload: { to: 'preparing' } }, { id: orderId });
    await call(transitionOrder, `http://localhost/api/orders/${orderId}/transition`, { payload: { to: 'ready' } }, { id: orderId });
    await adapter.update('order', orderId, { stockDeducted: new Date().toISOString() }, 'default');

    const served = await call(
      transitionOrder,
      `http://localhost/api/orders/${orderId}/transition`,
      { payload: { to: 'served' } },
      { id: orderId },
    );
    expect(served.res.status).toBe(200);
    expect(served.json.deduction).toBeUndefined();
    expect(await stockOf(adapter, 'default', 'harina')).toBe(100);
  });

  it('order with recipe-less items does not touch stock', async () => {
    const categoryId = await fixtures();
    const plain = await call(createMenuItem, 'http://localhost/api/menu-items', {
      payload: { name: 'Pan', price: 2, categoryId },
    });
    expect(plain.res.status).toBe(201);
    expect(plain.json.recipe).toEqual([]);

    const order = await call(createOrder, 'http://localhost/api/orders', {
      payload: { tableId: 't1', items: [{ menuItemId: plain.json.id, qty: 5 }] },
    });
    const orderId = order.json.id as string;
    await walkToServed(orderId);

    expect(await stockOf(adapter, 'default', 'harina')).toBe(100);
    expect(await stockOf(adapter, 'default', 'aceite')).toBe(50);
  });
});
