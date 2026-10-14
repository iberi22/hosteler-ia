import { describe, it, expect } from 'vitest';
import { publicOrderStatus } from './orderPublicStatus';

describe('publicOrderStatus', () => {
  it('exposes only status and label, never items, totals, table or customer data', () => {
    const out = publicOrderStatus({
      id: 'a', status: 'preparing', tableId: 't1', total: 70000, items: [{ menuItemId: 'm1' }], customer: 'Ana',
    });
    expect(out).toEqual({ status: 'preparing', label: expect.any(String) });
    expect(Object.keys(out ?? {}).sort()).toEqual(['label', 'status']);
  });

  it('returns null for a missing order', () => {
    expect(publicOrderStatus(null)).toBeNull();
    expect(publicOrderStatus(undefined)).toBeNull();
  });

  it('returns null for a deleted order', () => {
    expect(publicOrderStatus({ status: 'ready', deleted_at: '2026-10-14' })).toBeNull();
  });

  it('returns null for an unknown status instead of leaking a raw value', () => {
    expect(publicOrderStatus({ status: 'secret-internal' })).toBeNull();
  });
});
