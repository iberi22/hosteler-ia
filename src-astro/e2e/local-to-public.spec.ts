// Integracion completa del nodo local SIN simular el servidor: la duena hace el onboarding en /local/,
// publica con un codigo de activacion real (sembrado en la D1 local de miniflare como lo haria el operador
// con --remote) y un comensal abre /<slug>/menu?mesa=2 en otro navegador y pide por WhatsApp.
// Los specs local-node y public-menu-publish prueban cada mitad; este prueba que encajan.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInsertCommand, generateActivationCode, hashActivationCode } from '../scripts/activation-code.mjs';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const nonce = Date.now().toString(36);
const name = `Fonda ${nonce}`;
const slug = `fonda-${nonce}`;
const code = generateActivationCode();

function d1Local(args: string[]) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc', ...args], {
    cwd: appDir,
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

test.beforeAll(() => {
  d1Local(['--file=./migrations/004_public_menu.sql']);
  const cmd = buildInsertCommand(hashActivationCode(code), slug, new Date().toISOString(), '--local');
  d1Local(['--command', cmd.slice(cmd.indexOf('--command "') + 11, -1)]);
});

test('duena en /local/ publica su carta y el comensal pide desde /<slug>/menu?mesa=2', async ({ page, browser }) => {
  test.slow();
  await page.goto('/local/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await page.getByLabel('Nombre del negocio').fill(name);
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue(slug);
  await page.getByLabel('WhatsApp para pedidos').fill('300 555 1234');
  await page.getByLabel('Dirección').fill('Calle 10 # 5-20, Pasto');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await page.getByLabel('Nueva categoría').fill('Almuerzos');
  await page.getByRole('button', { name: 'Agregar categoría' }).click();
  await page.getByLabel('Plato').fill('Cuy asado');
  await page.getByLabel('Precio (COP)').fill('45000');
  await page.getByRole('button', { name: 'Agregar plato' }).click();
  await expect(page.getByLabel('Tu carta').getByText('Cuy asado')).toBeVisible();
  await page.getByRole('button', { name: 'Seguir' }).click();

  // Publicacion REAL contra el endpoint del Worker (sin page.route).
  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByText('Carta publicada:')).toBeVisible({ timeout: 20_000 });

  // El comensal: otro contexto, sin nada del nodo local.
  const diner = await (await browser.newContext()).newPage();
  await diner.goto(`/${slug}/menu?mesa=2`, { waitUntil: 'networkidle' });
  await expect(diner.getByRole('heading', { name })).toBeVisible();
  await diner.getByRole('button', { name: 'Añadir Cuy asado' }).click();
  const href = decodeURIComponent((await diner.getByRole('link', { name: 'Pedir por WhatsApp' }).getAttribute('href')) ?? '');
  expect(href).toContain('wa.me/573005551234');
  expect(href).toMatch(/mesa 2/i);
  expect(href).toContain('Cuy asado');
  expect(href).toContain('45.000');

  // #4 (publicado): el QR de la mesa de /local/mesas usa el enlace publico con ?mesa=N,
  // el unico que el comensal puede abrir desde su celular.
  await page.goto('/local/mesas/');
  await page.getByPlaceholder('Nº de Mesa').fill('1');
  await page.getByPlaceholder('Capacidad (pax)').fill('4');
  await page.getByRole('button', { name: 'Añadir Mesa' }).click();
  await expect(page.getByText('Mesa 1')).toBeVisible();
  await page.locator('.table-card').first().click();
  const qrModal = page.getByRole('dialog', { name: 'Mesa 1 — QR' });
  await expect(qrModal).toBeVisible();
  await expect(qrModal.getByText(`https://fize.swal.network/${slug}/menu?mesa=1`)).toBeVisible();
});
