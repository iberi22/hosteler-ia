import { test, expect } from '@playwright/test';

const adminPages = [
  '/dashboard/tables',
  '/dashboard/kitchen',
  '/dashboard/analytics',
  '/dashboard/settings',
  '/dashboard/client',
];

for (const path of adminPages) {
  test(`GET ${path} returns 200`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
  });
}

test('tables page passes mock-killer assertion', async ({ request }) => {
  const res = await request.get('/dashboard/tables');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toContain('fize.app');
});

test.describe('browser rendering', () => {

  test('admin pages render in browser', async ({ page }) => {
    for (const path of adminPages) {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
