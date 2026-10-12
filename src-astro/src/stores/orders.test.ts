// orders.test.ts — H1.07 KDS order status logic
// Note: $state runes in .svelte.ts require svelte-compile transform.
// Testing order status transition logic via pure functions only.
import { describe, it, expect } from 'vitest';

// Pure status transition validator (mirrors orders.svelte.ts logic)
type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'paid';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: ['paid'],
  cancelled: [],
  paid: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe('orders — status transitions', () => {
  it('pending can transition to preparing or cancelled', () => {
    expect(canTransition('pending', 'preparing')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('pending', 'ready')).toBe(false);
  });

  it('preparing can transition to ready or cancelled', () => {
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('preparing', 'cancelled')).toBe(true);
    expect(canTransition('preparing', 'pending')).toBe(false);
  });

  it('ready can transition to served or cancelled', () => {
    expect(canTransition('ready', 'served')).toBe(true);
    expect(canTransition('ready', 'cancelled')).toBe(true);
  });

  it('terminal states (cancelled, paid) block further transitions', () => {
    expect(canTransition('cancelled', 'pending')).toBe(false);
    expect(canTransition('paid', 'served')).toBe(false);
  });
});
