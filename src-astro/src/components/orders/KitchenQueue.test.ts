import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as meshModule from '../../lib/mesh';
import { orders, clearOrders } from '../../stores/orders.svelte';
import { render, act } from '@testing-library/svelte';
import KitchenQueue from './KitchenQueue.svelte';

vi.mock('../../lib/mesh', () => ({
  meshSubscribe: vi.fn(),
  meshPublish: vi.fn(),
}));

describe('KitchenQueue', () => {
  beforeEach(() => {
    clearOrders();
    vi.clearAllMocks();
    Element.prototype.scrollTo = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a new order when order:created event is received via meshSubscribe', async () => {
    let mockCallback: ((payload: unknown) => void) | null = null;
    vi.mocked(meshModule.meshSubscribe).mockImplementation((topic, cb) => {
      if (topic === 'order:created') {
        mockCallback = cb;
      }
      return Promise.resolve(vi.fn());
    });

    const { unmount } = render(KitchenQueue, { autoPublish: false });

    // Wait for onMount
    await new Promise(r => setTimeout(r, 0));

    expect(meshModule.meshSubscribe).toHaveBeenCalledWith('order:created', expect.any(Function));
    expect(mockCallback).not.toBeNull();
    expect(orders.list.length).toBe(0);

    const newOrderPayload = {
      id: 'ord-123',
      tableId: 't1',
      items: [{ menuItemId: 'm1', name: 'Dish', quantity: 1, unitPrice: 100 }],
      totalPrice: 100,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await act(() => {
      if (mockCallback) mockCallback(newOrderPayload);
    });

    expect(orders.list.length).toBe(1);
    expect(orders.list[0].id).toBe('ord-123');

    unmount();
  });
});
