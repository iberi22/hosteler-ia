// apiContext.ts — contexto APIContext tipado para los tests de handlers de `src/pages/api/*`.
//
// Los handlers leen `request`, `params`, `locals` y, en las rutas de auth, `cookies`. El resto de la
// interfaz (`cache`, `logger`, `csp`, `callAction`, `session`, ...) no lo tocan los endpoints y se rellena
// aqui con no-ops tipados, de modo que los tests no necesitan castings inseguros.
//
// Unica excepcion: `cookies`. `AstroCookies` es una clase nominal (campo privado `#private`) y el paquete
// `astro` solo la exporta como TIPO, no como valor, asi que no se puede instanciar desde un test (tampoco
// se puede importar su ruta interna: no esta en el `exports` del paquete). Se construye un doble
// estructural con la misma superficie publica y se afirma UNA vez al tipo de la interfaz. Sin `any`.
import type { APIContext } from 'astro';
import type { SessionUser } from '../auth/session';
import { domainConfig } from '../domain.config';

export interface ApiContextInput {
  request: Request;
  params?: Record<string, string>;
  user?: SessionUser | null;
  instanceId?: string;
  tier?: string;
  /** Cookies visibles por `cookies.get`, como en un Request real. */
  cookies?: Record<string, string>;
}

// `App.Locals` la extiende `@astrojs/cloudflare` con `cfContext`, el runtime del Worker. Los handlers
// unitarios no lo usan; se rellena con un doble minimo afirmado a `App.Locals['cfContext']` (interface
// estructural con `exports`/`tracing` que aqui no se necesitan).
function cfContextDouble(): App.Locals['cfContext'] {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    abort: () => {},
  } as App.Locals['cfContext'];
}

function cookieDouble(initial: Record<string, string>): APIContext['cookies'] {
  const store = new Map(Object.entries(initial));
  const lines = function* (): Generator<string, void, unknown> {
    for (const [key, value] of store) yield `${key}=${value}`;
  };
  return {
    get: (key: string) => {
      const value = store.get(key);
      if (value === undefined) return undefined;
      return {
        value,
        json: () => JSON.parse(value) as Record<string, unknown>,
        number: () => Number(value),
        boolean: () => value === 'true',
      };
    },
    has: (key: string) => store.has(key),
    set: (key: string, value: string | number | boolean | Record<string, unknown>) => {
      store.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    },
    delete: (key: string) => {
      store.delete(key);
    },
    headers: lines,
    merge: (_cookies: APIContext['cookies']) => {},
    consume: lines,
  } as APIContext['cookies'];
}

/** Construye un `APIContext` minimo pero tipado para invocar un handler directamente. */
export function apiContext(input: ApiContextInput): APIContext {
  const request = input.request;
  const url = new URL(request.url);
  return {
    request,
    url,
    originPathname: url.pathname,
    params: input.params ?? {},
    props: {},
    locals: {
      user: input.user ?? null,
      instanceId: input.instanceId ?? domainConfig.instanceId ?? 'default',
      tier: input.tier ?? 'free',
      cfContext: cfContextDouble(),
    },
    cookies: cookieDouble(input.cookies ?? {}),
    site: undefined,
    generator: 'Astro test context',
    clientAddress: '127.0.0.1',
    session: undefined,
    cache: { enabled: false, set: () => {}, tags: [], options: {}, invalidate: async () => {} },
    getActionResult: () => {
      throw new Error('getActionResult no esta disponible en tests');
    },
    callAction: async () => {
      throw new Error('callAction no esta disponible en tests');
    },
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
    rewrite: async () => new Response(null, { status: 200 }),
    preferredLocale: undefined,
    preferredLocaleList: undefined,
    currentLocale: undefined,
    isPrerendered: false,
    csp: undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    routePattern: url.pathname,
  };
}

/** Request JSON de conveniencia para los tests. */
export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
