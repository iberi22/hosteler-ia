import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// Este test encadena 6 llamadas contra la D1 real. Con el presupuesto por
// defecto de Playwright (30 s para el test entero) se caia de forma intermitente
// con "apiRequestContext: Request context disposed": no era el producto, era que el
// reloj del test se agotaba. Solo se amplia el tiempo; las aserciones quedan intactas.
  test.slow();
test('full order flow: table + category + item + order + transition', async ({ request }) => {
  const cookie = await staffCookie(request);
  const table = await (
    await request.post('/api/tables', { ...authHeaders(cookie), data: { number: 7, capacity: 2 } })
  ).json();

  const category = await (
    await request.post('/api/categories', { ...authHeaders(cookie), data: { name: 'E2E' } })
  ).json();

  const item = await (
    await request.post('/api/menu-items', {
      ...authHeaders(cookie),
      data: { name: 'E2E Plato', price: 10, categoryId: category.id },
    })
  ).json();

  const orderRes = await request.post('/api/orders', {
    ...authHeaders(cookie),
    data: { tableId: table.id, items: [{ menuItemId: item.id, qty: 2 }] },
  });
  expect(orderRes.status()).toBe(201);
  const order = await orderRes.json();
  expect(order.status).toBe('pending');

  const transition = await request.post(`/api/orders/${order.id}/transition`, {
    ...authHeaders(cookie),
    data: { to: 'preparing' },
  });
  expect(transition.status()).toBe(200);
  expect((await transition.json()).status).toBe('preparing');

  const confirm = await request.get(`/order-confirmation/${order.id}`);
  expect(confirm.status()).toBe(200);
});
