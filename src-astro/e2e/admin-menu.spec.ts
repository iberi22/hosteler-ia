import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// Este test encadena 7 llamadas contra la D1 real. Con el presupuesto por
// defecto de Playwright (30 s para el test entero) se caia de forma intermitente
// con "apiRequestContext: Request context disposed": no era el producto, era que el
// reloj del test se agotaba. Solo se amplia el tiempo; las aserciones quedan intactas.
  test.slow();
test('admin menu CRUD with recipe persistence and price updates', async ({ request }) => {
  const nonce = Date.now();
  const cookie = await staffCookie(request);

  // 1. Create a category (staff write: session required)
  const catRes = await request.post('/api/categories', {
    ...authHeaders(cookie),
    data: { name: `Cat ${nonce}` },
  });
  expect(catRes.status()).toBe(201);
  const category = await catRes.json();

  // 2. Create an inventory item for recipe line
  const invRes = await request.post('/api/inventory', {
    ...authHeaders(cookie),
    data: { name: `Ingrediente ${nonce}`, unit: 'kg' },
  });
  expect(invRes.status()).toBe(201);
  const invItem = await invRes.json();

  // 3. Create menu item with recipe referring to the inventory item
  const menuItemRes = await request.post('/api/menu-items', {
    ...authHeaders(cookie),
    data: {
      name: `Plato ${nonce}`,
      price: 12.5,
      categoryId: category.id,
      recipe: [{ inventoryId: invItem.id, qty: 2 }],
    },
  });
  expect(menuItemRes.status()).toBe(201);
  const menuItem = await menuItemRes.json();
  expect(menuItem.id).toBeDefined();
  expect(menuItem.recipe).toEqual([{ inventoryId: invItem.id, qty: 2 }]);

  // 4. GET menu item by ID -> contains recipe
  const getRes = await request.get(`/api/menu-items/${menuItem.id}`);
  expect(getRes.status()).toBe(200);
  const fetched = await getRes.json();
  expect(fetched.name).toBe(`Plato ${nonce}`);
  expect(fetched.recipe).toEqual([{ inventoryId: invItem.id, qty: 2 }]);

  // 5. PATCH price -> GET reflects price update
  const patchRes = await request.patch(`/api/menu-items/${menuItem.id}`, {
    ...authHeaders(cookie),
    data: { price: 15.0 },
  });
  expect(patchRes.status()).toBe(200);
  const patched = await patchRes.json();
  expect(patched.price).toBe(15.0);

  const getPatched = await request.get(`/api/menu-items/${menuItem.id}`);
  expect(getPatched.status()).toBe(200);
  expect((await getPatched.json()).price).toBe(15.0);
});

test('admin menu page loads 200', async ({ request }) => {
  const res = await request.get('/dashboard/menu');
  expect(res.status()).toBe(200);
});

test.describe('browser rendering', () => {

  test('admin menu page renders in browser', async ({ page }) => {
    await page.goto('/dashboard/menu');
    await expect(page.locator('body')).toBeVisible();
  });
});
