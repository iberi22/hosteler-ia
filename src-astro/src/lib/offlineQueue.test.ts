import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { enqueueOrder, getPendingOrders, clearPendingOrders, syncOrders } from './offlineQueue';

describe('offlineQueue', () => {
  beforeEach(async () => {
    await clearPendingOrders();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('handles order queueing and retrieval safely in environment', async () => {
    const order = await enqueueOrder({
      tableId: 'table-1',
      items: [{ menuItemId: 'm1', qty: 2 }],
      status: 'pending',
    });
    expect(order.tableId).toBe('table-1');
    expect(order.id).toBeDefined();

    const pending = await getPendingOrders();
    expect(pending).toHaveLength(1);
  });

  describe('syncOrders', () => {
    async function queueOne() {
      await enqueueOrder({
        tableId: 'table-2',
        items: [{ menuItemId: 'm2', qty: 1 }],
        status: 'pending',
      });
    }

    test('2xx: reenvia a POST /api/orders y borra el pedido de la cola', async () => {
      await queueOne();
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await syncOrders();

      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/orders');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        tableId: 'table-2',
        items: [{ menuItemId: 'm2', qty: 1 }],
      });
      expect(await getPendingOrders()).toHaveLength(0);
    });

    test('5xx: conserva el pedido en la cola', async () => {
      await queueOne();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

      const result = await syncOrders();

      expect(result).toEqual({ synced: 0, failed: 1 });
      expect(await getPendingOrders()).toHaveLength(1);
    });

    test('error de red: conserva el pedido en la cola', async () => {
      await queueOne();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await syncOrders();

      expect(result).toEqual({ synced: 0, failed: 1 });
      expect(await getPendingOrders()).toHaveLength(1);
    });

    test('acepta pedidos encolados con el formato anterior { id, qty }', async () => {
      await enqueueOrder({ tableId: 't', items: [{ id: 'old', qty: 3 }], status: 'pending' });
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await syncOrders();

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string).items).toEqual([{ menuItemId: 'old', qty: 3 }]);
    });
  });
});
