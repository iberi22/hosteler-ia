import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

test('hoja imprimible de QR: una tarjeta por mesa, sin menu de la app al imprimir', async ({ page, request, context, baseURL }) => {
  test.slow();
  const cookie = await staffCookie(request);
  // Numeros nuevos de verdad: el estado local acumula mesas de corridas anteriores y un 409 (ya existe)
  // dejaba la prueba dependiendo de mesas viejas. Se reintenta hasta crear dos mesas propias.
  const numbers: number[] = [];
  for (let attempt = 0; numbers.length < 2 && attempt < 20; attempt++) {
    const number = 10_000 + Math.floor(Math.random() * 89_000);
    const res = await request.post('/api/tables', { ...authHeaders(cookie), data: { number, capacity: 2 } });
    if (res.status() === 201) numbers.push(number);
    else expect(res.status()).toBe(409);
  }
  expect(numbers).toHaveLength(2);
  await context.addCookies([
    { name: 'fize_session', value: cookie.split('=')[1]!, url: baseURL ?? 'http://localhost:4331' },
  ]);

  // La pagina de mesas ofrece la accion.
  await page.goto('/dashboard/tables');
  await expect(page.getByRole('link', { name: 'Imprimir QR' })).toHaveAttribute('href', '/dashboard/tables/print');

  await page.goto('/dashboard/tables/print');
  const cards = page.getByTestId('qr-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  for (const number of numbers) {
    // Texto exacto: `hasText` tambien encontraria "Mesa 12345" dentro de "Mesa 123456".
    const card = cards.filter({ has: page.getByText(`Mesa ${number}`, { exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Escanea para ver la carta y pedir');
    await expect(card.getByRole('img', { name: `QR mesa ${number}` }).locator('svg')).toBeVisible();
  }

  // En impresion desaparecen los controles y el fondo del tema.
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Volver a mesas' })).toBeHidden();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
});
