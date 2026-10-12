import { describe, it, expect } from 'vitest';
import { ORDER_STATUSES, isOrderStatus, canTransition, assertTransition } from './orderStateMachine';

describe('Order State Machine', () => {
  it('exposes the 6 UI-compatible statuses', () => {
    expect([...ORDER_STATUSES]).toEqual(['pending', 'preparing', 'ready', 'served', 'paid', 'cancelled']);
  });

  it('validates status values', () => {
    expect(isOrderStatus('pending')).toBe(true);
    expect(isOrderStatus('delivered')).toBe(false);
    expect(isOrderStatus('confirmed')).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
  });

  it('allows the happy path pending → paid', () => {
    expect(canTransition('pending', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'served')).toBe(true);
    expect(canTransition('served', 'paid')).toBe(true);
  });

  it('allows cancellation only from pending/preparing', () => {
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('preparing', 'cancelled')).toBe(true);
    expect(canTransition('ready', 'cancelled')).toBe(false);
    expect(canTransition('served', 'cancelled')).toBe(false);
  });

  it('rejects skips, backwards moves and terminal exits', () => {
    expect(canTransition('pending', 'ready')).toBe(false);
    expect(canTransition('ready', 'preparing')).toBe(false);
    expect(canTransition('paid', 'pending')).toBe(false);
    expect(canTransition('cancelled', 'pending')).toBe(false);
    expect(canTransition('paid', 'cancelled')).toBe(false);
  });

  it('assertTransition throws with a clear message on invalid moves', () => {
    expect(() => assertTransition('pending', 'preparing')).not.toThrow();
    expect(() => assertTransition('pending', 'served')).toThrow('pending → served');
  });
});
