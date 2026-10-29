import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// Nodo local sin registro (docs/producto/NODO-LOCAL.md §4–5, tramo 1): onboarding completo, carta en
// IndexedDB, edicion sin red desde el precache, copia cifrada, borrar el equipo y restaurar con el codigo.
// Ninguna pantalla de /local/* puede llamar a la API del servidor ni dejar errores en consola.

function watch(page: Page) {
  const errors: string[] = [];
  const apiCalls: string[] = [];
  page.on('console', (m) => {
    // El 404 simulado de la publicacion (endpoint aun no desplegado) lo registra el navegador; es esperado.
    if (m.type() === 'error' && !m.location().url.includes('/api/public-menu/')) errors.push(`${page.url()} :: ${m.text()} @ ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/public-menu/')) apiCalls.push(`${r.method()} ${u.pathname}`);
  });
  return { errors, apiCalls };
}

test('nodo local: onboarding, carta sin red, copia cifrada y restauración', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const { errors, apiCalls } = watch(page);
  // El endpoint de publicacion es del frente 2: aqui se simula "aun no desplegado" y luego "publicada".
  let publishStatus = 404;
  await page.route('**/api/public-menu/**', (route) =>
    route.fulfill({ status: publishStatus, contentType: 'application/json', body: publishStatus === 201 ? '{"ok":true}' : '{"error":"Not found"}' }),
  );

  // Paso 1
  await page.goto('/local/');
  await expect(page.getByTestId('paso')).toHaveText('Paso 1 de 6');
  await expect(page.getByRole('heading', { name: 'Fize ordena tu carta y tu local' })).toBeVisible();
  await expect(page.getByRole('link', { name: /login|entrar/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Empezar' }).click();

  // Paso 2: resultado de persist()
  await expect(page.getByRole('heading', { name: 'Tus datos viven en este equipo' })).toBeVisible();
  await expect(page.getByTestId('persist')).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Paso 3: validaciones y slug sugerido
  await expect(page.getByRole('heading', { name: 'Tu local' })).toBeVisible();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue('dona-rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('123');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText(/El WhatsApp debe tener 10 dígitos/)).toBeVisible();
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Paso 4: codigo; recargar conserva el avance y el mismo codigo
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
  await expect(page.getByTestId('recovery-code')).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
  await page.reload();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
  await expect(page.getByTestId('recovery-code')).toHaveText(code);
  const next4 = page.getByRole('button', { name: 'Siguiente' });
  await expect(next4).toBeDisabled();
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await next4.click();

  // Paso 5: primera carta
  await expect(page.getByRole('heading', { name: 'Tu primera carta' })).toBeVisible();
  await page.getByLabel('Nueva categoría').fill('Almuerzos');
  await page.getByRole('button', { name: 'Agregar categoría' }).click();
  await page.getByLabel('Plato').fill('Ejecutivo del día');
  await page.getByLabel('Precio (COP)').fill('16000');
  await page.getByRole('button', { name: 'Agregar plato' }).click();
  await expect(page.getByLabel('Tu carta').getByText('Ejecutivo del día')).toBeVisible();
  await page.getByRole('button', { name: 'Seguir' }).click();

  // Paso 5 (publicar): endpoint aun no desplegado -> aviso amable
  await expect(page.getByRole('heading', { name: 'Publica tu carta' }).first()).toBeVisible();
  await expect(page.getByText('fize.swal.network/dona-rosa/menu').first()).toBeVisible();
  await page.getByLabel('Código de activación').fill('PRUEBA-1234');
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByTestId('publish-error')).toContainText('todavía no está disponible');
  publishStatus = 201;
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByText('Carta publicada:')).toBeVisible();
  await page.getByRole('button', { name: 'Seguir' }).click();

  // Paso 6
  await expect(page.getByRole('heading', { name: 'Después, si quieres' })).toBeVisible();
  await expect(page.getByText('Próximamente')).toHaveCount(3);
  await page.getByRole('button', { name: 'Ir a mi panel' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Doña Rosa' })).toBeVisible();

  // Publicar: QR y enlaces por mesa
  await page.goto('/local/publicar/');
  await expect(page.getByTestId('carta-link')).toHaveText('https://fize.swal.network/dona-rosa/menu');
  await page.getByLabel('¿Cuántas mesas tienes?').fill('3');
  await page.getByLabel('¿Cuántas mesas tienes?').blur();
  await expect(page.getByText('fize.swal.network/dona-rosa/menu?mesa=3')).toBeVisible();

  // Mi local: el formulario lee y guarda en este equipo
  await page.goto('/local/ajustes/');
  await expect(page.locator('#rest-name')).toHaveValue('Doña Rosa');
  await expect(page.getByText('Plan y Suscripción')).toHaveCount(0);
  await expect(page.getByTestId('instance-id')).toHaveText(/^local-[0-9a-z]{10}$/);

  // Carta: el service worker ya controla la pagina; sin red se abre del precache y se puede editar
  await page.goto('/local/carta/');
  await expect(page.getByText('Ejecutivo del día')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Ejecutivo del día')).toBeVisible();
  await expect(page.locator('#net-banner')).toBeVisible();
  page.once('dialog', (d) => d.accept('Bebidas'));
  await page.getByRole('button', { name: '+ Nueva categoría' }).click();
  await expect(page.getByRole('cell', { name: 'Bebidas' }).or(page.getByText('Bebidas')).first()).toBeVisible();
  // Sin barra final tambien abre sin red (el SW redirige a /local/carta/, que esta en el precache).
  await page.goto('/local/carta');
  await expect(page).toHaveURL(/\/local\/carta\/$/);
  await expect(page.getByText('Bebidas').first()).toBeVisible();
  await page.goto('/local/');
  await expect(page.getByRole('heading', { name: 'Hola, Doña Rosa' })).toBeVisible();
  await context.setOffline(false);

  // Copia cifrada
  await page.goto('/local/respaldo/');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar copia cifrada/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^fize-dona-rosa-\d{4}-\d{2}-\d{2}\.fize$/);
  const backupPath = testInfo.outputPath('copia.fize');
  await download.saveAs(backupPath);
  const envelope = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(envelope.format).toBe('fize-backup-enc/v1');
  expect(readFileSync(backupPath, 'utf8')).not.toContain('Ejecutivo');

  // Borrar el almacenamiento del sitio (IndexedDB y localStorage). El service worker y su cache quedan.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(page.url()).origin, storageTypes: 'indexeddb,local_storage' });
  await page.goto('/local/');
  await expect(page.getByTestId('paso')).toHaveText('Paso 1 de 6');
  await page.getByRole('link', { name: 'Ya tengo una copia de Fize' }).click();
  await expect(page).toHaveURL(/\/local\/respaldo\/$/);

  // Archivo alterado: error claro, nada cambia
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, 10) + (envelope.ciphertext[10] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(11) };
  const tamperedPath = testInfo.outputPath('alterada.fize');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  await page.getByLabel('Archivo de la copia').setInputFiles(tamperedPath);
  await page.getByLabel('Código de recuperación').fill(code);
  await page.getByRole('button', { name: 'Restaurar copia' }).click();
  await expect(page.getByTestId('import-msg')).toContainText('dañado o fue modificado', { timeout: 20_000 });

  // Codigo errado: error claro
  await page.getByLabel('Archivo de la copia').setInputFiles(backupPath);
  await page.getByLabel('Código de recuperación').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Restaurar copia' }).click();
  await expect(page.getByTestId('import-msg')).toContainText('código de recuperación no es correcto', { timeout: 20_000 });

  // Codigo correcto (en minusculas y sin guiones tambien vale)
  await page.getByLabel('Código de recuperación').fill(code.toLowerCase().replace(/-/g, ''));
  await page.getByRole('button', { name: 'Restaurar copia' }).click();
  await expect(page.getByTestId('import-msg')).toContainText('Copia restaurada', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Hola, Doña Rosa' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/local/carta/');
  await expect(page.getByText('Ejecutivo del día')).toBeVisible();
  await expect(page.getByText('Bebidas').first()).toBeVisible();

  expect(apiCalls, 'el modo local no llama a la API del servidor').toEqual([]);
  const filteredErrors = errors.filter(
    // Ignore connection closing/abort errors that occur during database deletion
    e => !e.includes('Connection is closing because of: Force close delete origin') && !e.includes('AbortError')
  );
  expect(filteredErrors, 'sin errores en consola en /local/*').toEqual([]);
});

// QA pre-entrega 2026-10-13 #5: antes de publicar, el comensal veia un 404 en crudo («No encontramos
// esa carta») mientras /local/publicar le prometia al duenno «Esta carta todavía no está publicada».
test('carta no publicada: aviso amable (404) en vez de un 404 en crudo', async ({ request }) => {
  // Slug que nadie publico en esta corrida: no hay instantanea en R2 ni restaurante en la nube.
  const slug = `sin-publicar-${Date.now().toString(36)}`;
  const res = await request.get(`/${slug}/menu`);
  expect(res.status()).toBe(404);
  const body = await res.text();
  expect(body).toContain('Esta carta todavía no está publicada');
  expect(body).not.toContain('No encontramos esa carta');
});

// Copia de OTRO local (auditoria local-node B1): aviso con los dos locales, confirmacion escrita y copia de
// seguridad del local actual antes de reemplazar. En el celular (390×844), que es donde se usa.
test.describe('copia de otro local', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Onboarding hasta tener local (paso 3), codigo (paso 4) y un plato (paso 5). Devuelve el codigo. */
  async function crearLocal(page: Page, nombre: string, plato: string): Promise<string> {
    await page.goto('/local/');
    await expect(page.getByTestId('paso')).toHaveText('Paso 1 de 6');
    await page.getByRole('button', { name: 'Empezar' }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
    await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
    await expect(page.getByTestId('recovery-code')).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
    await page.getByLabel('Ya lo anoté en un lugar seguro').check();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nueva categoría').fill('Carta');
    await page.getByRole('button', { name: 'Agregar categoría' }).click();
    await page.getByLabel('Plato').fill(plato);
    await page.getByLabel('Precio (COP)').fill('12000');
    await page.getByRole('button', { name: 'Agregar plato' }).click();
    await expect(page.getByLabel('Tu carta').getByText(plato)).toBeVisible();
    return code;
  }

  async function descargarCopia(page: Page, path: string) {
    await page.goto('/local/respaldo/');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Descargar copia cifrada/ }).click();
    await (await downloadPromise).saveAs(path);
  }

  async function abrirCopia(page: Page, path: string, code: string) {
    await page.goto('/local/respaldo/');
    await page.getByLabel('Archivo de la copia').setInputFiles(path);
    await page.getByLabel('Código de recuperación').fill(code);
    await page.getByRole('button', { name: 'Restaurar copia' }).click();
  }

  test('aviso con los dos locales, confirmación escrita y copia de seguridad del local actual', async ({ page, context }, testInfo) => {
    test.setTimeout(240_000);
    const { errors, apiCalls } = watch(page);

    // Otro equipo: "Café Norte" hace su copia.
    const codeB = await crearLocal(page, 'Café Norte', 'Tinto campesino');
    const copiaB = testInfo.outputPath('cafe-norte.fize');
    await descargarCopia(page, copiaB);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: new URL(page.url()).origin, storageTypes: 'indexeddb,local_storage' });

    // Este equipo: "Doña Rosa", con su carta.
    const codeA = await crearLocal(page, 'Doña Rosa', 'Ejecutivo del día');

    // Restaurar la copia de Café Norte: aviso, nada cambia todavia.
    await abrirCopia(page, copiaB, codeB);
    const aviso = page.getByTestId('foreign-warning');
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(aviso.getByRole('heading', { name: 'Esta copia es de otro local' })).toBeVisible();
    await expect(page.getByTestId('foreign-current-name')).toHaveText('Doña Rosa');
    await expect(page.getByTestId('foreign-current-link')).toHaveText('fize.swal.network/dona-rosa/menu');
    await expect(page.getByTestId('foreign-incoming-name')).toHaveText('Café Norte');
    await expect(page.getByTestId('foreign-incoming-link')).toHaveText('fize.swal.network/cafe-norte/menu');
    await expect(aviso).toContainText('ya no podrás actualizar su carta publicada (fize.swal.network/dona-rosa/menu)');
    await page.screenshot({ path: testInfo.outputPath('aviso-otro-local-390x844-1-inicio.png') });
    await expect(aviso).toContainText('se descarga una copia cifrada de Doña Rosa con tu código actual');
    const reemplazar = aviso.getByRole('button', { name: 'Reemplazar por Café Norte' });
    await expect(reemplazar).toBeDisabled();
    await aviso.getByLabel(/Para confirmar, escribe/).fill('REEMPLAZA');
    await expect(reemplazar).toBeDisabled();
    await aviso.getByLabel(/Para confirmar, escribe/).fill('REEMPLAZAR');
    await expect(reemplazar).toBeEnabled();
    // Sin desborde horizontal en el celular.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('aviso-otro-local-390x844-2-confirmado.png') });
    await page.screenshot({ path: testInfo.outputPath('aviso-otro-local-390x844-pagina-completa.png'), fullPage: true });

    // Cancelar: el local sigue siendo Doña Rosa.
    await aviso.getByRole('button', { name: 'Cancelar' }).click();
    await expect(aviso).toHaveCount(0);
    await expect(page.getByTestId('import-msg')).toContainText('Tu local sigue igual');
    await page.goto('/local/ajustes/');
    await expect(page.locator('#rest-name')).toHaveValue('Doña Rosa');

    // Confirmar: primero se descarga la copia de Doña Rosa, luego cambia a Café Norte.
    await abrirCopia(page, copiaB, codeB);
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await aviso.getByLabel(/Para confirmar, escribe/).fill('reemplazar');
    const seguridadPromise = page.waitForEvent('download');
    await aviso.getByRole('button', { name: 'Reemplazar por Café Norte' }).click();
    const seguridad = await seguridadPromise;
    expect(seguridad.suggestedFilename()).toMatch(/^fize-dona-rosa-\d{4}-\d{2}-\d{2}-antes-de-reemplazar\.fize$/);
    const copiaA = testInfo.outputPath('dona-rosa-seguridad.fize');
    await seguridad.saveAs(copiaA);
    await expect(page.getByTestId('import-msg')).toContainText('Tu local anterior quedó guardado', { timeout: 20_000 });
    await expect(page).toHaveURL(/\/local\/$/, { timeout: 15_000 });
    await page.goto('/local/ajustes/');
    await expect(page.locator('#rest-name')).toHaveValue('Café Norte');
    await page.goto('/local/carta/');
    await expect(page.getByText('Tinto campesino').first()).toBeVisible();
    await expect(page.getByText('Ejecutivo del día')).toHaveCount(0);

    // La copia de seguridad, con el codigo de Doña Rosa, la devuelve completa.
    await abrirCopia(page, copiaA, codeA);
    await expect(page.getByTestId('foreign-current-name')).toHaveText('Café Norte', { timeout: 20_000 });
    await expect(page.getByTestId('foreign-incoming-name')).toHaveText('Doña Rosa');
    await aviso.getByLabel(/Para confirmar, escribe/).fill('REEMPLAZAR');
    const segunda = page.waitForEvent('download');
    await aviso.getByRole('button', { name: 'Reemplazar por Doña Rosa' }).click();
    expect((await segunda).suggestedFilename()).toMatch(/^fize-cafe-norte-.*-antes-de-reemplazar\.fize$/);
    await expect(page).toHaveURL(/\/local\/$/, { timeout: 20_000 });
    await page.goto('/local/ajustes/');
    await expect(page.locator('#rest-name')).toHaveValue('Doña Rosa');
    await page.goto('/local/carta/');
    await expect(page.getByText('Ejecutivo del día').first()).toBeVisible();

    expect(apiCalls, 'el modo local no llama a la API del servidor').toEqual([]);
    const filteredErrors = errors.filter(
      // Ignore connection closing/abort errors that occur during database deletion
      e => !e.includes('Connection is closing because of: Force close delete origin') && !e.includes('AbortError')
    );
    expect(filteredErrors, 'sin errores en consola en /local/*').toEqual([]);
  });
});
