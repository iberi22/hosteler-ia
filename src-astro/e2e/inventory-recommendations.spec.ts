import { test, expect } from '@playwright/test';
import { staffCookie } from './staff-auth';

test.describe('Inventory Recommendations (Local Mode)', () => {
  test('should load the inventory page and hide the recommendation panel in local mode', async ({ page, request, context }) => {
    // 1. Authenticate as staff so we can access /dashboard
    const cookieHeader = await staffCookie(request);
    const cookieVal = cookieHeader.split('=')[1];
    
    await context.addCookies([{
      name: 'fize_session',
      value: cookieVal,
      domain: 'localhost',
      path: '/'
    }]);
    
    // Go to inventory page
    await page.goto('/dashboard/inventory');
    
    // Ensure the page title is visible
    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();

    // Verify the stock-vs-minimum card is visible (ensure side grid is present)
    await expect(page.locator('.svm-title')).toBeVisible();
    
    // The recommendation panel should not be visible as it handles local 404 cleanly without error box
    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeHidden();
    
    // No error class elements matching recommendation panel's standard error should exist
    const errorText = page.locator('p.error');
    await expect(errorText).toBeHidden();

    // Assert that standard page loaded without unexpected errors
    await expect(page.locator('.inventory-page')).toBeVisible();
  });
});
