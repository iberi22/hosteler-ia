import { test, expect } from '@playwright/test';

// Regresion 2026-10-02: con `navigateFallback` de Workbox, el SW servia /offline para TODA navegacion
// SSR en cuanto tomaba control. El comensal o el dueno que volvia veia "Sin conexion" con la red bien.
// Las paginas publicas (landing y login, sin datos sembrados) deben verse en la 2a visita, y sin red
// mostrar su copia guardada o la pagina offline, nunca el error del navegador.
test('con el service worker activo, volver a entrar muestra la pagina real', async ({ page, context }) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);

  await page.goto('/login', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveTitle(/Sin conexión/);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveTitle(/Sin conexión/);

  await context.setOffline(true);
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible(); // copia guardada
  await page.goto('/dashboard');
  await expect(page).toHaveTitle(/Sin conexión/); // panel sin red: pagina offline, sin HTML guardado
  await context.setOffline(false);
});
