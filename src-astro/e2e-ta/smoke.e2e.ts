import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('1. landing opens and shows the start-without-account call to action', async ({ app, screen }) => {
  await app.open('/');
  const primary = screen.getByRole('link', { name: 'Empezar gratis, sin registrarme' }).first();
  await expect(primary).toBeVisible();
});

test('2. local onboarding reaches Paso 4 de 6 and the local panel opens', async ({ app, screen, browser }) => {
  await app.open('/local/');
  await screen.getByRole('button', { name: 'Empezar' }).tap();
  await screen.getByRole('button', { name: 'Siguiente' }).tap();
  await screen.getByLabel('Nombre del negocio').fill('Restaurante Smoke');
  await screen.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await screen.getByLabel('Dirección').fill('Calle 123');
  await screen.getByRole('button', { name: 'Siguiente' }).tap();
  await expect(screen.getByTestId('paso')).toHaveText('Paso 4 de 6');

  await screen.getByLabel('Ya lo anoté en un lugar seguro').check();
  await screen.getByRole('button', { name: 'Siguiente' }).tap();
  await screen.getByRole('button', { name: 'Saltar por ahora' }).tap();
  await screen.getByRole('button', { name: 'Ir a mi panel' }).tap();
  await expect(browser).toHaveURL(/\/local\/?$/);
});

test('3. local inventory page /local/inventario renders its heading', async ({ app, screen }) => {
  await app.open('/local/inventario');
  await expect(screen.getByRole('heading', { name: 'Inventario' })).toBeVisible();
});

test('4. offline page /offline renders', async ({ app, screen }) => {
  await app.open('/offline');
  await expect(screen.getByRole('heading', { name: 'No hay conexión a internet' })).toBeVisible();
});

test('5. login page renders the form fields (no submission)', async ({ app, screen }) => {
  await app.open('/login');
  await expect(screen.getByLabel('Correo')).toBeVisible();
  await expect(screen.getByLabel('Contraseña')).toBeVisible();
});

test('6. PWA manifest is served and parseable', async ({ app, browser }) => {
  await app.open('/');
  const manifest = await browser.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { name?: string; display?: string };
    return { name: data.name ?? '', display: data.display ?? '' };
  });
  expect(typeof manifest).toBe('object');
  expect(manifest).not.toBeNull();
  expect(manifest.name).toContain('Fi');
  expect(manifest.display).toBe('standalone');
});
