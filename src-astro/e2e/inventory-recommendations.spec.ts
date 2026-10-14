import { test, expect } from '@playwright/test';
import { staffCookie } from './staff-auth';

test.describe('Inventory Recommendations (Local Mode)', () => {
  test('should load the inventory page and hide the recommendation panel in local mode', async ({ page, request, context }) => {
    const cookieHeader = await staffCookie(request);
    const cookieVal = cookieHeader.split('=')[1];

    await context.addCookies([{
      name: 'fize_session',
      value: cookieVal,
      domain: 'localhost',
      path: '/'
    }]);

    await page.goto('/dashboard/inventory');

    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();

    await expect(page.locator('.pred-title')).toBeVisible();

    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeHidden();

    const errorText = page.locator('p.error');
    await expect(errorText).toBeHidden();

    await expect(page.locator('.inventory-page')).toBeVisible();
  });
});
