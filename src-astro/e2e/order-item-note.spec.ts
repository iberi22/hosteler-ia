import { test, expect, type Page } from '@playwright/test';

async function onboardLocal(page: Page) {
  await page.goto('/local/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
}

test.describe('Order note (A004)', () => {
  test('create an order with note "sin cebolla" and see it on KDS', async ({ page }) => {
    // 1. Setup local env
    await onboardLocal(page);

    // Create a table manually using the UI
    await page.goto('/local/mesas/');
    // First, verify the page loaded
    await expect(page.locator('h1').filter({ hasText: 'Mesas' })).toBeVisible();
    await page.getByLabel('Nº de Mesa').fill('1');
    await page.getByLabel('Capacidad (pax)').fill('4');
    await page.getByRole('button', { name: 'Añadir Mesa' }).click();
    await expect(page.getByText('Mesa 1', { exact: true })).toBeVisible();

    // Create a category
    await page.goto('/local/carta/');
    await expect(page.locator('h1').filter({ hasText: 'Menú' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept('Hamburguesas'));
    await page.getByRole('button', { name: '+ Nueva categoría' }).click();
    await expect(page.getByText('Hamburguesas').first()).toBeVisible();

    // Create an item
    await page.getByRole('button', { name: '+ Nuevo artículo' }).click();
    await page.getByLabel('SKU').fill('HAMB-01');
    await page.getByLabel('Nombre *').fill('Hamburguesa');
    await page.getByLabel('Precio (COP) *').fill('15000');
    // Select category assuming standard select
    await page.getByLabel('Categoría *').selectOption({ label: 'Hamburguesas' });
    await page.getByRole('button', { name: 'Guardar' }).click();
    // Wait for the dialog to disappear
    await expect(page.getByRole('heading', { name: 'Nuevo artículo' })).toBeHidden();
    // Verify the item is in the list
    await expect(page.getByRole('heading', { name: 'Hamburguesa' }).first()).toBeVisible();

    // 2. Go to local take order
    await page.goto('/local/nuevo-pedido/');

    // Wait for the form to load (and for the table to appear)
    await expect(page.locator('form.take-order')).toBeVisible();
    await expect(page.locator('#take-order-table')).toBeVisible();

    // Select a table
    await page.locator('#take-order-table').selectOption({ index: 1 });

    // Add an item
    const stepper = page.locator('.stepper').first();
    await expect(stepper).toBeVisible();
    await stepper.locator('button', { hasText: '+' }).click();

    // Add the note
    await page.locator('#take-order-note').fill('sin cebolla');

    // Submit
    await page.locator('button[type="submit"]').click();

    // Verify success
    await expect(page.locator('.success')).toBeVisible();

    // 3. Go to kitchen
    await page.goto('/local/cocina/');

    // Verify the card is visible in pending lane
    const pendingLane = page.locator('.lane[data-status="pending"]');
    await expect(pendingLane).toBeVisible();

    // Assert the note is visible on the KDS card
    const card = pendingLane.locator('.kds-card').first();
    await expect(card).toContainText('sin cebolla');
  });
});
