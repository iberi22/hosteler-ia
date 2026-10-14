import { test, expect } from '@playwright/test';

// Use a page that uses BaseLayout where OfflineIndicator and InstallPrompt are mounted.
test('Offline banner shows and hides based on network status', async ({ page, context }) => {
  await page.goto('/login');

  await page.waitForLoadState('networkidle');

  // Go offline
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  const offlineBanner = page.getByRole('status').filter({ hasText: 'Sin conexión' });
  await expect(offlineBanner).toBeVisible();

  // Go back online
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Expect it to hide
  await expect(offlineBanner).toBeHidden();
});

test('Install prompt renders on beforeinstallprompt event', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Dispatch beforeinstallprompt
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as any;
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });

  // Check if install prompt is visible
  const installPrompt = page.getByRole('dialog', { name: 'Instalar aplicación' });
  await expect(installPrompt).toBeVisible();
  await expect(installPrompt.getByText('Instala Fi’ze para acceso rápido sin conexión')).toBeVisible();
  await expect(installPrompt.getByRole('button', { name: 'Instalar' })).toBeVisible();

  // Accept the prompt
  await installPrompt.getByRole('button', { name: 'Instalar' }).click();

  // Expect it to hide
  await expect(installPrompt).toBeHidden();
});
