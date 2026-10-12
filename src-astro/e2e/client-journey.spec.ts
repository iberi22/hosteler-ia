import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

test('customer journey: QR table → add to cart → send to kitchen → order exists', async ({
  page,
  request,
// Este test encadena 4 llamadas contra la D1 real y ademas navega el flujo completo
// de carta y carrito. Con el presupuesto por defecto de Playwright (30 s para el test
// entero) se caia de forma intermitente con "apiRequestContext: Request context
// disposed": no era el producto, era que el reloj del test se agotaba. Solo se amplia
// el tiempo; las aserciones quedan intactas.
}) => {
  test.slow();
  const nonce = Date.now();
  const cookie = await staffCookie(request);

  // Seed via API (staff writes need session since SEC-01)
  const table = await (
    await request.post('/api/tables', {
      ...authHeaders(cookie),
      data: { number: 90, capacity: 2 },
    })
  ).json();
  const category = await (
    await request.post('/api/categories', {
      ...authHeaders(cookie),
      data: { name: `Journey ${nonce}` },
    })
  ).json();
  const itemName = `Journey Plato ${nonce}`;
  const item = await (
    await request.post('/api/menu-items', {
      ...authHeaders(cookie),
      data: { name: itemName, price: 9.5, categoryId: category.id },
    })
  ).json();

  // Customer opens the table QR page (public, no session)
  // networkidle: el boton llega pintado por SSR antes de hidratar; un clic antes de eso no hace nada (flaky).
  await page.goto(`/table/${table.qrCode}`, { waitUntil: "networkidle" });
  await expect(page.locator('body')).toContainText('Mesa 90');

  // Add the dish to the cart (real aria-label from PublicMenu.svelte)
  await page.getByRole('button', { name: `Añadir ${itemName}` }).click();
  await expect(page.locator('aside[aria-label="Carrito"]')).toContainText(itemName);

  // Send to kitchen (real label from CartSidebar.svelte)
  await page.getByRole('button', { name: 'Enviar a cocina' }).click();

  // Functional proof via API: a pending order exists for this table with the item
  await expect(async () => {
    const res = await request.get('/api/orders?status=pending');
    expect(res.status()).toBe(200);
    const orders = await res.json();
    const mine = orders.find(
      (o: { tableId: string; items: { menuItemId: string }[] }) =>
        o.tableId === table.id && o.items.some((i) => i.menuItemId === item.id),
    );
    expect(mine).toBeDefined();
  }).toPass({ timeout: 15000 });
});
