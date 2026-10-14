import { describe, it, expect, beforeAll } from 'vitest';

describe('Stores Smoke Tests', () => {
  beforeAll(() => {
    // @ts-ignore
    globalThis.$state = (v: any) => v;
  });

  it('auth store has correct initial state', async () => {
    const { auth } = await import('./auth.svelte');
    expect(auth.user).toBeNull();
    expect(auth.session).toBeNull();
    expect(auth.profile).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.isLoading).toBe(false);
    expect(auth.isInitialized).toBe(false);
  });

  it('cart store has correct initial state', async () => {
    const { cart } = await import('./cart.svelte');
    expect(cart.items).toEqual([]);
    expect(cart.tableId).toBeNull();
    expect(cart.isLoading).toBe(false);
  });

  it('inventory store has correct initial state', async () => {
    const { inventory } = await import('./inventory.svelte');
    expect(inventory.items).toEqual([]);
    expect(inventory.isLoading).toBe(false);
    expect(inventory.lastUpdated).toBeNull();
  });
});
