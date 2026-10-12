import { describe, it, expect } from 'vitest';
import { normalizeOrdersPayload } from './orderSync';

describe('normalizeOrdersPayload', () => {
  it('normalizes a bare array response', () => {
    const rawArray = [
      {
        id: 'ord-1',
        tableId: '4',
        status: 'pending',
        items: [{ menuItemId: 'm1', name: 'Café', qty: 2, price: 2.5 }],
        created_at: '2026-09-05T10:00:00.000Z',
        updated_at: '2026-09-05T10:00:00.000Z',
      },
      {
        id: 'ord-2',
        tableId: '2',
        status: 'preparing',
        items: [{ menuItemId: 'm2', name: 'Tostada', quantity: 1, unitPrice: 3.0 }],
        created_at: '2026-09-05T10:05:00.000Z',
        updated_at: '2026-09-05T10:05:00.000Z',
      },
    ];

    const result = normalizeOrdersPayload(rawArray);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ord-1');
    expect(result[0].status).toBe('pending');
    expect(result[0].items[0]).toMatchObject({ menuItemId: 'm1', quantity: 2, unitPrice: 2.5 });
    expect(result[0].totalPrice).toBe(5);

    expect(result[1].id).toBe('ord-2');
    expect(result[1].items[0]).toMatchObject({ menuItemId: 'm2', quantity: 1, unitPrice: 3.0 });
  });

  it('normalizes a wrapped { list: [...] } response', () => {
    const wrapped = {
      list: [
        {
          id: 'ord-3',
          tableId: '10',
          status: 'ready',
          items: [{ menuItemId: 'm3', name: 'Zumo', qty: 3, unitPrice: 3.5 }],
        },
      ],
    };

    const result = normalizeOrdersPayload(wrapped);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ord-3');
    expect(result[0].status).toBe('ready');
    expect(result[0].totalPrice).toBe(10.5);
  });

  it('handles garbage, null, undefined, or empty payloads gracefully', () => {
    expect(normalizeOrdersPayload(null)).toEqual([]);
    expect(normalizeOrdersPayload(undefined)).toEqual([]);
    expect(normalizeOrdersPayload('not json')).toEqual([]);
    expect(normalizeOrdersPayload({})).toEqual([]);
    expect(normalizeOrdersPayload({ list: 'not array' })).toEqual([]);
  });
});
