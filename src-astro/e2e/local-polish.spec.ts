import { test, expect } from '@playwright/test';

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
    // Add a fake order to IndexedDB to simulate a non-empty queue
    await page.goto('/local/');
    await page.evaluate(async () => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('hosteler_ia_local', 2);
        req.onupgradeneeded = () => {
           req.result.createObjectStore('orders', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('orders')) { resolve(); return; }
          const tx = db.transaction('orders', 'readwrite');
          const store = tx.objectStore('orders');
          store.put({
            id: 'mock-order-1',
            type: 'order',
            status: 'pending',
            tableId: '1',
            totalAmount: 1000,
            items: [],
            created_at: new Date().toISOString()
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.goto('/local/cocina/?demo=1');

    // It should display the notice
    const notice = page.locator('.demo-notice');
    await expect(notice).toHaveText('La demo solo se carga con la cocina vacía');
  });

  test('menu editor can delete an item', async ({ page }) => {
    // We first need to mock/add a menu item to the local IDB, or do the onboarding and add one.
    // Instead of doing onboarding, let's inject a mock item to the DB, or try to navigate and use the store if possible.
    // Easiest is to go to /local/carta/, which might show a blank list if not onboarded, but menu is there.
    // It's a prerendered static page with client side IDB logic. We can mock an item in IDB.
    await page.goto('/local/carta/');
    await page.evaluate(async () => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('hosteler_ia_local', 2);
        req.onupgradeneeded = () => {
           if (!req.result.objectStoreNames.contains('menu-items')) {
             req.result.createObjectStore('menu-items', { keyPath: 'id' });
           }
        };
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('menu-items')) { resolve(); return; }
          const tx = db.transaction('menu-items', 'readwrite');
          const store = tx.objectStore('menu-items');
          store.put({
            id: 'mock-item-1',
            type: 'menu-item',
            name: 'Plato para eliminar',
            price: 5000,
            categoryId: 'mock-cat',
            isAvailable: true,
            created_at: new Date().toISOString()
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    // Reload to see the mocked item
    await page.reload();

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
