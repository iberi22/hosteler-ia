import { test, expect, type Page } from '@playwright/test';

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

const mockSnapshot = {
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

test.describe('Bodega read-only inventory', () => {
  test('loads a plain snapshot, displays data, and does not make network requests or save to IDB', async ({ page }) => {
    // We stay online but track requests to ensure no calls reach external or cloud APIs.
    let externalReqCount = 0;

    // Parse origin from baseURL (like http://localhost:4331 or the preview url)
    const origin = (page.context() as any)._options?.baseURL
      ? new URL((page.context() as any)._options.baseURL).origin
      : 'http://localhost:4331';

    page.on('request', (req) => {
      const url = req.url();
      // Ignore same-origin
      if (!url.startsWith(origin) && !url.includes('127.0.0.1')) {
        externalReqCount++;
      }
    });

    await onboardLocal(page);
    await page.goto('/local/bodega/');

    // Wait for Astro island hydration
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await expect(page.getByRole('heading', { name: 'Bodega' })).toBeVisible();

    // Take snapshot of IDB databases before
    const dbsBefore = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.map(db => db.name).sort();
    });

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

    // Verify it didn't write any new database
    const dbsAfter = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.map(db => db.name).sort();
    });

    expect(dbsAfter).toEqual(dbsBefore);
    expect(externalReqCount).toBe(0);
  });
});
