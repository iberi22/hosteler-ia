import { test, expect, type Page } from '@playwright/test';
import { staffCookie } from './staff-auth';

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
  test('local inventory: restock recommendation from the local IDB adapter, no cloud requests', async ({ page }) => {
    // Cualquier llamada a la IA en la nube se aborta y se cuenta (no hay carrera: se mira al final)
    let hits = 0;
    await page.route('**/api/ai/**', (r) => {
      hits++;
      return r.abort();
    });

    // 1. Onboarding para inicializar la identidad e IndexedDB con el restaurante
    await onboardLocal(page);

    // 2. Ir al inventario local
    await page.goto('/local/inventario/');
    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();

    // 3. Crear UN artículo con stock < 5 desde la UI local (InventoryManager -> localApi -> IDB)
    await page.getByLabel('Nombre *').fill('Tomates Frescos');
    await page.getByLabel('Unidad *').fill('kg');
    await page.getByLabel('Stock inicial').fill('2');
    await page.getByLabel('Stock mínimo').fill('10');
    await page.getByRole('button', { name: 'Crear Producto' }).click();
    await expect(page.getByText('Producto creado con éxito.')).toBeVisible();

    // 4. El panel de recomendaciones debe estar visible en el DOM
    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeVisible();

    // 5. Encabezado del panel
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('✨ Fi’ze recomienda');

    // 6. Refrescar: el panel debe leer el artículo recién creado desde el adapter local
    const refreshBtn = panel.getByRole('button', { name: 'Actualizar' });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // 7. Item de reposición generado por el motor de reglas con los datos del restaurante local.
    // Falla si instId='default', si el adapter es Memory (vacío) o si vuelve el fallback ('Todo en orden').
    const recItem = panel.locator('ul li').first();
    await expect(recItem.locator('strong')).toContainText('[restock] Reponer Tomates Frescos');
    await expect(recItem.locator('p')).toContainText('El stock actual es de 2.');
    await expect(panel.getByText('Todo en orden')).toBeHidden();

    // 8. Etiqueta del tier de IA local (sin navegador con Prompt API: reglas)
    const tierLine = page.getByTestId('ai-tier');
    await expect(tierLine).toHaveText('IA local: reglas del local');

    // 9. Esperar a que el panel termine de cargar antes de contar peticiones
    await expect(refreshBtn).toBeEnabled();
    await expect(panel.getByText('Analizando tu restaurante…')).toBeHidden();
    await page.waitForLoadState('networkidle');

    // 10. Ninguna petición salió hacia la API de IA en la nube
    expect(hits).toBe(0);
  });

  test('cloud dashboard: staff without local identity sees no panel and no identity is created', async ({ page, request, context, baseURL }) => {
    // 1. Autenticarse como staff (sesión de nube, sin nodo local en este contexto del navegador)
    const cookie = await staffCookie(request);
    await context.addCookies([{
      name: 'fize_session',
      value: cookie.slice(cookie.indexOf('=') + 1),
      url: baseURL ?? 'http://localhost:4331',
    }]);

    // 2. Visitar el inventario del dashboard en la nube
    await page.goto('/dashboard/inventory');
    await expect(page.locator('h1.page-title', { hasText: 'Inventario' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // 3. El panel de recomendaciones NO debe mostrarse sin identidad local
    const panel = page.locator('section[aria-label="Recomendaciones Fi\'ze"]');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('ai-tier')).toBeHidden();

    // 4. Tras la visita NO se creó identidad: /local/ sigue mostrando el botón 'Empezar'
    await page.goto('/local/');
    await expect(page.getByRole('button', { name: 'Empezar' })).toBeVisible();
  });
});
