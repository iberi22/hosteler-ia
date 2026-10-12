import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// Historias para WhatsApp en el nodo local (/local/historias/): las imagenes (1080×1920) se dibujan en el equipo
// con Canvas 2D a partir de la carta guardada en IndexedDB, se descargan como PNG o se comparten con el menu
// del celular (Web Share API con archivos). Sin llamadas a la API del servidor y sin errores en consola.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function watch(page: Page) {
  const errors: string[] = [];
  const apiCalls: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.includes('/api/public-menu/')) errors.push(`${page.url()} :: ${m.text()} @ ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/public-menu/')) apiCalls.push(`${r.method()} ${u.pathname}`);
  });
  return { errors, apiCalls };
}

const DISHES: Array<[string, string]> = [
  ['Ajiaco santafereño', '22000'],
  ['Bandeja paisa completa con chicharrón', '28000'],
  ['Sancocho de gallina', '20000'],
  ['Ejecutivo del día', '16000'],
  ['Mojarra frita con patacón', '30000'],
  ['Cazuela de frijoles', '18000'],
  ['Sobrebarriga en salsa criolla', '26000'],
];
const DRINKS: Array<[string, string]> = [
  ['Limonada de coco', '9000'],
  ['Jugo de lulo en agua', '6000'],
];

/** Onboarding completo sin publicar (pasos de e2e/local-node.spec.ts). */
async function onboard(page: Page) {
  await page.goto('/local/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue('dona-rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.getByRole('heading', { name: 'Tu primera carta' })).toBeVisible();
  const addCategory = async (name: string) => {
    await page.getByLabel('Nueva categoría').fill(name);
    await page.getByRole('button', { name: 'Agregar categoría' }).click();
    await expect(page.getByLabel('Tu carta').getByRole('heading', { name })).toBeVisible();
  };
  const addDish = async (name: string, price: string, category: string) => {
    await page.getByLabel('Plato', { exact: true }).fill(name);
    await page.getByLabel('Precio (COP)').fill(price);
    await page.getByLabel('Categoría', { exact: true }).selectOption({ label: category });
    await page.getByRole('button', { name: 'Agregar plato' }).click();
    await expect(page.getByLabel('Tu carta').getByText(name, { exact: true })).toBeVisible();
  };
  await addCategory('Almuerzos');
  for (const [name, price] of DISHES) await addDish(name, price, 'Almuerzos');
  await addCategory('Bebidas');
  for (const [name, price] of DRINKS) await addDish(name, price, 'Bebidas');
  await page.getByRole('button', { name: 'Seguir' }).click();
  // Publicar: se salta aqui para probar el aviso de "carta sin publicar".
  await expect(page.getByRole('heading', { name: 'Publica tu carta' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Seguir' }).click();
  await page.getByRole('button', { name: 'Ir a mi panel' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Doña Rosa' })).toBeVisible();
}

interface CanvasStats {
  w: number;
  h: number;
  colors: number;
  ms: number;
}

async function canvasStats(page: Page, n: number): Promise<CanvasStats> {
  const canvas = page.locator(`canvas[data-story="${n}"]`);
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return { w: c.width, h: c.height, colors: 0, ms: Number.NaN };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set<number>();
    for (let p = 0; p < d.length; p += 4 * 61) colors.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
    return { w: c.width, h: c.height, colors: colors.size, ms: Number(c.dataset.renderMs) };
  });
}

async function expectStory(page: Page, n: number) {
  const s = await canvasStats(page, n);
  expect(s.w).toBe(1080);
  expect(s.h).toBe(1920);
  // Un lienzo en blanco (o solo el fondo) tiene 1–2 colores; con texto antialiased hay decenas.
  expect(s.colors).toBeGreaterThan(20);
  expect(s.ms).toBeLessThan(300);
  return s;
}

/** Hash barato del contenido del lienzo: sirve para ver que cambio. */
function canvasSignature(page: Page, n: number) {
  return page.locator(`canvas[data-story="${n}"]`).evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png').length);
}

test('historias: plantillas, estilos, descarga, compartir y sin red', async ({ page, context }) => {
  test.setTimeout(240_000);
  const { errors, apiCalls } = watch(page);
  await page.route('**/api/public-menu/**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' }),
  );

  await onboard(page);

  // Entrada desde el inicio y desde el menu
  await page.getByRole('link', { name: /Crear historia para WhatsApp/ }).click();
  await expect(page).toHaveURL(/\/local\/historias\/$/);
  await expect(page.getByRole('heading', { name: 'Historias para WhatsApp' })).toBeVisible();
  await expect(page.locator('a[href="/local/historias/"]').first()).toBeVisible();

  // Sin publicar: aviso con enlace a /local/publicar/
  const notice = page.getByTestId('no-publicada');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('link', { name: 'Publicar mi carta' })).toHaveAttribute('href', '/local/publicar/');

  // Menu del dia por categoria: 7 almuerzos caben en una imagen
  await page.getByText('Menú del día', { exact: true }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Menú de hoy');
  await page.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Almuerzos (7)' });
  await expect(page.getByTestId('menu-count')).toContainText('7 platos');
  await expect(page.locator('canvas[data-story]')).toHaveCount(1);
  await expectStory(page, 1);

  // El titulo se redibuja tras dejar de escribir
  const before = await canvasSignature(page, 1);
  await page.getByLabel('Título').fill('Almuerzos del sábado');
  await expect.poll(() => canvasSignature(page, 1)).not.toBe(before);

  // Elegir platos: 9 platos = 2 imagenes (5 + 4)
  await page.getByText('Elegir platos', { exact: true }).click();
  const picks = page.getByRole('group', { name: 'Platos de la historia' }).getByRole('checkbox');
  await expect(picks).toHaveCount(9);
  for (const box of await picks.all()) await box.check();
  await expect(page.getByTestId('menu-count')).toContainText('9 platos');
  await expect(page.getByTestId('menu-count')).toContainText('2 imágenes');
  await expect(page.locator('canvas[data-story]')).toHaveCount(2);
  await expectStory(page, 1);
  await expectStory(page, 2);

  // Cada estilo dibuja algo distinto
  const seen = new Set<number>();
  for (const name of ['Bone claro', 'Bone oscuro', 'Taller naranja', 'Cocina']) {
    await page.getByRole('radio', { name }).check({ force: true });
    await expectStory(page, 1);
    await expect.poll(async () => !seen.has(await canvasSignature(page, 1))).toBe(true);
    seen.add(await canvasSignature(page, 1));
  }

  // Descarga (el navegador de pruebas no comparte archivos: es el camino de respaldo)
  await expect(page.getByRole('button', { name: 'Compartir en WhatsApp' })).toHaveCount(0);
  const dlPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar imagen 2' }).click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toMatch(/^historia-dona-rosa-\d{4}-\d{2}-\d{2}-2\.png$/);
  const png = readFileSync(await dl.path());
  expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE);
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1920);

  // Plato destacado, sin foto y con foto
  await page.getByText('Plato destacado', { exact: true }).click();
  await page.getByLabel('Plato', { exact: true }).selectOption({ label: 'Ajiaco santafereño — $ 22.000' });
  await page.getByLabel('Descripción corta').fill('Con pollo desmechado, mazorca, alcaparras y crema de leche. Arroz y aguacate aparte.');
  await expect(page.locator('canvas[data-story]')).toHaveCount(1);
  const noPhoto = await expectStory(page, 1);
  const photo = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    const g = ctx.createLinearGradient(0, 0, 1200, 900);
    g.addColorStop(0, '#f4c27a');
    g.addColorStop(1, '#7a2e12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1200, 900);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 55%)`;
      ctx.beginPath();
      ctx.arc((i * 131) % 1200, (i * 211) % 900, 40 + (i % 5) * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return c.toDataURL('image/png').split(',')[1] ?? '';
  });
  await page.getByLabel('Elegir de la galería').setInputFiles({ name: 'ajiaco.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await expect(page.getByTestId('photo-name')).toHaveText('Foto: ajiaco.png');
  await expect.poll(async () => (await canvasStats(page, 1)).colors).toBeGreaterThan(noPhoto.colors);
  await expectStory(page, 1);
  await page.getByRole('button', { name: 'Quitar foto' }).click();
  await expect(page.getByTestId('photo-name')).toHaveCount(0);

  // Pide aqui (QR)
  await page.getByText('Pide aquí', { exact: true }).click();
  await expect(page.locator('canvas[data-story]')).toHaveCount(1);
  await expectStory(page, 1);
  await expect(page.getByText('fize.swal.network/dona-rosa/menu')).toBeVisible();

  // Publicar y volver: el aviso desaparece
  await page.goto('/local/publicar/');
  await page.getByLabel('Código de activación').fill('PRUEBA-1234');
  await page.getByRole('button', { name: 'Publicar carta' }).click();
  await expect(page.getByText('Carta publicada:')).toBeVisible();
  await page.goto('/local/historias/');
  await expect(page.getByRole('heading', { name: 'Historias para WhatsApp' })).toBeVisible();
  await expect(page.getByTestId('no-publicada')).toHaveCount(0);

  // Compartir: con canShare(files) = true se llama a navigator.share con PNG y el texto con el enlace
  await page.addInitScript(() => {
    const record: Array<{ name: string; type: string; size: number; head: number[] }> = [];
    const w = window as unknown as { __shared?: { text: string; files: typeof record } };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        for (const f of data.files ?? []) {
          record.push({ name: f.name, type: f.type, size: f.size, head: Array.from(new Uint8Array(await f.slice(0, 8).arrayBuffer())) });
        }
        w.__shared = { text: data.text ?? '', files: record };
      },
    });
  });
  await page.reload();
  await page.getByText('Menú del día', { exact: true }).click();
  await page.getByText('Una categoría', { exact: true }).click();
  await page.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Almuerzos (7)' });
  await expectStory(page, 1);
  await page.getByRole('button', { name: 'Compartir en WhatsApp' }).click();
  const shared = await page.waitForFunction(() => (window as unknown as { __shared?: unknown }).__shared).then((h) => h.jsonValue());
  const result = shared as { text: string; files: Array<{ name: string; type: string; size: number; head: number[] }> };
  expect(result.text).toBe('Doña Rosa — mira la carta y pide aquí: https://fize.swal.network/dona-rosa/menu');
  expect(result.files).toHaveLength(1);
  expect(result.files[0].type).toBe('image/png');
  expect(result.files[0].name).toMatch(/^historia-dona-rosa-\d{4}-\d{2}-\d{2}-1\.png$/);
  expect(result.files[0].head).toEqual(PNG_SIGNATURE);
  expect(result.files[0].size).toBeGreaterThan(10_000);
  await expect(page.getByText('En WhatsApp elige “Mi estado”')).toBeVisible();

  // Sin red: la pagina sale del precache y sigue dibujando
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#net-banner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Historias para WhatsApp' })).toBeVisible();
  await page.getByText('Pide aquí', { exact: true }).click();
  await expectStory(page, 1);
  await page.goto('/local/historias');
  await expect(page).toHaveURL(/\/local\/historias\/$/);
  await expectStory(page, 1);
  await context.setOffline(false);

  expect(apiCalls, 'el modo local no llama a la API del servidor').toEqual([]);
  expect(errors, 'sin errores en consola en /local/historias/').toEqual([]);
});
