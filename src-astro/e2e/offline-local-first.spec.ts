// Prueba local-first del arbol publico: la app sin el modulo cloud (src/cloud/local) y SIN red hacia
// ningun host externo. Todo lo que no sea el propio origen (localhost) se aborta y se cuenta: el flujo
// tiene que terminar con cero intentos.
//
//   /local/ onboarding -> carta con dos platos (IndexedDB) -> edicion sin conexion (service worker) ->
//   publicar en el Worker local (D1 + R2 de miniflare) -> pantalla de pedido del comensal (/<slug>/menu)
//   -> pedido armado con total -> cobro manual en efectivo de un pedido servido (sin pasarela ni nube).
//
// Con private/cloud ausente (o FIZE_CLOUD=0) ademas comprueba la frontera: las rutas cloud (consumo y
// facturas SaaS; el registro manual de cobros es publico) responden 404
// "cloud disabled" y ajustes no muestra plan ni consumo.
import { test, expect, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildInsertCommand, generateActivationCode, hashActivationCode } from '../scripts/activation-code.mjs';
import { authHeaders, staffCookie } from './staff-auth';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const cloudPresent =
  process.env.FIZE_CLOUD !== '0' &&
  existsSync(fileURLToPath(new URL('../../private/cloud/src-astro/src/cloud/server.ts', import.meta.url)));

const suffix = Math.random().toString(36).slice(2, 7);
const NAME = `Fonda Offline ${suffix}`;
const SLUG = `fonda-offline-${suffix}`;
const DISHES = [
  { name: 'Sancocho', price: 18000 },
  { name: 'Agua de panela', price: 4000 },
] as const;
const code = generateActivationCode();

function d1Local(args: string[]) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc', ...args], {
    cwd: appDir,
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

/** Aborta todo lo que no vaya al propio origen y devuelve la lista de intentos. */
async function blockExternal(context: BrowserContext): Promise<string[]> {
  const attempts: string[] = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    attempts.push(url.href);
    return route.abort('internetdisconnected');
  });
  return attempts;
}

test.beforeAll(() => {
  const cmd = buildInsertCommand(hashActivationCode(code), SLUG, new Date().toISOString(), '--local');
  d1Local(['--command', cmd.slice(cmd.indexOf('--command "') + 11, -1)]);
});

