import { test, expect } from '@playwright/test';

test.describe('F2 Active status chip on /local/pedidos reflects the URL filter', () => {
  test('status chips render aria-pressed and update when navigating', async ({ page }) => {
    // Navigate to /local/pedidos with no filter
    await page.goto('/local/pedidos');

    // Assert "Todos" chip is pressed
    const todosChip = page.locator('a.chip[data-pedidos-chip=""]');
    await expect(todosChip).toHaveAttribute('aria-pressed', 'true');
    await expect(todosChip).toHaveClass(/active/);

    // Assert "Cobrado" chip is not pressed
    const paidChip = page.locator('a.chip[data-pedidos-chip="paid"]');
    await expect(paidChip).toHaveAttribute('aria-pressed', 'false');
    await expect(paidChip).not.toHaveClass(/active/);

    // Navigate to /local/pedidos with ?status=paid
    await page.goto('/local/pedidos?status=paid');

    // Assert "Todos" chip is not pressed
    const todosChip2 = page.locator('a.chip[data-pedidos-chip=""]');
    await expect(todosChip2).toHaveAttribute('aria-pressed', 'false');
    await expect(todosChip2).not.toHaveClass(/active/);

    // Assert "Cobrado" chip is pressed
    const paidChip2 = page.locator('a.chip[data-pedidos-chip="paid"]');
    await expect(paidChip2).toHaveAttribute('aria-pressed', 'true');
    await expect(paidChip2).toHaveClass(/active/);
  });
});
