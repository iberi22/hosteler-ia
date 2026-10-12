import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// Este test encadena 8 llamadas contra la D1 real (inventario, categoria, plato,
// mesa, pedido, transicion, consulta del KDS, dashboard). Con el presupuesto por
// defecto de Playwright (30 s para el test entero) se caia de forma intermitente
// con "apiRequestContext.get: Request context disposed": no era el producto, era
// que el reloj del test se agotaba. Solo se amplia el tiempo; la cadena de
// aserciones queda intacta.
test('full H3 business proof: order flow, recipe auto-deduction, and KDS status query', async ({ request }) => {
  test.slow();
  const nonce = Date.now();
  const cookie = await staffCookie(request);

  // 1. Seed inventory item with initial stock 10 (staff write: session required)
  const invRes = await request.post('/api/inventory', {
    ...authHeaders(cookie),
    data: { name: `Ingrediente Principal ${nonce}`, unit: 'u', initialStock: 10 },
  });
  expect(invRes.status()).toBe(201);
  const invItem = await invRes.json();
  expect(invItem.stock).toBe(10);

  // 2. Create category & menu item with recipe [ { inventoryId: invItem.id, qty: 2 } ]
  const catRes = await request.post('/api/categories', {
    ...authHeaders(cookie),
    data: { name: `Cocina ${nonce}` },
  });
  expect(catRes.status()).toBe(201);
  const category = await catRes.json();

  const menuItemRes = await request.post('/api/menu-items', {
    ...authHeaders(cookie),
    data: {
      name: `Plato Especial ${nonce}`,
      price: 18.0,
      categoryId: category.id,
      recipe: [{ inventoryId: invItem.id, qty: 2 }],
    },
  });
  expect(menuItemRes.status()).toBe(201);
  const menuItem = await menuItemRes.json();

  // 3. Create table & order with qty 3
  const tableRes = await request.post('/api/tables', {
    ...authHeaders(cookie),
    data: { number: Math.floor(Math.random() * 800) + 100, capacity: 4 },
  });
  expect(tableRes.status()).toBe(201);
  const table = await tableRes.json();

  const orderRes = await request.post('/api/orders', {
    ...authHeaders(cookie),
    data: { tableId: table.id, items: [{ menuItemId: menuItem.id, qty: 3 }] },
  });
  expect(orderRes.status()).toBe(201);
  const order = await orderRes.json();
  expect(order.status).toBe('pending');

  // 4. Transition order status: pending -> preparing -> ready -> served
  for (const targetStatus of ['preparing', 'ready', 'served']) {
    const trRes = await request.post(`/api/orders/${order.id}/transition`, {
      ...authHeaders(cookie),
      data: { to: targetStatus },
    });
    expect(trRes.status()).toBe(200);
    const trData = await trRes.json();
    expect(trData.status).toBe(targetStatus);
    if (targetStatus === 'served') {
      expect(trData.stockDeducted).toBeDefined();
    }
  }

  // 5. Verify inventory stock was deducted: initial 10 - (2 * 3) = 4
  const updatedInvRes = await request.get(`/api/inventory/${invItem.id}`);
  expect(updatedInvRes.status()).toBe(200);
  const updatedInv = await updatedInvRes.json();
  expect(updatedInv.stock).toBe(4);

  // 6. Repeat transition to served -> expect 400 or no double deduction
  const repeatTr = await request.post(`/api/orders/${order.id}/transition`, {
    ...authHeaders(cookie),
    data: { to: 'served' },
  });
  expect(repeatTr.status()).toBe(400);

  const recheckInvRes = await request.get(`/api/inventory/${invItem.id}`);
  expect(recheckInvRes.status()).toBe(200);
  const recheckInv = await recheckInvRes.json();
  expect(recheckInv.stock).toBe(4);

  // 7. GET /api/orders?status=served contains the served order (KDS consumption endpoint)
  const kdsRes = await request.get('/api/orders?status=served');
  expect(kdsRes.status()).toBe(200);
  const servedOrders = await kdsRes.json();
  const foundOrder = servedOrders.find((o: { id: string }) => o.id === order.id);
  expect(foundOrder).toBeDefined();
  expect(foundOrder.status).toBe('served');
});

test('KDS kitchen dashboard loads 200', async ({ request }) => {
  const res = await request.get('/dashboard/kitchen');
  expect(res.status()).toBe(200);
});

test.describe('browser rendering', () => {

  test('kitchen page renders in browser', async ({ page }) => {
    await page.goto('/dashboard/kitchen');
    await expect(page.locator('body')).toBeVisible();
  });
});
