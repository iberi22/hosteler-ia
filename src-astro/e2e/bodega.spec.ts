import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { sealInventorySnapshot, type PlainInventorySnapshot } from '../src/lib/inventoryExport';

// Onboarding hasta el paso 4 para que la app no responda 409
async function onboardLocal(page: Page) {
  await page.goto('/local/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
}

const mockSnapshot: PlainInventorySnapshot = {
  format: "swal-inventory-export/v1",
  source: { appId: "shelf", instanceId: "test-123", schemaVersion: 1, exportedAt: "2026-10-15T10:00:00Z" },
  currency: "COP",
  locations: [ { id: "loc-1", name: "Bodega Central", type: "bodega" } ],
  items: [
    { id: "item-1", sku: "SKU-1", name: "Harina", quantity: 50, unit: "kg", minStock: 20, cost: 2000, price: 0, locationId: "loc-1", customFields: {} },
    { id: "item-2", sku: "SKU-2", name: "Azúcar", quantity: 5, unit: "kg", minStock: 10, cost: 3000, price: 0, locationId: "loc-1", customFields: {} },
    { id: "item-3", sku: null, name: "Sal", quantity: 15, unit: "kg", minStock: 5, cost: 1000, price: 0, locationId: "loc-1", customFields: {} }
  ],
  movements: []
};

// Clave del sobre cifrado de prueba (>= 8 chars, como exige el selector de minutos del export).
const ENC_PASSPHRASE = 'clave-secreta-123';

async function gotoBodega(page: Page) {
  await page.goto('/local/bodega/');
  // Wait for Astro island hydration
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await expect(page.getByRole('heading', { name: 'Bodega' })).toBeVisible();
}

// Volcado de todas las bases y de todos los object stores con sus registros.
async function dumpIndexedDb(page: Page): Promise<Record<string, Record<string, unknown[]>>> {
  return page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const out: Record<string, Record<string, unknown[]>> = {};
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await open(info.name);
      const dump: Record<string, unknown[]> = {};
      for (const store of Array.from(db.objectStoreNames)) {
        dump[store] = await new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      db.close();
      out[info.name] = dump;
    }
    return out;
  });
}

// instanceId real del equipo (identidad en `fize-local`, ver e2e/local-polish.spec.ts).
async function readInstanceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fize-local');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const identity = await new Promise<{ instanceId: string }>((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('identity');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return identity.instanceId;
  });
}

// Siembra articulos de inventario en `fize-db`; cada registro lleva su propio instance_id.
async function seedInventoryItems(page: Page, items: Record<string, unknown>[]) {
  await page.evaluate(async (items) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fize-db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('inventoryItem', 'readwrite');
      for (const item of items) tx.objectStore('inventoryItem').put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, items);
}

