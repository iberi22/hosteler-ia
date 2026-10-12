// Entrega a la clienta (runbook de despliegue: repo privado de infraestructura), de punta a punta y con SUS datos (src/config/client.ts):
// en /local/ (sin cuenta, IndexedDB) arma su carta con dos platos, la publica con un codigo de activacion
// (D1 + R2 locales de miniflare, los mismos que usa el Worker en `astro preview`; nada de page.route), y un
// comensal en otro navegador abre /<slug>/menu, pide los dos platos y el enlace de WhatsApp lleva el numero
// configurado, los platos y el total.
//
// Usa el slug fijo de la config, asi que antes de empezar suelta la llave que una corrida anterior dejo en la
// D1 LOCAL (`DELETE FROM public_menu WHERE slug=...`); sin eso la segunda corrida chocaria con "slug tomado".
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInsertCommand, generateActivationCode, hashActivationCode, validSlug } from '../scripts/activation-code.mjs';
import { CLIENT, CLIENT_WA_NUMBER } from '../src/config/client';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const code = generateActivationCode();

const DISHES = [
  { name: 'Bandeja paisa', price: 32000, shown: '32.000' },
  { name: 'Limonada de coco', price: 9500, shown: '9.500' },
] as const;
const TOTAL = '41.500';

function d1Local(args: string[]) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc', ...args], {
    cwd: appDir,
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

test.beforeAll(() => {
  expect(validSlug(CLIENT.slug)).toBe(true);
  d1Local(['--file=./migrations/004_public_menu.sql']);
  d1Local(['--command', `DELETE FROM public_menu WHERE slug='${CLIENT.slug}';`]);
  const cmd = buildInsertCommand(hashActivationCode(code), CLIENT.slug, new Date().toISOString(), '--local');
  d1Local(['--command', cmd.slice(cmd.indexOf('--command "') + 11, -1)]);
});

test('clienta: /local/ -> 2 platos -> publica con codigo -> comensal pide por WhatsApp al numero configurado', async ({ page, browser }) => {
  test.slow();
  await page.goto('/local/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await page.getByLabel('Nombre del negocio').fill(CLIENT.restaurantName);
  // El slug sugerido desde el nombre tiene que ser el configurado: si no, el codigo (amarrado al slug) no sirve.
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue(CLIENT.slug);
  await page.getByLabel('WhatsApp para pedidos').fill(CLIENT.whatsapp);
  await page.getByLabel('Dirección').fill('Calle 10 # 5-20, Pasto');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await page.getByLabel('Nueva categoría').fill('Almuerzos');
  await page.getByRole('button', { name: 'Agregar categoría' }).click();
  for (const dish of DISHES) {
    await page.getByLabel('Plato').fill(dish.name);
    await page.getByLabel('Precio (COP)').fill(String(dish.price));
    await page.getByRole('button', { name: 'Agregar plato' }).click();
    await expect(page.getByLabel('Tu carta').getByText(dish.name)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Seguir' }).click();

  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByText('Carta publicada:')).toBeVisible({ timeout: 20_000 });

  // El comensal: otro contexto, sin nada del nodo local.
  const diner = await (await browser.newContext()).newPage();
  await diner.goto(`/${CLIENT.slug}/menu`, { waitUntil: 'networkidle' });
  await expect(diner.getByRole('heading', { name: CLIENT.restaurantName })).toBeVisible();
  for (const dish of DISHES) {
    await diner.getByRole('button', { name: `Añadir ${dish.name}` }).click();
  }
  const wa = diner.getByRole('link', { name: 'Pedir por WhatsApp' });
  await expect(wa).toBeVisible();
  const href = decodeURIComponent((await wa.getAttribute('href')) ?? '');
  expect(href.startsWith(`https://wa.me/${CLIENT_WA_NUMBER}?text=`)).toBe(true);
  expect(href).toContain(`Hola ${CLIENT.restaurantName}`);
  for (const dish of DISHES) {
    expect(href).toContain(`1 × ${dish.name} — ${dish.shown}`);
  }
  expect(href).toContain(`*Total: ${TOTAL}*`);
});
