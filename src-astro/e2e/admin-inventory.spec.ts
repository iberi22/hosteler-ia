import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// Este test encadena 5 llamadas contra la D1 real. Con el presupuesto por
// defecto de Playwright (30 s para el test entero) se caia de forma intermitente
// con "apiRequestContext: Request context disposed": no era el producto, era que el
// reloj del test se agotaba. Solo se amplia el tiempo; las aserciones quedan intactas.
  test.slow();
test('admin inventory CRUD and ledger transaction flow', async ({ request }) => {
  const nonce = Date.now();
  const cookie = await staffCookie(request);
  const itemName = `E2E Item ${nonce}`;

  // 1. Create inventory item with initial stock 0 (staff write: session required)
  const createRes = await request.post('/api/inventory', {
    ...authHeaders(cookie),
    data: { name: itemName, unit: 'kg', minStock: 5 },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  expect(created.id).toBeDefined();
  expect(created.name).toBe(itemName);
  expect(created.stock).toBe(0);

  // 2. GET list contains created item
  const listRes = await request.get('/api/inventory');
  expect(listRes.status()).toBe(200);
  const list = await listRes.json();
  const found = list.find((i: { id: string }) => i.id === created.id);
  expect(found).toBeDefined();
  expect(found.name).toBe(itemName);

  // 3. POST purchase transaction to increase stock
  const txRes = await request.post(`/api/inventory/${created.id}/transactions`, {
    ...authHeaders(cookie),
    data: { kind: 'purchase', qty: 15, note: 'E2E restock' },
  });
  expect(txRes.status()).toBe(201);
  const txData = await txRes.json();
  expect(txData.transaction).toBeDefined();
  expect(txData.item.stock).toBe(15);

  // 4. GET item directly reflects increased stock
  const itemRes = await request.get(`/api/inventory/${created.id}`);
  expect(itemRes.status()).toBe(200);
  const item = await itemRes.json();
  expect(item.stock).toBe(15);
});

test('inventory page loads 200 and passes mock-killer assertion', async ({ request }) => {
  const res = await request.get('/dashboard/inventory');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toContain('Tomates');
});

test.describe('browser rendering', () => {

  test('inventory page renders in browser', async ({ page }) => {
    await page.goto('/dashboard/inventory');
    await expect(page.locator('body')).not.toContainText('Tomates');
  });
});

// Las compras entran por el libro de inventario (ENLACE-ENTRE-APPS L0): antes la siguiente venta o ajuste
// recalculaba el stock desde el libro y borraba lo comprado.
test('compra → venta → ajuste: el stock comprado se conserva y reenviar la factura no duplica', async ({ request }) => {
  test.slow();
  const nonce = Date.now();
  const cookie = await staffCookie(request);
  const auth = authHeaders(cookie);

  const supplier = await (await request.post('/api/suppliers', { ...auth, data: { name: `Proveedor E2E ${nonce}` } })).json();
  const itemRes = await request.post('/api/inventory', { ...auth, data: { name: `Papa E2E ${nonce}`, unit: 'kg', unitCost: 4000 } });
  expect(itemRes.status()).toBe(201);
  const item = await itemRes.json();

  // Compra de 12 kg; el mismo envio otra vez (doble clic) no suma de nuevo.
  const factura = {
    supplierId: supplier.id,
    invoiceNumber: `FV-${nonce}`,
    invoiceDate: '2026-10-02',
    taxRate: 0.19,
    lines: [{ inventoryItemId: item.id, name: 'Papa', qty: 12, unit: 'kg', unitCost: 4500 }],
  };
  const compra = await request.post('/api/purchases', { ...auth, data: factura });
  expect(compra.status()).toBe(201);
  const repetida = await request.post('/api/purchases', { ...auth, data: factura });
  expect(repetida.status()).toBe(200);
  expect((await (await request.get(`/api/inventory/${item.id}`)).json()).stock).toBe(12);

  // Venta: plato con receta de 2 kg, pedido de 3 servido = 6 kg.
  const category = await (await request.post('/api/categories', { ...auth, data: { name: `Cocina ${nonce}` } })).json();
  const dish = await (
    await request.post('/api/menu-items', {
      ...auth,
      data: { name: `Papas ${nonce}`, price: 9000, categoryId: category.id, recipe: [{ inventoryId: item.id, qty: 2 }] },
    })
  ).json();
  const table = await (
    await request.post('/api/tables', { ...auth, data: { number: Math.floor(Math.random() * 800) + 100, capacity: 4 } })
  ).json();
  const order = await (await request.post('/api/orders', { ...auth, data: { tableId: table.id, items: [{ menuItemId: dish.id, qty: 3 }] } })).json();
  for (const to of ['preparing', 'ready', 'served']) {
    expect((await request.post(`/api/orders/${order.id}/transition`, { ...auth, data: { to } })).status()).toBe(200);
  }
  expect((await (await request.get(`/api/inventory/${item.id}`)).json()).stock).toBe(6);

  // Ajuste por conteo: +1 kg.
  const ajuste = await request.post(`/api/inventory/${item.id}/transactions`, { ...auth, data: { kind: 'adjust', qty: 1, note: 'conteo' } });
  expect(ajuste.status()).toBe(201);
  expect((await ajuste.json()).item.stock).toBe(7);
  expect((await (await request.get(`/api/inventory/${item.id}`)).json()).stock).toBe(7);
});
