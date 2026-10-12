import { test, expect } from '@playwright/test';

test('PWA manifest is valid with Fi’ze identity', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.name).toContain('Fi');
  expect(manifest.short_name).toContain('Fi');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons?.length).toBeGreaterThan(0);
});

test('service worker registers and serves sw.js', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain('fi-ze-orders');
});
