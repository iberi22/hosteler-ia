import { describe, it, expect } from 'vitest';
import { cartTotals, buildOrderPayload } from './cartView';

describe('cart view helpers (CartSidebar logic)', () => {
  const lines = [
    { menuItemId: 'm1', name: 'Olivas', quantity: 2, unitPrice: 3, totalPrice: 6 },
    { menuItemId: 'm2', name: 'Café', quantity: 1, unitPrice: 2, totalPrice: 2 },
  ];

  it('totals count and subtotal', () => {
    expect(cartTotals(lines)).toEqual({ count: 3, subtotal: 8 });
    expect(cartTotals([])).toEqual({ count: 0, subtotal: 0 });
  });

  it('builds API-ready order payload', () => {
    expect(buildOrderPayload('t1', lines)).toEqual({
      tableId: 't1',
      items: [
        { menuItemId: 'm1', qty: 2 },
        { menuItemId: 'm2', qty: 1 },
      ],
    });
  });
});
