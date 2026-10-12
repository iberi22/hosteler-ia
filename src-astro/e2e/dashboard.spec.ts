import { test, expect } from '@playwright/test';

test('dashboard guests redirect to /login', async ({ page }) => {
  await page.goto('/dashboard/orders');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('form.auth-form')).toBeVisible();
});
