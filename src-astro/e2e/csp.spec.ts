import { test, expect, type Page } from '@playwright/test';

// F12 — CSP global.
//
// Dos caminos distintos, y los dos se afirman aqui:
//   - Rutas SSR (/login, /register, /pair, /dashboard/*): el Worker pone la cabecera `Content-Security-Policy`
//     (Astro `security.csp`, con el hash SHA-256 de cada script/estilo inline).
//   - Rutas prerenderizadas (/ , /local/*, /offline): no pasan por el Worker; su cabecera la genera
//     scripts/gen-csp-headers.mjs en dist/client/_headers (el mismo mecanismo que ya pone X-Frame-Options
//     en /local/*). Ademas llevan el <meta http-equiv="content-security-policy"> de Astro.
//
// Y una prueba de que no se rompe nada: sin violaciones de CSP en consola y con la isla hidratada
// (el runtime de hidratacion de Astro va INLINE: si el hash no cuadra, el navegador lo bloquea y la
// pagina se queda en HTML muerto).

const PRERENDERIZADAS = ['/', '/local/', '/offline/'];
const SSR = ['/login', '/register', '/pair'];

/**
 * Chromium registra en consola cualquier `content-security-policy`, incluido el aviso de que
 * `frame-ancestors` se ignora cuando el CSP llega por <meta> (las rutas prerenderizadas llevan el
 * <meta> de Astro ADEMAS de la cabecera de _headers). Lo que importa es una violacion de verdad.
 */
function esViolacionDeCsp(texto: string): boolean {
  return /violates the following Content Security Policy|Refused to (load|execute|apply|connect|frame|run)/i.test(texto);
}

async function cspDe(page: Page, ruta: string): Promise<string> {
  const res = await page.request.get(ruta);
  const csp = res.headers()['content-security-policy'];
  expect(csp, `sin cabecera Content-Security-Policy en ${ruta}`).toBeTruthy();
  return csp ?? '';
}

for (const ruta of [...PRERENDERIZADAS, ...SSR]) {
  test(`CSP presente y sin unsafe-inline en script-src: ${ruta}`, async ({ page }) => {
    const csp = await cspDe(page, ruta);
    const directivas = new Map(
      csp
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1).join(' ')] as const),
    );
    // Lo que pide F12: nada de objetos, nada de framing, base-uri cerrado.
    expect(directivas.get('frame-ancestors')).toBe("'none'");
    expect(directivas.get('object-src')).toBe("'none'");
    expect(directivas.get('base-uri')).toBe("'self'");
    // script-src: solo 'self' y hashes. Nada de unsafe-inline/unsafe-eval.
    const scriptSrc = directivas.get('script-src') ?? '';
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).toMatch(/'sha256-/);
    // connect-src enumerado (no comodin) y sin data: en scripts.
    const connectSrc = directivas.get('connect-src') ?? '';
    expect(connectSrc).not.toContain('*');
    expect(connectSrc).toContain("'self'");
  });
}

test('CSP: la landing prerenderizada ejecuta su script inline y su isla', async ({ page }) => {
  const violaciones: string[] = [];
  page.on('console', (m) => {
    if (esViolacionDeCsp(m.text())) violaciones.push(m.text());
  });

  // El script de prepaint del tema va inline: con el hash mal, no corre.
  await page.addInitScript(() => window.localStorage.setItem('swal-theme', 'light'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // El runtime de hidratacion de Astro tambien va inline: si el navegador lo bloquea, `astro-island`
  // no existe como custom element y las islas se quedan en HTML muerto (sin hidratar).
  expect(await page.evaluate(() => Boolean(window.customElements.get('astro-island')))).toBe(true);
  await expect(page.locator('astro-island').first()).not.toHaveAttribute('ssr', '');
  await expect(page.getByRole('link', { name: 'Empezar gratis, sin registrarme' }).first()).toBeVisible();

  expect(violaciones, `violaciones de CSP en /: ${violaciones.join(' | ')}`).toEqual([]);
});

test('CSP: /local/ prerenderizado no pierde estilo ni consola', async ({ page }) => {
  const violaciones: string[] = [];
  page.on('console', (m) => {
    if (esViolacionDeCsp(m.text())) violaciones.push(m.text());
  });
  await page.goto('/local/');
  await expect(page.getByRole('heading', { name: 'Fize ordena tu carta y tu local' })).toBeVisible();

  // El CSS del tema ya no viaja inline: se sirve como asset /_astro/*.css y `style-src 'self'` lo permite.
  const hojas = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => (l as HTMLLinkElement).href),
  );
  expect(hojas.length).toBeGreaterThan(0);
  for (const href of hojas) {
    const res = await page.request.get(href);
    expect(res.status(), `hoja de estilos bloqueada o ausente: ${href}`).toBe(200);
  }
  // El script inline del aviso de red corre (no lo bloquea el CSP).
  const banner = page.locator('#net-banner');
  await expect(banner).toBeHidden(); // online -> hidden
  expect(violaciones, `violaciones de CSP en /local/: ${violaciones.join(' | ')}`).toEqual([]);
});
