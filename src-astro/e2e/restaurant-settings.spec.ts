import { test, expect } from '@playwright/test';
import { staffCookie, authHeaders } from './staff-auth';

// El formulario de /dashboard/settings edita el primer restaurante activo de la
// instancia. El test se asegura de que exista uno y comprueba contra la API
// lo que realmente quedo guardado.
test('settings: el WhatsApp se valida, se normaliza y se guarda', async ({ page, request, context, baseURL }) => {
  test.slow();
  const cookie = await staffCookie(request);
  const list = await (await request.get('/api/restaurants')).json();
  if (!Array.isArray(list) || list.length === 0) {
    const nonce = Date.now().toString(36);
    const created = await request.post('/api/restaurants', {
      ...authHeaders(cookie),
      data: { name: `Settings ${nonce}`, slug: `settings-${nonce}`, address: 'Local' },
    });
    expect(created.status()).toBe(201);
  }

  await context.addCookies([
    { name: 'fize_session', value: cookie.split('=')[1]!, url: baseURL ?? 'http://localhost:4331' },
  ]);
  await page.goto('/dashboard/settings');

  const field = page.getByLabel('WhatsApp para pedidos');
  await expect(field).toBeVisible();
  await expect(page.getByText(/Sin él, el botón "Pedir por WhatsApp" no aparece/)).toBeVisible();

  // Invalido: error claro, no se envia.
  await field.fill('12345');
  await page.getByRole('button', { name: 'Guardar Cambios' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'El WhatsApp' })).toContainText('El WhatsApp debe tener 10 dígitos');

  // Valido con formato libre: se guarda normalizado.
  // Numero distinto en cada corrida: el estado local persiste y sin cambios no hay PATCH.
  const tail = String(Date.now() % 10_000_000).padStart(7, '0');
  await field.fill(`+57 300 ${tail.slice(0, 3)} ${tail.slice(3)}`);
  await page.getByRole('button', { name: 'Guardar Cambios' }).click();
  await expect(page.getByRole('status')).toContainText('actualizado');

  const after = (await (await request.get('/api/restaurants')).json()) as Array<{ phone?: string }>;
  expect(after.some((r) => r.phone === `57300${tail}`)).toBe(true);

  // Recargar: el campo carga el valor guardado del restaurante que muestra el formulario.
  const first = ((await (await request.get('/api/restaurants')).json()) as Array<{ phone?: string }>)[0];
  await page.reload();
  await expect(page.getByLabel('WhatsApp para pedidos')).toHaveValue(first?.phone ?? '');
});

test('API de restaurantes: slug reservado 400, duplicado 409', async ({ request }) => {
  const cookie = await staffCookie(request);
  const nonce = Date.now().toString(36);
  const body = (slug: string) => ({ ...authHeaders(cookie), data: { name: 'Slug test', slug, address: 'Local' } });

  const reserved = await request.post('/api/restaurants', body('dashboard'));
  expect(reserved.status()).toBe(400);
  expect((await reserved.json()).error).toContain('reservada');

  const first = await request.post('/api/restaurants', body(`slug-${nonce}`));
  expect(first.status()).toBe(201);
  const dup = await request.post('/api/restaurants', body(`slug-${nonce}`));
  expect(dup.status()).toBe(409);
  expect((await dup.json()).error).toContain('ya está en uso');
});
