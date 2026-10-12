import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildContext, buildPrompt, parseRecommendations, getRecommendations } from './recommendations';
import { getMemoryAdapter } from './domain';

describe('recommendations engine', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const seed = async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    const mk = (entity: string, id: string, extra: Record<string, unknown> = {}) =>
      adapter.create(entity, { id, instance_id: 'default', created_at: now, updated_at: now, ...extra } as any);
    await mk('restaurant', 'r1', { name: 'Casa Paco' });
    await mk('inventoryItem', 'i1', { name: 'Harina', unit: 'kg', stock: 2 });
    await mk('inventoryItem', 'i2', { name: 'Aceite', unit: 'l', stock: 50 });
    await mk('menuItem', 'm1', { name: 'Tortilla', price: 8, categoryId: 'c1' });
    await mk('order', 'o1', {
      tableId: 't1',
      status: 'pending',
      items: [
        { menuItemId: 'm1', qty: 3 },
        { menuItemId: 'm9', qty: 1 },
      ],
    });
    return adapter;
  };

  it('builds context with low stock, top sales and pending count', async () => {
    const ctx = await buildContext(await seed(), 'default');
    expect(ctx.restaurantName).toBe('Casa Paco');
    expect(ctx.lowStock).toEqual([{ name: 'Harina', stock: 2 }]);
    expect(ctx.topItems[0]).toMatchObject({ name: 'Tortilla', qty: 3 });
    expect(ctx.pendingOrders).toBe(1);
  });

  it('prompt mentions key facts and asks for JSON', () => {
    const prompt = buildPrompt({ restaurantName: 'X', lowStock: [], topItems: [], pendingOrders: 0 });
    expect(prompt).toContain('X');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('restock|promo|menu|ops');
  });

  it('parses valid arrays, caps at 5, defaults bad types to ops', () => {
    const recs = parseRecommendations(
      JSON.stringify([
        { type: 'restock', title: 'A', detail: 'a' },
        { type: 'weird', title: 'B', detail: 'b' },
      ]),
    );
    expect(recs).toHaveLength(2);
    expect(recs[1].type).toBe('ops');
    expect(() => parseRecommendations('no-json')).toThrow();
  });

  it('end-to-end with mock infer, graceful on garbage', async () => {
    const adapter = await seed();
    const infer = vi.fn(async () => JSON.stringify([{ type: 'promo', title: 'Tortilla 2x1', detail: 'Mueve stock' }]));
    const recs = await getRecommendations(adapter, 'default', infer);
    expect(infer).toHaveBeenCalledOnce();
    const firstCall = infer.mock.calls[0] as unknown[];
    expect(String(firstCall[0])).toContain('Casa Paco');
    expect(recs[0]).toMatchObject({ type: 'promo' });

    const bad = await getRecommendations(adapter, 'default', async () => 'basura');
    expect(bad[0].title).toBe('Sin recomendaciones');
  });
});
