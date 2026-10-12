import { defineMiddleware } from 'astro:middleware';
import { createStorageAdapter } from './lib/storageAdapter';
import { domainConfig } from './lib/domain.config';
import { resolveSession, type SessionUser } from './lib/auth/session';
import { isPublicPath, resolveTier, decideAccess } from './middlewareGating';
import { withNoTransform, isHtml } from './lib/noTransform';
import { CSP_HTML_FALLBACK, CSP_NONE } from './lib/csp';

// Nota sobre Content-Security-Policy (F12):
// La politica de verdad la genera Astro por pagina (`security.csp` en astro.config.mjs): cabecera en las
// rutas SSR y `<meta http-equiv>` en las prerenderizadas (que ademas reciben la cabecera por
// dist/client/_headers, ver scripts/gen-csp-headers.mjs). Aqui solo se cubre lo que no pasa por ahi
// (404/500 del framework y respuestas no-HTML) y NUNCA se pisa la cabecera que ya venga puesta.

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  const token = context.cookies.get('fize_session')?.value;
  const instanceId = context.url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

  let user: SessionUser | null = null;
  let tier = 'free';
  if (token) {
    try {
      const adapter = createStorageAdapter(context.locals);
      const session = await resolveSession(adapter, instanceId, token);
      user = session?.user ?? null;
      if (user) {
        const record = (await adapter.get('user', user.id, instanceId)) as Record<string, unknown> | null;
        tier = resolveTier(user, record);
      }
    } catch {
      user = null;
    }
  }

  context.locals.user = user;
  context.locals.tier = tier;
  context.locals.instanceId = instanceId;

  let response: Response;
  if (isPublicPath(path)) {
    // Las rutas de PUBLIC_PREFIXES se atienden tal cual. Ojo: esto se evalua
    // ANTES que decideAccess, asi que la lista debe contener solo lo que de
    // verdad es publico. /api/inventory y /api/tables NO pueden estar aqui:
    // devuelven costos de compra y QR de mesas.
    response = await next();
  } else {
    const decision = decideAccess(path, user, tier, context.request.method);
    if (decision.kind === 'redirect') {
      response = context.redirect(decision.to);
    } else if (decision.kind === 'deny') {
      response = new Response(JSON.stringify({ error: decision.error }), {
        status: decision.status,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      response = await next();
    }
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  response.headers.set('X-Frame-Options', 'DENY');
  if (!response.headers.has('Content-Security-Policy')) {
    // A typeless 404/500 (e.g. an endpoint without a handler for the method) is later
    // swapped by Astro for its HTML error page, which keeps this header.
    const type = response.headers.get('Content-Type');
    const emptyError = !type && (response.status === 404 || response.status === 500);
    response.headers.set('Content-Security-Policy', isHtml(type) || emptyError ? CSP_HTML_FALLBACK : CSP_NONE);
  }
  if (isHtml(response.headers.get('Content-Type'))) {
    response.headers.set('Cache-Control', withNoTransform(response.headers.get('Cache-Control')));
  }

  return response;
});
