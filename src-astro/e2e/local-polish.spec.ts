import { test, expect, type Page } from '@playwright/test';

// Onboarding hasta el paso 4 (mismo recorrido que e2e/local-table-qr.spec.ts): deja creada la identidad
// del local en `fize-local`, sin la cual el modo local responde 409.
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

// Siembra un registro en `fize-db` (un store por entidad, ver src-astro/src/lib/idbAdapter.ts) con el
// `instance_id` de la identidad real del equipo. Así la UI lo lee como cualquier dato guardado.
async function seedLocal(page: Page, store: 'category' | 'menuItem' | 'order', record: Record<string, unknown>) {
  await page.evaluate(
    async ({ store, record }) => {
      const openDb = (name: string) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const kv = await openDb('fize-local');
      const identity = await new Promise<{ instanceId: string }>((resolve, reject) => {
        const req = kv.transaction('kv').objectStore('kv').get('identity');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      kv.close();
      const db = await openDb('fize-db');
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put({ ...record, instance_id: identity.instanceId });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { store, record },
  );
}

test.describe('Local mode polish QA fixes', () => {
  test('header and banner do not scroll away when overflow-x is clip', async ({ page }) => {
    await page.goto('/local/carta/');
    await page.evaluate(() => {
      const banner = document.getElementById('net-banner');
      if (banner) {
        banner.removeAttribute('hidden');
        banner.style.display = 'block';
      }
      // Add height to allow scrolling
      document.body.style.height = '2000px';
    });

    // Scroll down 400px
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);

    const bannerBounds = await page.evaluate(() => {
      const banner = document.getElementById('net-banner');
      return banner ? banner.getBoundingClientRect() : null;
    });

    expect(bannerBounds).not.toBeNull();
    expect(bannerBounds!.top).toBeGreaterThanOrEqual(0);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBeFalsy();
  });

  test('cocina queue with ?demo=1 shows notice if not empty and does not seed', async ({ page }) => {
    await onboardLocal(page);
    // Una comanda real en la cola: con ?demo=1 la cocina debe avisar y NO sembrar la demo encima.
    await seedLocal(page, 'order', {
      id: 'mock-order-1',
      tableId: '',
      status: 'pending',
      items: [],
      totalAmount: 1000,
      created_at: new Date().toISOString(),
    });

    await page.goto('/local/cocina/?demo=1');

    const notice = page.locator('.demo-notice');
    await expect(notice).toHaveText('La demo solo se carga con la cocina vacía');
  });

  test('menu editor can delete an item', async ({ page }) => {
    await onboardLocal(page);
    await seedLocal(page, 'category', { id: 'mock-cat', name: 'Entradas', description: '', created_at: new Date().toISOString() });
    await seedLocal(page, 'menuItem', {
      id: 'mock-item-1',
      name: 'Plato para eliminar',
      price: 5000,
      categoryId: 'mock-cat',
      isAvailable: true,
      created_at: new Date().toISOString(),
    });

    await page.goto('/local/carta/');

    const deleteBtn = page.getByRole('button', { name: 'Eliminar' }).first();
    await expect(deleteBtn).toBeVisible();

    // Intercept confirm dialog
    page.on('dialog', dialog => dialog.accept());

    await deleteBtn.click();
    await expect(page.getByText('Plato para eliminar')).not.toBeVisible();

    // Verify it's gone after reload
    await page.reload();
    await expect(page.getByText('Plato para eliminar')).not.toBeVisible();
  });
});
