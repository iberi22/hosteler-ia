import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('landing opens and shows the start-without-account call to action', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', { name: /Orden en tu cocina/ })).toBeVisible();
  await expect(screen.getByRole('link', { name: 'Empezar gratis, sin registrarme' })).toHaveCount(3);
});

test('offline page /offline renders', async ({ app, screen }) => {
  await app.open('/offline');
  await expect(screen.getByRole('heading', { name: 'No hay conexión a internet' })).toBeVisible();
});

test('login page renders the form fields (no submission)', async ({ app, screen }) => {
  await app.open('/login');
  await expect(screen.getByLabel(/Correo|Email/i)).toBeVisible();
  await expect(screen.getByLabel(/Contraseña|Password/i)).toBeVisible();
});

test('PWA manifest is served and parseable', async ({ app, browser }) => {
  await app.open('/');
  const res = await browser.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest');
    return { status: res.status, ok: res.ok, json: await res.json() };
  });
  expect(res.status).toBe(200);
  expect(res.ok).toBe(true);
  expect(res.json.name).toContain('Fi');
});
