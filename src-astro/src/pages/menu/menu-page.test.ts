import { describe, it, expect, beforeEach } from 'vitest';
import { loadPublicMenu } from '../../lib/publicMenu';
import { getMemoryAdapter } from '../../lib/domain';

describe('public menu loader (smoke)', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const seed = async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    const mk = (entity: string, id: string, extra: Record<string, unknown> = {}) =>
      adapter.create(entity, {
        id,
        instance_id: 'default',
        created_at: now,
        updated_at: now,
        ...extra,
      } as any);
    await mk('restaurant', 'r1', { name: 'Casa Paco', slug: 'casa-paco', address: 'C/ Mayor 1' });
    await mk('category', 'c1', { name: 'Entrantes' });
    await mk('menuItem', 'm1', { name: 'Olivas', price: 3, categoryId: 'c1' });
    await mk('menuItem', 'm2', { name: 'Borrado', price: 9, categoryId: 'c1', deleted_at: now });
    return adapter;
  };

  it('loads restaurant + categories + only active items', async () => {
    const menu = await loadPublicMenu(await seed(), 'default', 'r1');
    expect(menu.restaurant?.name).toBe('Casa Paco');
    expect(menu.categories).toHaveLength(1);
    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]).toMatchObject({ name: 'Olivas', price: 3 });
  });

  it('returns null restaurant when missing', async () => {
    const menu = await loadPublicMenu(await seed(), 'default', 'nope');
    expect(menu.restaurant).toBeNull();
    expect(menu.items).toHaveLength(1);
  });
});
