import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listCategories, POST as createCategory } from '../pages/api/categories/index';
import { GET as getCategory, PATCH as updateCategory, DELETE as deleteCategory } from '../pages/api/categories/[id]';
import { GET as listMenuItems, POST as createMenuItem } from '../pages/api/menu-items/index';
import { GET as getMenuItem, PATCH as updateMenuItem, DELETE as deleteMenuItem } from '../pages/api/menu-items/[id]';
import { getMemoryAdapter } from './domain';

describe('Menu API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) => ({
    request: req,
    params,
    locals: { user: mockUser },
  }) as any;

  const postJson = (url: string, method: string, payload: unknown, params: Record<string, string> = {}) => {
    const req = new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { req, params };
  };

  const createCat = async (name = 'Entrantes') => {
    const { req } = postJson('http://localhost/api/categories', 'POST', { name });
    const res = await createCategory(mockContext(req));
    expect(res.status).toBe(201);
    return res.json();
  };

  it('POST /api/categories - creates a category', async () => {
    const cat = await createCat('Postres');
    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('Postres');
    expect(cat.instance_id).toBe('default');
  });

  it('GET /api/categories - lists categories, hides soft-deleted', async () => {
    const cat = await createCat();
    const delReq = new Request(`http://localhost/api/categories/${cat.id}`, { method: 'DELETE' });
    await deleteCategory(mockContext(delReq, { id: cat.id }));

    const res = await listCategories(mockContext(new Request('http://localhost/api/categories')));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(0);
  });

  it('PATCH /api/categories/[id] - renames a category', async () => {
    const cat = await createCat();
    const { req } = postJson(`http://localhost/api/categories/${cat.id}`, 'PATCH', { name: 'Primeros' });
    const res = await updateCategory(mockContext(req, { id: cat.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Primeros');
  });

  it('GET /api/categories/[id] - 404 when missing', async () => {
    const res = await getCategory(mockContext(new Request('http://localhost/api/categories/nope'), { id: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('POST /api/menu-items - creates an item in a category', async () => {
    const cat = await createCat();
    const { req } = postJson('http://localhost/api/menu-items', 'POST', {
      name: 'Tortilla',
      price: 8.5,
      categoryId: cat.id,
    });
    const res = await createMenuItem(mockContext(req));
    expect(res.status).toBe(201);

    const item = await res.json();
    expect(item.price).toBe(8.5);
    expect(item.categoryId).toBe(cat.id);
  });

  it('POST /api/menu-items - rejects price <= 0 and unknown category', async () => {
    const cat = await createCat();

    const free = postJson('http://localhost/api/menu-items', 'POST', {
      name: 'Gratis',
      price: 0,
      categoryId: cat.id,
    });
    expect((await createMenuItem(mockContext(free.req))).status).toBe(400);

    const orphan = postJson('http://localhost/api/menu-items', 'POST', {
      name: 'Huérfano',
      price: 5,
      categoryId: 'missing',
    });
    expect((await createMenuItem(mockContext(orphan.req))).status).toBe(422);
  });

  it('GET /api/menu-items?categoryId= - filters by category', async () => {
    const c1 = await createCat('A');
    const c2 = await createCat('B');
    await createMenuItem(
      mockContext(
        postJson('http://localhost/api/menu-items', 'POST', { name: 'Uno', price: 3, categoryId: c1.id }).req,
      ),
    );
    await createMenuItem(
      mockContext(
        postJson('http://localhost/api/menu-items', 'POST', { name: 'Dos', price: 4, categoryId: c2.id }).req,
      ),
    );

    const res = await listMenuItems(mockContext(new Request(`http://localhost/api/menu-items?categoryId=${c1.id}`)));
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Uno');
  });

  it('PATCH + DELETE /api/menu-items/[id] - update price, soft delete', async () => {
    const cat = await createCat();
    const created = await (
      await createMenuItem(
        mockContext(
          postJson('http://localhost/api/menu-items', 'POST', { name: 'Paella', price: 14, categoryId: cat.id }).req,
        ),
      )
    ).json();

    const patch = postJson(`http://localhost/api/menu-items/${created.id}`, 'PATCH', { price: 16 });
    const updated = await updateMenuItem(mockContext(patch.req, { id: created.id }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).price).toBe(16);

    const bad = postJson(`http://localhost/api/menu-items/${created.id}`, 'PATCH', { price: -2 });
    expect((await updateMenuItem(mockContext(bad.req, { id: created.id }))).status).toBe(400);

    const del = await deleteMenuItem(
      mockContext(new Request(`http://localhost/api/menu-items/${created.id}`, { method: 'DELETE' }), {
        id: created.id,
      }),
    );
    expect(del.status).toBe(200);

    const gone = await getMenuItem(
      mockContext(new Request(`http://localhost/api/menu-items/${created.id}`), { id: created.id }),
    );
    expect(gone.status).toBe(404);
  });
  it('PATCH guarda disponibilidad y visibilidad del plato y el estado de la categoría (antes zod los descartaba)', async () => {
    const cat = await createCat();
    const created = await (
      await createMenuItem(
        mockContext(postJson('http://localhost/api/menu-items', 'POST', { name: 'Arepa', price: 5, categoryId: cat.id }).req),
      )
    ).json();
    const patch = postJson(`http://localhost/api/menu-items/${created.id}`, 'PATCH', { isAvailable: false, isPublic: false });
    const updated = await (await updateMenuItem(mockContext(patch.req, { id: created.id }))).json();
    expect(updated.isAvailable).toBe(false);
    expect(updated.isPublic).toBe(false);
    const bad = postJson(`http://localhost/api/menu-items/${created.id}`, 'PATCH', { isAvailable: 'no' });
    expect((await updateMenuItem(mockContext(bad.req, { id: created.id }))).status).toBe(400);

    const catPatch = postJson(`http://localhost/api/categories/${cat.id}`, 'PATCH', { isActive: false });
    expect((await (await updateCategory(mockContext(catPatch.req, { id: cat.id }))).json()).isActive).toBe(false);
  });
});
