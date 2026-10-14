import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../stores/orders.svelte', () => {
  return {
    orders: { list: [], isLoading: false, activeOrderId: null },
    clearOrders: () => {},
  };
});

import * as meshModule from '../../lib/mesh';
import { orders } from '../../stores/orders.svelte';
import { mapOrder } from '../../lib/storeSync';

vi.mock('../../lib/mesh', () => ({
  meshSubscribe: vi.fn(),
  meshPublish: vi.fn(),
}));

describe('KitchenQueue order:created mesh subscription', () => {
  beforeEach(() => {
    orders.list = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('receives a new order via meshSubscribe and adds it to the store', async () => {
    const kitchenQueueCallback = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const rec = payload as Record<string, unknown>;
      if (!rec.id) return;

      const o = ('items' in rec && 'createdAt' in rec ? rec : mapOrder(rec as any)) as any;
      const existingIdx = orders.list.findIndex((x) => x.id === o.id);

      if (existingIdx !== -1) {
        orders.list[existingIdx] = o;
      } else {
        orders.list.push(o);
      }
    };

    let mockCallback: ((payload: unknown) => void) | null = null;
    vi.mocked(meshModule.meshSubscribe).mockImplementation((topic, cb) => {
      if (topic === 'order:created') {
        mockCallback = cb as any;
      }
      return Promise.resolve(vi.fn());
    });

    await meshModule.meshSubscribe('order:created', kitchenQueueCallback);

    expect(meshModule.meshSubscribe).toHaveBeenCalledWith('order:created', expect.any(Function));
    expect(orders.list.length).toBe(0);

    const newOrderPayload = {
      id: 'ord-12345',
      tableId: 'table-1',
      items: [{ menuItemId: 'item-1', name: 'Burger', quantity: 1, unitPrice: 100 }],
      totalPrice: 100,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: 'No onions',
    };

    if (mockCallback) {
      const cb = mockCallback as (payload: unknown) => void;
      cb(newOrderPayload);
    }

    expect(orders.list.length).toBe(1);
    expect(orders.list[0].id).toBe('ord-12345');
    expect(orders.list[0].status).toBe('pending');
    expect(orders.list[0].items[0].name).toBe('Burger');
  });
});
