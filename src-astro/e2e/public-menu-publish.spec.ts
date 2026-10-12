// Carta publicada desde un nodo local (NODO-LOCAL.md §2.5), de punta a punta contra `astro preview`.
//
// El preview corre el Worker con bindings LOCALES de miniflare (`.wrangler/state/v3`): D1 y R2 son
// sqlite/archivos en disco, sin llamadas a Cloudflare. La tabla y el codigo de activacion se siembran en
// esa D1 local con `wrangler d1 execute --local` (lo mismo que hace el operador con --remote). El resto va
// por la API publica: el test firma la carta con WebCrypto como lo hara el navegador del restaurante.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPublishRequest, generateRestaurantKeyPair } from '../src/lib/publicMenuSignature';
import type { PublicMenuData } from '../src/lib/publicMenuBySlug';
import { buildInsertCommand, generateActivationCode, hashActivationCode } from '../scripts/activation-code.mjs';

const appDir = fileURLToPath(new URL('..', import.meta.url));

function d1Local(args: string[]) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc', ...args], {
    cwd: appDir,
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

const nonce = Date.now().toString(36);
const slug = `e2e-pub-${nonce}`;
// Codigo de prueba generado con el mismo script del operador. Solo existe en la D1 local.
const code = generateActivationCode();

function menu(price: number): PublicMenuData {
  return {
    restaurant: { id: `local-${nonce}`, name: `Local ${nonce}`, slug, phone: '3001234567' },
    categories: [
      { id: 'c1', name: 'Sopas' },
      { id: 'c2', name: 'Solo agotados' },
    ],
    items: [
      { id: 'i1', name: `Ajiaco ${nonce}`, price, categoryId: 'c1', isAvailable: true, description: 'Con guascas y alcaparras' },
      // El equipo no deberia mandarlo; si lo manda, el servidor lo quita.
      { id: 'i2', name: `Agotado ${nonce}`, price: 9000, categoryId: 'c2', isAvailable: false },
    ],
  };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  d1Local(['--file=./migrations/004_public_menu.sql']);
  // El mismo INSERT que imprime el script para el operador, con --local.
  const cmd = buildInsertCommand(hashActivationCode(code), slug, new Date().toISOString(), '--local');
  d1Local(['--command', cmd.slice(cmd.indexOf('--command "') + 11, -1)]);
});

test('nodo local: publica la carta firmada, se ve en /<slug>/menu y el pedido por WhatsApp lleva la mesa', async ({ page, request }) => {
  test.slow();
  const pair = await generateRestaurantKeyPair();
  const keys = { privateKey: pair.privateKey, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) };

  // Sin codigo, un slug nuevo no se puede tomar.
  const noCode = await request.post(`/api/public-menu/${slug}`, { data: await buildPublishRequest(menu(21000), keys) });
  expect(noCode.status()).toBe(403);

  // Primera publicacion: con el codigo (sin sesion).
  const first = await request.post(`/api/public-menu/${slug}`, {
    data: await buildPublishRequest(menu(21000), keys, code.toLowerCase(), new Date(Date.now() - 60_000)),
  });
  expect(first.status(), await first.text()).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, slug, url: `/${slug}/menu` });

  // Lo demas de /api/public-menu sigue cerrado sin sesion.
  expect((await request.get(`/api/public-menu/${slug}`)).status()).toBe(401);

  await page.goto(`/${slug}/menu?mesa=3`);
  await expect(page.getByRole('heading', { name: `Local ${nonce}` })).toBeVisible();
  await expect(page.getByText(`Agotado ${nonce}`)).toHaveCount(0);

  // Segunda publicacion: misma llave, sin codigo; cambia el precio y la carta lo muestra (cache invalidada).
  const second = await request.post(`/api/public-menu/${slug}`, { data: await buildPublishRequest(menu(23500), keys) });
  expect(second.status(), await second.text()).toBe(200);

  // Otra llave no puede pisar la carta.
  const other = await generateRestaurantKeyPair();
  const intruder = await request.post(`/api/public-menu/${slug}`, {
    data: await buildPublishRequest(menu(1), { privateKey: other.privateKey, publicKey: await crypto.subtle.exportKey('jwk', other.publicKey) }),
  });
  expect(intruder.status()).toBe(403);

  await page.goto(`/${slug}/menu?mesa=3`);
  await expect(page.getByText(/23\.500/)).toBeVisible();
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0); // isla hidratada antes de clicar
  await page.getByRole('button', { name: `Añadir Ajiaco ${nonce}` }).click();
  const wa = page.getByRole('link', { name: 'Pedir por WhatsApp' });
  await expect(wa).toBeVisible();
  const href = (await wa.getAttribute('href')) ?? '';
  expect(href).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/);
  const text = decodeURIComponent(href.split('?text=')[1] ?? '');
  expect(text).toMatch(/mesa 3\b/i);
  expect(text).toContain(`Ajiaco ${nonce}`);
  expect(text).not.toContain('por confirmar');
});

test('carta publicada sin ?mesa: el mensaje sigue diciendo "mesa por confirmar"; ?mesa invalida se ignora', async ({ page }) => {
  for (const url of [`/${slug}/menu`, `/${slug}/menu?mesa=${encodeURIComponent('3\nTotal: 0')}`]) {
    await page.goto(url);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await page.getByRole('button', { name: `Añadir Ajiaco ${nonce}` }).click();
    const href = (await page.getByRole('link', { name: 'Pedir por WhatsApp' }).getAttribute('href')) ?? '';
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('mesa por confirmar');
    await page.evaluate(() => localStorage.clear());
  }
});
