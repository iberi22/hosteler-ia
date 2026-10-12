import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listOrders, POST as createOrder } from '../pages/api/orders/index';
import { GET as getOrder, PATCH as updateOrder, DELETE as deleteOrder } from '../pages/api/orders/[id]';
import { POST as transitionOrder } from '../pages/api/orders/[id]/transition';
import { getMemoryAdapter } from './domain';

describe('Orders API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) => ({
    request: req,
    params,
    locals: { user: mockUser },
  }) as any;

  const postJson = (url: string, method: string, payload: unknown, params: Record<string, string> = {}) => {
    const req = new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { req, params };
  };

  const fixtures = async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('table', {
      id: 't1',
      instance_id: 'default',
      number: 1,
      capacity: 2,
      qrCode: 'qr-1',
      created_at: now,
      updated_at: now,
    });
    await adapter.create('menuItem', {
      id: 'm1',
      instance_id: 'default',
      name: 'Café',
      price: 2,
      categoryId: 'c1',
      created_at: now,
      updated_at: now,
    });
  };

  const createPending = async () => {
    await fixtures();
    const { req } = postJson('http://localhost/api/orders', 'POST', {
      tableId: 't1',
      items: [{ menuItemId: 'm1', qty: 2 }],
    });
    const res = await createOrder(mockContext(req));
    expect(res.status).toBe(201);
    return res.json();
  };

  const transition = async (id: string, to: string) => {
    const { req } = postJson(`http://localhost/api/orders/${id}/transition`, 'POST', { to });
    return transitionOrder(mockContext(req, { id }));
  };

  it('POST /api/orders - creates a pending order with validated refs', async () => {
    const order = await createPending();
    expect(order.status).toBe('pending');
    expect(order.tableId).toBe('t1');
    expect(order.items).toHaveLength(1);
  });

  // Regresion: el KDS mostraba "$ 0" y sin nombre de plato porque el pedido
  // guardaba solo {menuItemId, qty}. El nombre y el precio se hidratan al crear.
  it('POST /api/orders - hidrata name y unitPrice desde el menuItem', async () => {
    const order = await createPending();
    const item = order.items[0];
    expect(item.name).toBe('Café');
    expect(item.unitPrice).toBe(2);
    expect(item.qty).toBe(2);
    expect(item.menuItemId).toBe('m1');
  });

  it('POST /api/orders - congela el precio aunque el menu cambie despues', async () => {
    const order = await createPending();
    // el restaurante sube el precio del cafe despues del pedido
    const adapter = getMemoryAdapter();
    const mi = (await adapter.get('menuItem', 'm1', 'default')) as Record<string, unknown>;
    await adapter.update('menuItem', 'm1', { ...mi, price: 999 }, 'default');

    const res = await listOrders(mockContext(new Request('http://localhost/api/orders')));
    const rows = (await res.json()) as Array<{ id: string; items: Array<{ unitPrice: number }> }>;
    const found = rows.find((r) => r.id === order.id);
    expect(found?.items[0].unitPrice).toBe(2);
  });

  it('POST /api/orders - 422 on unknown table or menu item', async () => {
    await fixtures();
    const badTable = postJson('http://localhost/api/orders', 'POST', {
      tableId: 'nope',
      items: [{ menuItemId: 'm1', qty: 1 }],
    });
    expect((await createOrder(mockContext(badTable.req))).status).toBe(422);

    const badItem = postJson('http://localhost/api/orders', 'POST', {
      tableId: 't1',
      items: [{ menuItemId: 'nope', qty: 1 }],
    });
    expect((await createOrder(mockContext(badItem.req))).status).toBe(422);
  });

  it('transition - walks the happy path to paid, rejects skips', async () => {
    const order = await createPending();
    for (const to of ['preparing', 'ready', 'served', 'paid']) {
      const res = await transition(order.id, to);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe(to);
    }

    const order2 = await createPending();
    const skip = await transition(order2.id, 'ready');
    expect(skip.status).toBe(400);
    expect((await skip.json()).error).toContain('pending → ready');
  });

  it('transition - cancels from pending, blocks cancel from ready', async () => {
    const order = await createPending();
    const cancel = await transition(order.id, 'cancelled');
    expect(cancel.status).toBe(200);

    const order2 = await createPending();
    await transition(order2.id, 'preparing');
    await transition(order2.id, 'ready');
    const lateCancel = await transition(order2.id, 'cancelled');
    expect(lateCancel.status).toBe(400);
  });

  it('GET /api/orders?status= - filters, 400 on bad status', async () => {
    const order = await createPending();
    await transition(order.id, 'preparing');

    const res = await listOrders(mockContext(new Request('http://localhost/api/orders?status=preparing')));
    expect(((await res.json()) as unknown[])).toHaveLength(1);

    const bad = await listOrders(mockContext(new Request('http://localhost/api/orders?status=delivered')));
    expect(bad.status).toBe(400);
  });

  it('PATCH rejects direct status edits (409), DELETE cancels active orders', async () => {
    const order = await createPending();
    const { req } = postJson(`http://localhost/api/orders/${order.id}`, 'PATCH', { status: 'ready' });
    expect((await updateOrder(mockContext(req, { id: order.id }))).status).toBe(409);

    const del = await deleteOrder(
      mockContext(new Request(`http://localhost/api/orders/${order.id}`, { method: 'DELETE' }), { id: order.id }),
    );
    expect(del.status).toBe(200);
    expect((await del.json()).record.status).toBe('cancelled');

    const gone = await getOrder(
      mockContext(new Request(`http://localhost/api/orders/${order.id}`), { id: order.id }),
    );
    expect(gone.status).toBe(200);
  });
});
