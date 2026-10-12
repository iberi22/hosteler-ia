// localApi.ts — la API de Fize ejecutandose en el navegador (docs/producto/NODO-LOCAL.md §2.2).
//
// En modo local `apiFetch` no sale a la red: llega aqui y se despacha a los MISMOS handlers de
// `src/pages/api/*` con `locals = { user: dueno local, storage: IndexedDB }`. Asi validaciones (zod), reglas
// (`restaurantRules.ts`, `recipes.ts`) y formas de respuesta son identicas en local y en la nube.
//
// `instance_id` se FUERZA a la instancia local (query y cuerpo JSON): una isla que pase el `instance_id` del
// demo (`domainConfig.instanceId`) no puede leer ni escribir fuera de los datos de este restaurante.
import type { APIContext, APIRoute } from 'astro';
import type { StorageAdapter } from '../domain';
import type { SessionUser } from '../auth/session';
import { getIdbAdapter } from '../idbAdapter';
import { LOCAL_OWNER } from './localMode';
import { loadIdentity } from './identity';

import * as restaurants from '../../pages/api/restaurants/index';
import * as restaurantById from '../../pages/api/restaurants/[id]';
import * as categories from '../../pages/api/categories/index';
import * as categoryById from '../../pages/api/categories/[id]';
import * as menuItems from '../../pages/api/menu-items/index';
import * as menuItemById from '../../pages/api/menu-items/[id]';
import * as inventory from '../../pages/api/inventory/index';

type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', APIRoute>>;

interface LocalRoute {
  pattern: RegExp;
  params: string[];
  mod: RouteModule;
}

const ROUTES: LocalRoute[] = [
  { pattern: /^\/api\/restaurants\/?$/, params: [], mod: restaurants },
  { pattern: /^\/api\/restaurants\/([^/]+)\/?$/, params: ['id'], mod: restaurantById },
  { pattern: /^\/api\/categories\/?$/, params: [], mod: categories },
  { pattern: /^\/api\/categories\/([^/]+)\/?$/, params: ['id'], mod: categoryById },
  { pattern: /^\/api\/menu-items\/?$/, params: [], mod: menuItems },
  { pattern: /^\/api\/menu-items\/([^/]+)\/?$/, params: ['id'], mod: menuItemById },
  // Solo para que el editor de platos liste insumos (vacio en el tramo 1); el inventario local llega en el tramo 2.
  { pattern: /^\/api\/inventory\/?$/, params: [], mod: inventory },
];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface LocalContext {
  instanceId: string;
  storage?: StorageAdapter;
  user?: SessionUser;
}

const BASE = 'http://fize.local';

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return new URL(input.href);
  if (typeof input === 'string') return new URL(input, typeof location !== 'undefined' ? location.origin : BASE);
  return new URL(input.url);
}

/** Respuesta local de `/api/auth/me`: el dueno del equipo, con el primer restaurante activo. */
async function localMe(storage: StorageAdapter, instanceId: string, user: SessionUser): Promise<Response> {
  const list = await storage.list('restaurant', instanceId);
  const first = list.find((r) => !(r as Record<string, unknown>).deleted_at) as Record<string, unknown> | undefined;
  return json({
    user,
    profile: {
      id: user.id,
      restaurant_id: first ? String(first.id) : null,
      role: user.role,
      restaurant: first ? { id: String(first.id), name: String(first.name ?? '') } : null,
    },
  });
}

/**
 * Cuerpo de una escritura con `instance_id` forzado. `Request.json()` (lo que usan los handlers) quita la BOM
 * UTF-8 antes de parsear: aqui se quita igual, para que una BOM no deje el cuerpo sin forzar. Solo se acepta
 * un objeto JSON: un arreglo, un valor suelto o algo que no es JSON se rechaza (null) en vez de pasar intacto.
 */
export function forceInstanceInBody(body: string, instanceId: string): string | null {
  const text = body.replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return JSON.stringify({ ...(parsed as Record<string, unknown>), instance_id: instanceId });
}

/** Despacha una peticion `/api/*` a los handlers locales. Testeable sin `location` ni identidad. */
export async function handleLocalRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ctx: LocalContext,
): Promise<Response> {
  const url = toUrl(input);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const storage = ctx.storage ?? getIdbAdapter();
  const user = ctx.user ?? LOCAL_OWNER;
  url.searchParams.set('instance_id', ctx.instanceId);

  if (/^\/api\/auth\/me\/?$/.test(url.pathname)) {
    if (method !== 'GET') return json({ error: 'Método no permitido' }, 405);
    return localMe(storage, ctx.instanceId, user);
  }

  for (const route of ROUTES) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const handler = route.mod[method as keyof RouteModule];
    if (!handler) return json({ error: 'Método no permitido' }, 405);

    const params: Record<string, string> = {};
    route.params.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });

    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = init.body ?? (input instanceof Request ? await input.text() : undefined);
      if (typeof raw === 'string' && raw.replace(/^\uFEFF/, '').trim() !== '') {
        const forced = forceInstanceInBody(raw, ctx.instanceId);
        if (forced === null) return json({ error: 'El cuerpo debe ser un objeto JSON' }, 400);
        body = forced;
      } else if (raw != null && typeof raw !== 'string') {
        return json({ error: 'Cuerpo no soportado en modo local' }, 400);
      }
    }

    // Peticion saneada: URL con la instancia forzada, cuerpo re-serializado y cabeceras sin longitud vieja.
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete('content-length');
    if (body !== undefined) headers.set('content-type', 'application/json');
    const request = new Request(url.href, { method, headers, body });
    const context = {
      request,
      url,
      params,
      locals: { user, storage, tier: 'free', instanceId: ctx.instanceId },
      cookies: { get: () => undefined, has: () => false, set: () => {}, delete: () => {} },
      redirect: (to: string, status = 302) => new Response(null, { status, headers: { Location: to } }),
      site: undefined,
      generator: 'fize-local',
      clientAddress: '127.0.0.1',
    } as unknown as APIContext;
    return handler(context);
  }

  return json({ error: 'Esta función todavía no está disponible en modo local.' }, 501);
}

/** `fetch` del modo local: usa la instancia de la identidad guardada en este equipo. */
export async function localFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const identity = await loadIdentity();
  if (!identity) {
    return json({ error: 'Primero configura tu local en este equipo (Fize → Empezar).' }, 409);
  }
  return handleLocalRequest(input, init, { instanceId: identity.instanceId });
}
