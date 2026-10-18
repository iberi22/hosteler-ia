import { test, expect } from '@playwright/test';

test.describe('Inventory Recommendations (Local Mode)', () => {
  test('should load the local inventory page and show the recommendation panel without cloud requests', async ({ page }) => {
    let cloudRequestsCount = 0;
    page.on('request', req => {
      if (req.url().includes('/api/ai/infer')) {
        cloudRequestsCount++;
      }
    });

    // Go to local inventory page
    await page.goto('/local/inventario');
    
    // Ensure the page title is visible
    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();

    // The recommendation panel should be visible
    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeVisible();
    
    // Assert that the AI tier line is visible
    const tierLine = page.locator('p[data-testid="ai-tier"]');
    await expect(tierLine).toBeVisible();

    // Assert that at least one recommendation is visible (or the "all in order" fallback from local fallback rules)
    const listItems = panel.locator('li, p:has-text("Todo en orden"), p:has-text("Sin recomendaciones por ahora"), p:has-text("En el navegador la API solo corre en modo local")');
        await expect(listItems.first()).toBeVisible();

    // Assert that no request to the cloud API was made
    expect(cloudRequestsCount).toBe(0);

    // Assert that standard page loaded without unexpected errors
    await expect(page.locator('.inventory-page')).toBeVisible();
  });
});
