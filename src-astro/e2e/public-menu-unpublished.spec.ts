import { test, expect } from '@playwright/test';

test.describe('Public Menu - Unpublished', () => {
  test('displays a friendly notice and 404 status for an unknown slug', async ({ page }) => {
    const response = await page.goto('/unknown-restaurant-123/menu');

    // Assert 404 status code
    expect(response?.status()).toBe(404);

    // Assert the friendly notice text
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Esta carta todavía no está publicada');

    // Assert the strong tag mentions 'Publicar'
    const strongTag = page.locator('strong');
    await expect(strongTag).toContainText('Publicar');

    // Also assert that the requested slug is correctly shown in the instructions
    await expect(page.locator('code')).toHaveText('/unknown-restaurant-123/menu');
  });
});
