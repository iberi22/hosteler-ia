import { describe, expect, it } from 'vitest';
import {
  buildTakeOrderPayload,
  isDishOrderable,
  orderableDishes,
  takeOrderTotal,
} from './takeOrder';

const DISHES = [
  { id: 'm1', name: 'Sancocho', price: 18000 },
  { id: 'm2', name: 'Agua de panela', price: 4000 },
  { id: 'm3', name: 'Borrado', price: 9000, deleted_at: '2026-10-01T00:00:00.000Z' },
  { id: 'm4', name: 'Agotado', price: 7000, isAvailable: false },
];

describe('isDishOrderable', () => {
  it('acepta platos normales', () => {
    expect(isDishOrderable(DISHES[0])).toBe(true);
    expect(isDishOrderable(DISHES[1])).toBe(true);
  });

  it('rechaza borrados y no disponibles', () => {
    expect(isDishOrderable(DISHES[2])).toBe(false);
    expect(isDishOrderable(DISHES[3])).toBe(false);
  });

  it('rechaza platos sin id', () => {
    expect(isDishOrderable({ id: '', name: 'X', price: 1000 })).toBe(false);
  });
});

describe('orderableDishes', () => {
  it('la carta del personal salta borrados y no disponibles', () => {
    expect(orderableDishes(DISHES).map((d) => d.id)).toEqual(['m1', 'm2']);
  });

  it('tolera lista vacia', () => {
    expect(orderableDishes([])).toEqual([]);
  });
});

describe('takeOrderTotal', () => {
  it('suma qty x precio (18000 + 4000 = 22000)', () => {
    expect(takeOrderTotal({ m1: 1, m2: 1 }, DISHES)).toBe(22000);
  });

  it('respeta cantidades mayores que 1', () => {
    expect(takeOrderTotal({ m1: 2, m2: 3 }, DISHES)).toBe(2 * 18000 + 3 * 4000);
  });

  it('ignora cantidades invalidas y platos desconocidos', () => {
    expect(takeOrderTotal({ m1: 0, m2: -1, xxx: 2 }, DISHES)).toBe(0);
    expect(takeOrderTotal({}, DISHES)).toBe(0);
  });
});

describe('buildTakeOrderPayload', () => {
  it('arma tableId + items + nota', () => {
    expect(buildTakeOrderPayload('t1', { m2: 1, m1: 2 }, 'Sin cebolla')).toEqual({
      tableId: 't1',
      items: [
        { menuItemId: 'm1', qty: 2 },
        { menuItemId: 'm2', qty: 1 },
      ],
      note: 'Sin cebolla',
    });
  });

  it('omite la nota cuando viene vacia', () => {
    expect(buildTakeOrderPayload('t1', { m1: 1 }, '   ')).toEqual({
      tableId: 't1',
      items: [{ menuItemId: 'm1', qty: 1 }],
    });
  });

  it('null sin mesa o sin platos', () => {
    expect(buildTakeOrderPayload('', { m1: 1 })).toBeNull();
    expect(buildTakeOrderPayload('t1', {})).toBeNull();
    expect(buildTakeOrderPayload('t1', { m1: 0 })).toBeNull();
  });
});
