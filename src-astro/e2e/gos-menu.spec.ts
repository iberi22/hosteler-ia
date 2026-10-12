import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';
import ingredients from '../src/lib/fixtures/gos/ingredients.json' with { type: 'json' };
import manifest from '../src/lib/fixtures/gos/manifest.json' with { type: 'json' };

// Browser integration checks UI interaction. Aggregation and derivation are
// covered with real GOS fixtures in vitest; only the optional projection is mocked here.
test('GOS nutrition card, allergen exclusion, cached totals and cart work together', async ({ page, request }) => {
  test.slow();
  const cookie = await staffCookie(request);
  const nonce = Date.now();
  const restaurantResponse = await request.post('/api/restaurants', {
    ...authHeaders(cookie), data: { name: `GOS ${nonce}`, slug: `gos-${nonce}`, address: 'Local', phone: '3001234567' },
  });
  expect(restaurantResponse.status()).toBe(201);
  const restaurant = await restaurantResponse.json();
  const category = await (await request.post('/api/categories', { ...authHeaders(cookie), data: { name: `GOS ${nonce}` } })).json();
  const item = await (await request.post('/api/menu-items', { ...authHeaders(cookie), data: { name: `Arroz GOS ${nonce}`, price: 12000, categoryId: category.id } })).json();
  const totals = { [item.id]: {
    nutrition: { calories: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 }, micronutrients: {},
    allergens: ['gos:allergen/milk'], partial: true, linked: 1, total: 2,
    dataset: `${manifest.version}+sha256:${manifest.contentHash}`,
  } };
  await page.route('**/api/menu-nutrition?*', route => route.fulfill({ json: totals }));
  await page.goto(`/${restaurant.slug}/menu`);
  await expect(page.getByLabel(`Nutrición por porción de ${item.name}`)).toContainText('365');
  await expect(page.getByText('parcial: 1 de 2 ingredientes vinculados')).toBeVisible();
  await expect(page.getByText('Datos nutricionales: GOS')).toBeVisible();
  await expect(page.getByText(`Dataset: ${totals[item.id].dataset}`)).toBeVisible();
  await page.getByRole('checkbox', { name: 'milk' }).check();
  await expect(page.getByRole('button', { name: `Añadir ${item.name}` })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'milk' }).uncheck();
  await page.getByRole('button', { name: `Añadir ${item.name}` }).click();
  await expect(page.getByRole('region', { name: 'Tu pedido' })).toBeVisible();
  await page.unroute('**/api/menu-nutrition?*');
  await page.route('**/api/menu-nutrition?*', route => route.abort());
  await page.reload();
  await expect(page.getByLabel(`Nutrición por porción de ${item.name}`)).toContainText('365');
  await page.getByRole('button', { name: `Añadir ${item.name}` }).click();
  await expect(page.getByRole('region', { name: 'Tu pedido' })).toBeVisible();
});

test('inventory picker resolves accented GOS searches and lets staff unlink', async ({ page, request, context, baseURL }) => {
  test.slow();
  const cookie = await staffCookie(request);
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: baseURL! }]);
  await page.route('https://gos.swal.network/api/v1/*', route => route.fulfill({
    json: route.request().url().endsWith('manifest.json') ? manifest : ingredients,
  }));
  await page.goto('/dashboard/inventory');
  await page.getByRole('searchbox', { name: 'Ingrediente GOS (opcional)' }).fill('ÁJÓ');
  await page.getByRole('button', { name: 'Ajo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Gramos por ud de inventario' })).toBeVisible();
  await page.getByRole('button', { name: 'Desvincular' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Gramos por ud de inventario' })).toHaveCount(0);
});
