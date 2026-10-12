import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

test('carta publica: el boton Añadir usa el estilo del core, 44px y anillo de foco', async ({ page, request }) => {
  test.slow();
  const cookie = await staffCookie(request);
  const nonce = Date.now().toString(36);
  const rest = await request.post('/api/restaurants', {
    ...authHeaders(cookie), data: { name: `Boton ${nonce}`, slug: `boton-${nonce}`, address: 'Local' },
  });
  expect(rest.status()).toBe(201);
  const restaurant = await rest.json();
  const category = await (await request.post('/api/categories', { ...authHeaders(cookie), data: { name: `Cat ${nonce}` } })).json();
  const item = await (await request.post('/api/menu-items', {
    ...authHeaders(cookie), data: { name: `Plato ${nonce}`, price: 9000, categoryId: category.id },
  })).json();

  await page.goto(`/${restaurant.slug}/menu`);
  const add = page.getByRole('button', { name: `Añadir ${item.name}` });
  await expect(add).toBeVisible();
  await expect(add).toHaveClass(/swal-btn/);

  const box = await add.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Boton relleno con el acento del tema, no el gris nativo.
  const bg = await add.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(239, 239, 239)');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');

  // Foco por teclado: anillo visible.
  await page.keyboard.press('Tab');
  await add.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await add.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
});
