import { test, expect } from '@playwright/test';
import { CLIENT_MENU_PATH } from '../src/config/client';

test('landing: una h1, CTA de contacto, demo y entrar', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Fize — Orden en tu cocina, gratis');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText('Orden en tu cocina');

  const primary = page.getByRole('link', { name: 'Empezar gratis, sin registrarme' }).first();
  await expect(primary).toHaveAttribute('href', '/local/');
  await expect(page.getByRole('link', { name: 'hola@swal.network' }).first()).toHaveAttribute('href', /^mailto:hola@swal\.network/);
  await expect(primary).not.toHaveAttribute('href', /\/register/);

  const demo = page.getByRole('link', { name: 'Ver la carta demo' });
  await expect(demo).toHaveAttribute('href', CLIENT_MENU_PATH);

  await expect(page.getByRole('link', { name: 'Entrar' }).first()).toHaveAttribute('href', '/login');
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(/extremo a extremo/i);
});

test('landing: sin desbordamiento horizontal a 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
  const bodyOver = await page.evaluate(() => document.body.scrollWidth - window.innerWidth);
  expect(bodyOver).toBeLessThanOrEqual(0);
});

test('login page renders form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('form.auth-form')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