test.describe('Bodega read-only inventory', () => {
  test('loads a plain snapshot, displays data, and does not make network requests or save to IDB', async ({ page }) => {
    // Solo el origen exacto de la app esta permitido. 127.0.0.1 (p. ej. Xavier) NO es una excepcion:
    // la CSP lo permite, por eso el test tiene que detectarlo.
    const appOrigin = new URL(test.info().project.use.baseURL ?? 'http://localhost:4331').origin;
    const offOrigin: string[] = [];
    const record = (url: string) => {
      if (!/^https?:/.test(url)) return;
      if (new URL(url).origin !== appOrigin) offOrigin.push(url);
    };
    page.on('request', (req) => record(req.url()));
    page.on('requestfailed', (req) => record(req.url()));
    // Una peticion que la CSP bloquea no emite 'request' ni 'requestfailed' en Chromium: se registra el
    // evento securitypolicyviolation de la propia pagina (blockedURI = URL del intento).
    await page.addInitScript(() => {
      const w = window as unknown as { __cspBlocked: string[] };
      w.__cspBlocked = [];
      document.addEventListener('securitypolicyviolation', (e) => w.__cspBlocked.push(e.blockedURI));
    });

    await onboardLocal(page);
    await gotoBodega(page);

    // Volcado de contenido antes de abrir el archivo (no solo nombres de bases).
    const dbsBefore = await dumpIndexedDb(page);

    // Load file with locator().setInputFiles
    const fileBuffer = Buffer.from(JSON.stringify(mockSnapshot));
    await page.locator('#bodega-file').setInputFiles({
      name: 'snapshot.json',
      mimeType: 'application/json',
      buffer: fileBuffer
    });

    await page.getByRole('button', { name: 'Abrir inventario' }).click();

    // Assert UI elements are displayed correctly
    await expect(page.getByText('Inventario cargado correctamente. Solo lectura.')).toBeVisible();
    await expect(page.getByText('App: shelf')).toBeVisible();
    await expect(page.getByText('test-123')).toBeVisible();

    // Wait for the table to appear and assert rows
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('Harina')).toBeVisible();
    await expect(page.getByText('Azúcar')).toBeVisible();
    await expect(page.getByText('Sal')).toBeVisible();

    // Azucar should have a low stock badge (quantity 5 < minStock 10)
    const lowStockRow = page.locator('tr').filter({ hasText: 'Azúcar' });
    await expect(lowStockRow.locator('.alert-badge')).toBeVisible();

    // Verify search works
    await page.getByLabel('Buscar artículo').fill('Harina');
    await expect(rows).toHaveCount(1);
    await expect(page.getByText('Harina')).toBeVisible();
    await expect(page.getByText('Azúcar')).not.toBeVisible();

    // No escribio nada en IndexedDB: ni bases nuevas ni registros nuevos en las existentes.
    const dbsAfter = await dumpIndexedDb(page);
    expect(Object.keys(dbsAfter).sort()).toEqual(Object.keys(dbsBefore).sort());
    expect(dbsAfter).toEqual(dbsBefore);

    const cspBlocked = await page.evaluate(() => (window as unknown as { __cspBlocked: string[] }).__cspBlocked);
    const blockedOffOrigin = cspBlocked.filter((u) => /^https?:/.test(u) && new URL(u).origin !== appOrigin);
    expect([...offOrigin, ...blockedOffOrigin]).toEqual([]);
  });

  test('loads an encrypted snapshot after entering the passphrase', async ({ page }) => {
    await onboardLocal(page);
    await gotoBodega(page);

    // Build a real encrypted envelope with the app's own sealer (no cloud, deterministic scheme).
    const enc = await sealInventorySnapshot(mockSnapshot, ENC_PASSPHRASE);
    const buffer = Buffer.from(JSON.stringify(enc));

    await page.locator('#bodega-file').setInputFiles({
      name: 'snapshot.enc.json',
      mimeType: 'application/octet-stream',
      buffer
    });

    // First submit: the app detects the envelope and asks for the passphrase.
    await page.getByRole('button', { name: 'Abrir inventario' }).click();
    await expect(page.getByTestId('import-msg')).toHaveText(/cifrado/i);

    // Enter the passphrase and re-submit: it decrypts and shows the data.
    await page.getByLabel('Clave del archivo').fill(ENC_PASSPHRASE);
    await page.getByRole('button', { name: 'Abrir inventario' }).click();

    await expect(page.getByText('Inventario cargado correctamente. Solo lectura.')).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('Harina')).toBeVisible();
  });

  test('rejects an import file larger than 5 MB before reading it', async ({ page }) => {
    await onboardLocal(page);
    await gotoBodega(page);

    // 5 MB + 1 KB of whitespace: over the MAX_IMPORT_BYTES cap.
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x20);
    await page.locator('#bodega-file').setInputFiles({
      name: 'huge.json',
      mimeType: 'application/json',
      buffer: big
    });

    await page.getByRole('button', { name: 'Abrir inventario' }).click();
    await expect(page.getByTestId('import-msg')).toHaveText(/demasiado grande/i);
    // Nothing is loaded: no table rows.
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });

  test('exports the local inventory with its items and the local instanceId', async ({ page }) => {
    await onboardLocal(page);
    const instanceId = await readInstanceId(page);
    // Un articulo del local y otro de un local ajeno: solo el primero debe salir en el archivo.
    await seedInventoryItems(page, [
      { id: 'inv-e2e-local', instance_id: instanceId, name: 'Arroz E2E', stock: 7, unit: 'kg', minStock: 2, unitCost: 1500 },
      { id: 'inv-e2e-ajeno', instance_id: 'otro-local-e2e', name: 'Ajeno E2E', stock: 99, unit: 'kg', minStock: 0, unitCost: 1 },
    ]);
    await gotoBodega(page);

    // Plain export avoids the passphrase-confirm dance.
    await page.getByLabel('Sin cifrar (el archivo se podrá leer sin clave)').check();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar inventario' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^fize-inventario-\d{4}-\d{2}-\d{2}\.swal-inventory\.json$/);
    await expect(page.getByText('Inventario exportado correctamente.')).toBeVisible();

    const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as PlainInventorySnapshot;
    expect(exported.source.instanceId).toBe(instanceId);
    expect(exported.items.map((i) => i.name)).toEqual(['Arroz E2E']);
    expect(exported.items[0].quantity).toBe(7);
  });
});
