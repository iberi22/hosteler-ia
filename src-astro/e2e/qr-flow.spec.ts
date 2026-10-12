import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// Este test encadena 4 llamadas contra la D1 real. Con el presupuesto por
// defecto de Playwright (30 s para el test entero) se caia de forma intermitente
// con "apiRequestContext: Request context disposed": no era el producto, era que el
// reloj del test se agotaba. Solo se amplia el tiempo; las aserciones quedan intactas.
  test.slow();
test('QR flow: create table, resolve by QR, 404 unknown', async ({ request }) => {
  const cookie = await staffCookie(request);
  const created = await request.post('/api/tables', {
    ...authHeaders(cookie),
    data: { number: 42, capacity: 4 },
  });
  expect(created.status()).toBe(201);
  const table = await created.json();
  expect(table.qrCode).toBeDefined();

  const resolved = await request.get(`/api/qr/${table.qrCode}`);
  expect(resolved.status()).toBe(200);
  const payload = await resolved.json();
  expect(payload.table.number).toBe(42);
  expect(payload.table.qrCode).toBeUndefined();

  const missing = await request.get('/api/qr/does-not-exist');
  expect(missing.status()).toBe(404);
});

test.describe('browser rendering', () => {

  test('QR table page renders', async ({ page, request }) => {
    const cookie = await staffCookie(request);
    const created = await request.post('/api/tables', {
      ...authHeaders(cookie),
      data: { number: 43, capacity: 2 },
    });
    const table = await created.json();
    await page.goto(`/table/${table.qrCode}`);
    await expect(page.locator('body')).toContainText(/Mesa 43/);
  });
});
