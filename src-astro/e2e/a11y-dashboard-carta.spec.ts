import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { staffCookie } from './staff-auth';

const PAGES = [
  { path: '/dashboard/menu', heading: 'Menú' },
  { path: '/dashboard/recipes', heading: 'Recetas' }
];

for (const { path, heading } of PAGES) {
  test(`a11y WCAG 2.2 AA: ${path} has no serious or critical violations in main`, async ({ page, request, context, baseURL }) => {

    // Obtain the authentication cookie for the staff owner
    // This uses the exact same auth helper as qr-print.spec.ts does
    const cookie = await staffCookie(request);

    // Add the cookie to the browser context so we are logged in for this route
    await context.addCookies([
      { name: 'fize_session', value: cookie.split('=')[1]!, url: baseURL ?? 'http://localhost:4331' },
    ]);

    // Go to the specific dashboard route
    await page.goto(path);

    // Wait for the exact heading string to ensure the client component is loaded
    // Svelte 5 island `client:load` heading is not in the Astro file — axe must wait for the heading
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();

    // Run AxeBuilder only on the <main> element
    // AxeBuilder.include('main') ensures the shared chrome (like BaseLayout or StaffShell) is out of scope
    // We only test with wcag2a, wcag2aa, wcag22aa as per standard for the rest of the application
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();

    // Filter violations to only look for 'serious' or 'critical' impact ones
    const seriousOrCriticalViolations = results.violations.filter(
      v => v.impact === 'serious' || v.impact === 'critical'
    );

    // Assert no serious or critical violations exist inside the main section of the route
    expect(seriousOrCriticalViolations).toEqual([]);
  });
}
