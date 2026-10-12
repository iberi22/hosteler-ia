// menuSync.test.ts — Unit tests for pure menuSync API helpers
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchCategoriesApi,
  fetchMenuItemsApi,
  createCategoryApi,
  updateCategoryApi,
  deleteCategoryApi,
  createMenuItemApi,
  updateMenuItemApi,
  deleteMenuItemApi,
} from './menuSync';

describe('menuSync API helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchCategoriesApi and fetchMenuItemsApi transform API domain records correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/categories')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'cat-1', name: 'Bebidas', sortOrder: 1, created_at: '2025-01-01', updated_at: '2025-01-01' },
            ]),
            { status: 200 },
          ),
        );
      }
      if (url.includes('/api/menu-items')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'm1',
                sku: 'BEB-01',
                name: 'Agua',
                price: 2.0,
                categoryId: 'cat-1',
                created_at: '2025-01-01',
                updated_at: '2025-01-01',
              },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error('Unknown endpoint'));
    }));

    const cats = await fetchCategoriesApi();
    expect(cats).toHaveLength(1);
    expect(cats[0]).toEqual({
      id: 'cat-1',
      name: 'Bebidas',
      description: undefined,
      sortOrder: 1,
      isActive: true,
    });

    const items = await fetchMenuItemsApi();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 'm1',
      sku: 'BEB-01',
      name: 'Agua',
      description: undefined,
      price: 2.0,
      categoryId: 'cat-1',
      isAvailable: true,
      tags: [],
    });
  });

  it('createCategoryApi posts data and returns mapped StoreMenuCategory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'cat-new',
            name: 'Postres',
            created_at: '2025-01-01',
            updated_at: '2025-01-01',
          }),
          { status: 201 },
        ),
      ),
    );

    const res = await createCategoryApi({ name: 'Postres' });
    expect(res.id).toBe('cat-new');
    expect(res.name).toBe('Postres');
  });

  it('createMenuItemApi handles server error with validation details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'Validation failed',
            details: { price: 'Price must be positive' },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(
      createMenuItemApi({ name: 'Plato', price: -5, categoryId: 'cat-1' }),
    ).rejects.toThrow('Validation failed: {"price":"Price must be positive"}');
  });

  it('updateCategoryApi, updateMenuItemApi, deleteCategoryApi, deleteMenuItemApi succeed on ok responses', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH' && url.includes('/api/categories/c1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c1', name: 'Entrantes Nuevos' }), { status: 200 }),
        );
      }
      if (method === 'PATCH' && url.includes('/api/menu-items/m1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'm1', name: 'Sopa', price: 5.5 }), { status: 200 }),
        );
      }
      if (method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'Deleted' }), { status: 200 }));
      }
      return Promise.reject(new Error('Unexpected fetch call'));
    });

    vi.stubGlobal('fetch', fetchMock);

    const updatedCat = await updateCategoryApi('c1', { name: 'Entrantes Nuevos' });
    expect(updatedCat.name).toBe('Entrantes Nuevos');

    const updatedItem = await updateMenuItemApi('m1', { price: 5.5 });
    expect(updatedItem.price).toBe(5.5);

    await expect(deleteCategoryApi('c1')).resolves.toBeUndefined();
    await expect(deleteMenuItemApi('m1')).resolves.toBeUndefined();
  });
});
