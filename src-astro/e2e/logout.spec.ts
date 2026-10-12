import { test, expect } from '@playwright/test';
import { staffCookie } from './staff-auth';

// Cerrar sesion desde el panel: borra la cookie y /dashboard vuelve a pedir login.
test('Cerrar sesión lleva a /login y /dashboard exige entrar de nuevo', async ({ page, request, context, baseURL }) => {
  const cookie = await staffCookie(request);
  const [name, ...rest] = cookie.split('=');
  await context.addCookies([{ name, value: rest.join('='), url: baseURL as string }]);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  const logout = page.getByRole('button', { name: 'Cerrar sesión' });
  await expect(logout).toBeVisible();
  // Hidratacion Svelte: sin ella el click cae en HTML muerto.
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

  await logout.click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('el botón también está en la navegación móvil', async ({ page, request, context, baseURL }) => {
  const cookie = await staffCookie(request);
  const [name, ...rest] = cookie.split('=');
  await context.addCookies([{ name, value: rest.join('='), url: baseURL as string }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('las páginas del comensal no muestran el menú del personal ni cerrar sesión', async ({ page }) => {
  for (const path of ['/login', '/register', '/checkout']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Cocina' })).toHaveCount(0);
  }
});
