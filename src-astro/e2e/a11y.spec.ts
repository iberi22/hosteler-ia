import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Public routes audited with axe on the full page (chrome included).
 *
 * ALCANCE / SCOPE (revisado 2026-10-27): este spec NO es cobertura de toda la app.
 *
 *  - Audited here: the 6 public routes below. None of them read a session, so
 *    axe sees the page a real user sees.
 *  - NOT audited here: the /dashboard/* tree. There are 13 route files under
 *    src/pages/dashboard (`find src/pages -path '*dashboard*' -name '*.astro'`),
 *    and all of them require `fize_session`: without a cookie they answer 302 -> /login (measured),
 *    so axe would audit the login screen again and the result would be read as
 *    "clean dashboard" without looking at a single panel.
 *    Two of them (/dashboard/menu, /dashboard/recipes) have partial coverage
 *    in e2e/a11y-dashboard-carta.spec.ts, which sets the staff cookie per test and
 *    limits axe to <main> (the shared chrome of those panels is still unaudited).
 *    Remaining gap: 11 panel routes + the panel chrome/shell.
 *    Follow-up: log in the E2E owner inside e2e/global-setup.ts and
 *    save the storageState so this spec can walk /dashboard/* with
 *    axe over the full page.
 *  - Also out of scope: parametrized routes (/menu/[restaurantId],
 *    /[slug]/menu, /table/[qrCode], /order-confirmation/[orderId]) that need
 *    seeded data (published restaurant, existing order).
 */
const PAGES = ['/', '/login', '/register', '/checkout', '/offline', '/pair'];

/**
 * Abre la ruta solo cuando el documento tiene de verdad sus hojas de estilo.
 *
 * Por que: medido 2026-10-27 contra `astro preview`, un servidor en frio (o uno
 * huerfano que retiene el puerto 4331) entrega el HTML pero aborta los CSS. En ese
 * estado axe no mide el producto: ve texto negro por defecto sobre el fondo oscuro
 * del fallback de tokens (`color-contrast` 1.03-1.09, `target-size` en botones sin
 * tamano) y saca "violaciones" que desaparecen en cuanto el CSS carga. Tambien
 * aparecen `page.goto: ERR_ABORTED / ERR_HTTP_RESPONSE_CODE_FAILURE` cuando workerd
 * se reinicia entre tests.
 *
 * Asi que: reintentar la navegacion si aborta, y no analizar hasta que haya al
 * menos dos hojas cargadas y un background real en <body>. Si tras los intentos
 * sigue sin CSS, el fallo dice eso — es del harness, no del producto.
 */
async function openStyled(page: Page, path: string): Promise<void> {
  // Default (30 s) is not enough for 3 attempts: raise per test.
  test.setTimeout(90_000);
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'load', timeout: 12_000 });
      await page.waitForFunction(
        () => {
          const bg = getComputedStyle(document.body).backgroundColor;
          const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
          // A real stylesheet (BaseLayout tokens) defines --swal-bg; the
          // unstyled fallback has no such variable. Checking a token is more
          // resilient than counting document.styleSheets.
          const token = getComputedStyle(document.documentElement)
            .getPropertyValue('--swal-bg')
            .trim();
          return token.length > 0 && !transparent;
        },
        undefined,
        { timeout: 6_000 }
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await page.waitForTimeout(700);
    }
  }
  throw new Error(
    `no se pudo cargar ${path} con estilos tras ${attempts} intentos ` +
      `(servidor de preview inestable o puerto ocupado, no necesariamente un fallo de la pagina): ` +
      `${(lastError as Error)?.message?.split('\n')[0] ?? lastError}`
  );
}

for (const path of PAGES) {
  test(`a11y WCAG 2.2 AA: ${path} has no violations`, async ({ page }) => {
    await openStyled(page, path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    // Resumen legible en el log: sin esto un fallo solo dice "array no vacio" y
    // el detalle (regla, impacto, nodos) queda enterrado en el JSON de axe.
    const summary = results.violations.map(
      (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.help}`
    );
    if (summary.length > 0) {
      console.log(`[a11y] ${path} -> ${summary.length} violacion(es)\n  ${summary.join('\n  ')}`);
    }
    expect(results.violations, `axe WCAG 2.2 AA violations on ${path}:\n${summary.join('\n')}`).toEqual([]);
  });
}


test.describe('Authenticated routes and Parametrized public routes', () => {
  test.use({ storageState: 'e2e/storageState.json' });

  const DASHBOARD_PAGES = [
    '/dashboard',
    '/dashboard/analytics',
    '/dashboard/client',
    '/dashboard/inventory',
    '/dashboard/kitchen',
    '/dashboard/menu',
    '/dashboard/notifications',
    '/dashboard/orders',
    '/dashboard/purchases',
    '/dashboard/recipes',
    '/dashboard/settings',
    '/dashboard/tables',
    '/dashboard/tables/print'
  ];

  for (const path of DASHBOARD_PAGES) {
    test(`a11y WCAG 2.2 AA: ${path} has no violations`, async ({ page }) => {
      await openStyled(page, path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();

      const summary = results.violations.map(
        (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.help}`
      );
      if (summary.length > 0) {
        console.log(`[a11y] ${path} -> ${summary.length} violacion(es)\n  ${summary.join('\n  ')}`);
      }

      expect(results.violations, `axe WCAG 2.2 AA violations on ${path}:\n${summary.join('\n')}`).toEqual([]);
    });
  }

  test('a11y WCAG 2.2 AA: parametrized public routes have no violations', async ({ page, request }) => {
    // 1. Fetch required IDs from API
    const restaurantsRes = await request.get('/api/restaurants');
    const restaurants = await restaurantsRes.json();
    const restaurantId = restaurants[0].id;
    const slug = restaurants[0].slug;

    const tablesRes = await request.get('/api/tables');
    const tables = await tablesRes.json();
    const tableId = tables[0].id;

    // table QR code can be derived or fetched. The route is /table/[qrCode]
    // The qr code format is usually tableId or table code? Wait, qrCode is usually generated or its ID
    const qrCode = tables[0].qrCode;

    const ordersRes = await request.get('/api/orders');
    const orders = await ordersRes.json();
    const orderId = orders[0].id;

    const PARAM_PAGES = [
      `/menu/${restaurantId}`,
      `/${slug}/menu`,
      `/table/${qrCode}`,
      `/order-confirmation/${orderId}`
    ];

    for (const path of PARAM_PAGES) {
      await openStyled(page, path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();

      const summary = results.violations.map(
        (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.help}`
      );
      if (summary.length > 0) {
        console.log(`[a11y] ${path} -> ${summary.length} violacion(es)\n  ${summary.join('\n  ')}`);
      }

      expect(results.violations, `axe WCAG 2.2 AA violations on ${path}:\n${summary.join('\n')}`).toEqual([]);
    }
  });
});
