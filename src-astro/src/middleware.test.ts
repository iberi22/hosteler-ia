import { describe, it, expect } from 'vitest';
import { onRequest } from './middleware';
import { isPublicPath, resolveTier, decideAccess } from './middlewareGating';
import type { SessionUser } from './lib/auth/session';

const user: SessionUser = { id: 'u1', email: 'a@fize.app', name: 'A', role: 'owner' };

describe('middleware gating', () => {
  it('marks public paths (landing, auth, QR, restaurant card data)', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/api/auth/me')).toBe(true);
    expect(isPublicPath('/api/qr/abc')).toBe(true);
    // El nombre, la direccion y el telefono son los unicos datos que la carta
    // necesita sin sesion; el resto va gateado.
    expect(isPublicPath('/api/restaurants')).toBe(true);
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/api/ai/infer')).toBe(false);
  });

  // 2026-10-01: sin sesion, /api/menu-items devolvia la carta cruda con las
  // descripciones de produccion interna ("receta aplicada al inventario" x5) y
  // /api/categories filtraba instance_id + timestamps. La carta publica se
  // sirve por /{slug}/menu, que arma publicMenuBySlug.ts con el payload minimo.
  it('gatea la carta cruda: menu-items y categories exigen sesion', () => {
    expect(isPublicPath('/api/menu-items')).toBe(false);
    expect(isPublicPath('/api/categories')).toBe(false);
    expect(isPublicPath('/api/menu-items/m1')).toBe(false);
    expect(isPublicPath('/api/categories/c1')).toBe(false);
  });

  it('resolves tier, defaulting to free', () => {
    expect(resolveTier(null, null)).toBe('free');
    expect(resolveTier(user, null)).toBe('free');
    expect(resolveTier(user, { tier: 'socio' })).toBe('socio');
    expect(resolveTier(user, { tier: 'socio-managed' })).toBe('socio-managed');
    expect(resolveTier(user, { tier: 'enterprise' })).toBe('free');
  });

  it('gates /api/ai/* with 401/402', () => {
    expect(decideAccess('/api/ai/infer', null, 'free')).toMatchObject({ kind: 'deny', status: 401 });
    expect(decideAccess('/api/ai/infer', user, 'free')).toMatchObject({ kind: 'deny', status: 402 });
    expect(decideAccess('/api/ai/infer', user, 'socio')).toMatchObject({ kind: 'allow' });
    expect(decideAccess('/api/ai/infer', user, 'socio-managed')).toMatchObject({ kind: 'allow' });
  });

  it('redirects dashboard guests to /login, allows members', () => {
    expect(decideAccess('/dashboard/orders', null, 'free')).toMatchObject({ kind: 'redirect', to: '/login' });
    expect(decideAccess('/dashboard/orders', user, 'free')).toMatchObject({ kind: 'allow' });
  });

  it('cierra la API por defecto y deja pasar las paginas publicas', () => {
    // Antes este test afirmaba que /api/tables pasaba sin sesion, y eso era
    // exactamente el agujero: en produccion, GET /api/tables devolvia los QR de
    // las mesas y GET /api/inventory los costos de compra, sin autenticarse.
    // Las paginas publicas siguen abiertas; la API ya no.
    expect(decideAccess('/api/tables', null, 'free')).toMatchObject({ kind: 'deny', status: 401 });
    expect(decideAccess('/api/tables', user, 'free')).toMatchObject({ kind: 'allow' });
    expect(decideAccess('/menu/xyz', null, 'free')).toMatchObject({ kind: 'allow' });
  });

  it('sets security headers on all responses in onRequest', async () => {
    const context = {
      url: new URL('http://localhost/'),
      cookies: { get: () => undefined },
      locals: {},
      redirect: (to: string) => new Response(null, { status: 302, headers: { Location: to } }),
    };
    const next = async () => new Response('ok');
    const res = await (onRequest as any)(context, next);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=()');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

// F12 — CSP. Astro (security.csp) pone la cabecera en las paginas que renderiza, con los hashes de sus
// scripts/estilos inline. El middleware solo cubre lo que NO pasa por ahi: el 404/500 del framework
// (HTML sin cabecera) y lo que no es HTML (API, redirecciones), sin pisar nunca la de Astro.
describe('CSP de respaldo en el middleware', () => {
  function ctx(path = '/') {
    return {
      url: new URL(`http://localhost${path}`),
      cookies: { get: () => undefined },
      request: { method: 'GET' },
      locals: {},
      redirect: (to: string) => new Response(null, { status: 302, headers: { Location: to } }),
    };
  }

  it('cubre el HTML sin cabecera (404 del framework) sin abrir la puerta a scripts inline', async () => {
    const next = async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
    const res = await (onRequest as any)(ctx('/no-existe'), next);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    // `style-src` si lleva 'unsafe-inline' en el respaldo (la pagina de error de Astro trae su CSS inline),
    // pero `script-src` nunca: ni unsafe-inline ni unsafe-eval.
    const scriptSrc = csp.split(';').find((d: string) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc.trim()).toBe("script-src 'self'");
  });

  it('cierra del todo las respuestas que no son HTML (API, redirecciones)', async () => {
    const json = async () =>
      new Response(JSON.stringify({ error: 'no' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const res = await (onRequest as any)(ctx('/api/menu-items'), json);
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

    const redir = async () => new Response(null, { status: 302, headers: { Location: '/login' } });
    const resRedir = await (onRequest as any)(ctx('/dashboard'), redir);
    expect(resRedir.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  });

  it('un 404/500 sin tipo (metodo sin handler) recibe el respaldo HTML: Astro lo cambia por su pagina de error', async () => {
    for (const status of [404, 500]) {
      const empty = async () => new Response(null, { status });
      const res = await (onRequest as any)(ctx('/api/auth/login'), empty);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toMatch(/script-src 'self'(;|$)/);
    }
  });

  it('no pisa la cabecera que ya trae la pagina (la de Astro, con hashes)', async () => {
    const deAstro = "default-src 'self'; script-src 'self' 'sha256-abc='";
    const next = async () =>
      new Response('<html></html>', {
        headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': deAstro },
      });
    const res = await (onRequest as any)(ctx('/login'), next);
    expect(res.headers.get('Content-Security-Policy')).toBe(deAstro);
  });
});
