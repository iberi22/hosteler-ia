import { test, expect, type Page } from '@playwright/test';

// Onboarding hasta el paso 4 para tener un restaurante real creado en el IndexedDB local
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

test.describe('Inventory Recommendations (Local Mode)', () => {
  test('should load the local inventory page and show the recommendation panel without cloud requests', async ({ page }) => {
    let cloudRequestsCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/ai/infer')) {
        cloudRequestsCount++;
      }
    });

    // 1. Onboarding para inicializar la identidad e IndexedDB con el restaurante
    await onboardLocal(page);

    // 2. Ir a inventario local y esperar carga
    await page.goto('/local/inventario/');
    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();

    // 3. El panel de recomendaciones debe estar visible en el DOM
    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeVisible();

    // 4. Encabezado del panel
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('✨ Fi’ze recomienda');

    // 5. Etiqueta del tier de IA local
    const tierLine = page.getByTestId('ai-tier');
    await expect(tierLine).toBeVisible();
    await expect(tierLine).toHaveText('IA local: reglas del local');

    // 6. Contenido generado por el motor de reglas local: item [ops]
    const recItem = panel.locator('ul li').first();
    await expect(recItem).toBeVisible();
    await expect(recItem.locator('strong')).toContainText('[ops] Todo en orden');
    await expect(recItem.locator('p')).toContainText('El restaurante funciona correctamente.');

    // 7. Botón de refresco interactivo en el DOM del panel
    const refreshBtn = panel.getByRole('button', { name: 'Actualizar' });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    await expect(recItem).toBeVisible();

    // 8. Confirmar que ninguna petición salió hacia la API en la nube
    expect(cloudRequestsCount).toBe(0);
  });
});