test('local-first sin modulo cloud y sin red externa: onboarding -> platos -> pantalla de pedido', async ({ browser }) => {
  test.slow();
  const context = await browser.newContext();
  const external = await blockExternal(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Onboarding de /local/ (sin cuenta).
  await page.goto('/local/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill(NAME);
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue(SLUG);
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Calle 1 # 2-3, Pasto');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Platos (IndexedDB).
  await page.getByLabel('Nueva categoría').fill('Almuerzos');
  await page.getByRole('button', { name: 'Agregar categoría' }).click();
  for (const dish of DISHES) {
    await page.getByLabel('Plato').fill(dish.name);
    await page.getByLabel('Precio (COP)').fill(String(dish.price));
    await page.getByRole('button', { name: 'Agregar plato' }).click();
    await expect(page.getByLabel('Tu carta').getByText(dish.name)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Seguir' }).click();

  // Publicar contra el Worker LOCAL (mismo origen): nada sale a internet.
  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByText('Carta publicada:')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Seguir' }).click();
  await page.getByRole('button', { name: 'Ir a mi panel' }).click();
  await expect(page.getByRole('heading', { name: `Hola, ${NAME}` })).toBeVisible();

  // Sin conexion: la carta se abre del precache y conserva los platos.
  await page.goto('/local/carta/');
  await expect(page.getByText(DISHES[0].name)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  for (const dish of DISHES) await expect(page.getByText(dish.name).first()).toBeVisible();
  await context.setOffline(false);

  // Precio con punto de miles: "38.000" son 38.000 pesos, no 38 (QA pre-entrega 2026-10-13 #1,
  // dinero: `parseFloat` guardaba el plato 1000x mas barato y se publicaba asi en la carta).
  // El mismo dialogo lleva la trampa de foco (#14): el foco entra al dialogo y Tab cicla dentro.
  await page.getByRole('button', { name: '+ Nuevo artículo' }).click();
  const panel = page.locator('.dialog-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#sku')).toBeFocused();
  // Ultimo enfocable del dialogo -> Tab vuelve al primero (la ✕ de cerrar), sin salir a la lista de atras.
  await panel.getByRole('button', { name: 'Guardar' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cerrar' })).toBeFocused();
  await page.locator('#sku').fill(`SKU-${suffix}`);
  await page.locator('#item-name').fill('Bandeja paisa');
  await page.locator('#price').fill('38.000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('$ 38.000')).toBeVisible();
  await expect(page.getByText('$ 38', { exact: true })).toHaveCount(0);

  // Mesas en modo local (sin conexión): creamos la mesa 1.
  await context.setOffline(true);
  await page.goto('/local/mesas/');
  await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
  await page.getByPlaceholder('Nº de Mesa').fill('1');
  await page.getByPlaceholder('Capacidad (pax)').fill('4');
  // #9: los dos campos de alta de mesa tienen etiqueta accesible (ya no solo placeholder).
  await expect(page.getByLabel('Nº de Mesa')).toBeVisible();
  await expect(page.getByLabel('Capacidad (pax)')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir Mesa' }).click();
  await expect(page.getByText('Mesa 1')).toBeVisible();
  // #2: en modo local la accion de QR no lleva al panel de la nube (terminaba en /login).
  await expect(page.getByRole('link', { name: 'Ver QR para imprimir' })).toHaveAttribute('href', '/local/publicar/');
  await expect(page.locator('a[href^="/dashboard"]')).toHaveCount(0);

  // Nuevo pedido por la UI en modo local (sin conexión): el flujo real del restaurante.
  // La mesa 1 se pre-selecciona desde su tarjeta (accion por mesa de /local/mesas/).
  // Todo va por la API local (IndexedDB), sin red.
  // (El `fetch` directo al servidor D1 no alimenta al KDS local: lee otro almacen.)
  // (La siembra demo EXPLICITA `?demo=1` de kdsAutoSeed.ts ya no hace falta en este flujo: el pedido
  // lo crea el personal por la UI, asi que la base del restaurante no recibe pedidos demo.)
  await page.getByRole('link', { name: 'Nuevo pedido' }).first().click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido' })).toBeVisible();
  await expect(page.getByLabel('Mesa', { exact: true })).toHaveValue(/^.+$/, { timeout: 15_000 });
  await expect(page.getByLabel('Mesa', { exact: true })).toContainText('Mesa 1');
  for (const dish of DISHES) {
    await page.getByRole('button', { name: `Añadir ${dish.name}` }).click();
  }
  // Total en marcha en COP (18000 + 4000).
  await expect(page.getByTestId('take-order-total')).toContainText('22.000');
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await expect(page.getByText('Pedido creado')).toBeVisible();

  // Pedidos y cocina en modo local (sin conexión): el pedido creado por la UI sale en pending
  // via poll/store de la cola (sin recarga manual) y avanza por la maquina de estados.
  await page.goto('/local/pedidos/');
  await expect(page.locator('.counter.pending')).toHaveText('1 ⏳ pendientes', { timeout: 15_000 });
  await page.goto('/local/cocina/');
  await expect(page.locator('.counter.pending')).toHaveText('1 ⏳ pendientes', { timeout: 15_000 });
  // #3: la tarjeta del KDS muestra el numero de mesa, no el id interno del pedido.
  const kdsCard = page.locator('.kds-card').first();
  await expect(kdsCard.getByText('Mesa 1', { exact: true })).toBeVisible();
  await expect(kdsCard.getByText(/Mesa [0-9a-f]{8}-/)).toHaveCount(0);

  // Transición del pedido en KDS
  await page.getByRole('button', { name: '→ preparing' }).first().click();
  await expect(page.locator('.counter.preparing')).not.toHaveText('0 🔥 en cocina', { timeout: 10_000 });
  await page.getByRole('button', { name: '→ ready' }).first().click();
  await expect(page.locator('.counter.ready')).not.toHaveText('0 ✅ listos', { timeout: 10_000 });
  await page.getByRole('button', { name: '→ served' }).first().click();
  await expect(page.locator('.counter.served')).not.toHaveText('0 🍽️ por cobrar', { timeout: 15_000 });

  // Localizamos mediante el botón que nos abre el formulario de cobro.
  const paidBtn = page.getByRole('button', { name: '→ paid' }).first();
  await expect(paidBtn).toBeVisible({ timeout: 15_000 });

  // Cobrar: abre el modal y graba en IndexedDB
  await paidBtn.click();
  await expect(page.getByText('¿Cómo se cobró?')).toBeVisible();
  // El pago es en efectivo por el total del pedido (18000 + 4000 = 22000).
  await expect(page.getByLabel('Monto cobrado')).toHaveValue('22000');
  await page.getByRole('button', { name: 'Confirmar cobro' }).click();
  // Esperar a que el cobro quede grabado (la tarjeta sale del carril "por cobrar" solo tras el 201 +
  // persistir en IndexedDB): sin esta espera, el goto inmediato aborta la escritura asincrona en vuelo y
  // la recarga no encuentra el pedido cobrado. No relaja ninguna asercion, solo sincroniza con el guardado.
  await expect(page.locator('.counter.served')).toHaveText('0 🍽️ por cobrar', { timeout: 15_000 });

  // Recargamos la página offline y la mesa y los pedidos servidos siguen ahí (en la vista de pedidos)
  await page.goto('/local/pedidos/?status=paid');
  await page.reload();
  await expect(page.getByText('PAID')).toBeVisible();
  await page.goto('/local/mesas/');
  await expect(page.getByText('Mesa 1')).toBeVisible();
  await context.setOffline(false);

  // Ajustes en modo local: nada de plan, creditos ni consumo.
  await page.goto('/local/ajustes/');
  await expect(page.locator('#rest-name')).toHaveValue(NAME);
  await expect(page.getByText('Plan y Suscripción')).toHaveCount(0);

  // Pantalla de pedido del comensal: otro contexto, tambien sin red externa.
  const dinerContext = await browser.newContext();
  const dinerExternal = await blockExternal(dinerContext);
  const diner = await dinerContext.newPage();
  await diner.goto(`/${SLUG}/menu`, { waitUntil: 'networkidle' });
  await expect(diner.getByRole('heading', { name: NAME })).toBeVisible();
  for (const dish of DISHES) await diner.getByRole('button', { name: `Añadir ${dish.name}` }).click();
  const wa = diner.getByRole('link', { name: 'Pedir por WhatsApp' });
  await expect(wa).toBeVisible();
  const href = decodeURIComponent((await wa.getAttribute('href')) ?? '');
  for (const dish of DISHES) expect(href).toContain(dish.name);
  expect(href).toContain('*Total: 22.000*');

  // Registro manual de cobros (app publica, sin modulo cloud): pedido servido -> pago en efectivo -> paid.
  {
    const auth = authHeaders(await staffCookie(page.request));
    const table = await (await page.request.post('/api/tables', { ...auth, data: { number: 90 + Math.floor(Math.random() * 9), capacity: 2 } })).json();
    const category = await (await page.request.post('/api/categories', { ...auth, data: { name: `Cobro ${suffix}` } })).json();
    const item = await (
      await page.request.post('/api/menu-items', { ...auth, data: { name: `Plato cobro ${suffix}`, price: 12000, categoryId: category.id } })
    ).json();
    const orderRes = await page.request.post('/api/orders', { ...auth, data: { tableId: table.id, items: [{ menuItemId: item.id, qty: 2 }] } });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    for (const to of ['preparing', 'ready', 'served']) {
      const t = await page.request.post(`/api/orders/${order.id}/transition`, { ...auth, data: { to } });
      expect(t.status(), `transition ${to}`).toBe(200);
    }
    const pay = await page.request.post(`/api/orders/${order.id}/payment`, { ...auth, data: { method: 'efectivo', amount: 24000 } });
    expect(pay.status()).toBe(201);
    const paid = await pay.json();
    expect(paid.order.status).toBe('paid');
    expect(paid.payment).toMatchObject({ method: 'efectivo', amount: 24000, source: 'manual' });
  }

  // Frontera cloud: sin el modulo, las rutas cloud no existen (con sesion: el middleware ya no corta).
  // /api/ai/infer queda fuera: el middleware lo corta por tier antes de llegar a la ruta (src/cloud/cloud.test.ts).
  if (!cloudPresent) {
    const auth = authHeaders(await staffCookie(page.request));
    for (const [path, route] of [
      ['/api/saas/usage', 'saas.usage'],
      ['/api/saas/invoices', 'saas.invoices'],
    ] as const) {
      const res = await page.request.get(path, auth);
      expect(res.status(), `GET ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: 'cloud disabled', route });
    }
  }

  expect(external, `peticiones a hosts externos: ${external.join(', ')}`).toEqual([]);
  expect(dinerExternal, `peticiones a hosts externos (comensal): ${dinerExternal.join(', ')}`).toEqual([]);
  expect(errors).toEqual([]);
  await dinerContext.close();
  await context.close();
});
