// publish.ts — publicar la carta desde el nodo local (docs/producto/NODO-LOCAL.md §2.5, opcion A).
//
// El equipo arma la carta publica con `loadMenuBySlug` sobre su IndexedDB (mismos filtros que la nube),
// la firma con la llave del restaurante (`buildPublishRequest`, contrato compartido con el Worker) y la
// envia a `POST /api/public-menu/<slug>`. El endpoint es del frente 2: mientras no exista (404/501/405),
// se informa "publicacion aun no disponible" sin romper nada.
import type { DomainRecord, StorageAdapter } from '../domain';
import { getIdbAdapter } from '../idbAdapter';
import { loadMenuBySlug, type PublicMenuData } from '../publicMenuBySlug';
import { MAX_SNAPSHOT_BYTES, buildPublishRequest, canonicalJson } from '../publicMenuSignature';
import { importSigningKey, loadIdentity } from './identity';
import { patchSettings } from './localDb';
import { publicMenuUrl } from './localMode';

export type PublishFailure =
  | 'sin-local'
  | 'sin-platos'
  | 'tamano'
  | 'no-disponible'
  | 'sin-red'
  | 'codigo'
  | 'firma'
  | 'slug'
  | 'limite'
  | 'antigua'
  | 'error';

export type PublishResult =
  | { ok: true; url: string; slug: string; publishedAt: string }
  | { ok: false; reason: PublishFailure; message: string };

const MESSAGES: Record<PublishFailure, string> = {
  'sin-local': 'Primero completa los datos de tu local.',
  'sin-platos': 'Tu carta no tiene platos visibles con precio. Agrega al menos uno antes de publicar.',
  tamano: 'Tu carta es demasiado grande para publicarse (máximo 256 KB). Acorta descripciones o quita platos.',
  'no-disponible':
    'La publicación todavía no está disponible. Tu carta queda guardada en este equipo y podrás publicarla desde “Publicar” en cuanto se active.',
  'sin-red': 'No hay conexión a internet. Tu carta sigue guardada en este equipo; publícala cuando vuelva la red.',
  codigo: 'El código de activación no es válido. Revísalo o pídele uno nuevo a SWAL.',
  firma: 'Ese enlace ya está registrado con la llave de otro equipo. Publica desde el equipo con el que lo activaste o restaura su copia.',
  slug: 'Ese enlace ya lo usa otro restaurante. Cambia el enlace de tu carta en “Mi local”.',
  limite: 'Llegaste al límite de publicaciones de hoy. Vuelve a intentarlo mañana.',
  antigua: 'Ya hay publicada una versión más reciente de esta carta. Revisa la fecha y la hora de este equipo.',
  error: 'No se pudo publicar la carta. Inténtalo de nuevo en unos minutos.',
};

function fail(reason: PublishFailure, detail?: string): PublishResult {
  return { ok: false, reason, message: detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason] };
}

/**
 * Lector que oculta lo borrado (soft delete): `loadMenuBySlug` no mira `deleted_at`, y un plato o categoria
 * eliminados en el editor no deben salir en la carta publica. Un plato cuya categoria ya no existe tampoco.
 */
function withoutDeleted(storage: StorageAdapter) {
  return {
    async list(entity: string, instanceId: string): Promise<Array<Record<string, unknown>>> {
      const alive = (await storage.list(entity, instanceId)).filter((r) => !(r as Record<string, unknown>).deleted_at);
      if (entity !== 'menuItem') return alive as DomainRecord[];
      const cats = new Set(
        (await storage.list('category', instanceId))
          .filter((c) => !(c as Record<string, unknown>).deleted_at)
          .map((c) => c.id),
      );
      return alive.filter((i) => cats.has(String((i as Record<string, unknown>).categoryId ?? '')));
    },
  };
}

/** La carta publica tal como se publicaria, o null si aun no hay local. */
export async function buildLocalPublicMenu(storage: StorageAdapter = getIdbAdapter()): Promise<PublicMenuData | null> {
  const identity = await loadIdentity();
  if (!identity) return null;
  const restaurants = (await storage.list('restaurant', identity.instanceId)).filter(
    (r) => !(r as Record<string, unknown>).deleted_at,
  );
  const slug = String((restaurants[0] as Record<string, unknown> | undefined)?.slug ?? '');
  if (!slug) return null;
  const menu = await loadMenuBySlug(withoutDeleted(storage), identity.instanceId, slug);
  if (!menu) return null;
  // Un plato sin precio no sale en la carta publica (ONBOARDING.md §3, paso 3).
  return { ...menu, items: menu.items.filter((i) => Number.isFinite(i.price) && i.price > 0) };
}

export interface PublishOptions {
  activationCode?: string;
  fetchFn?: typeof fetch;
  storage?: StorageAdapter;
}

export async function publishMenu(opts: PublishOptions = {}): Promise<PublishResult> {
  const identity = await loadIdentity();
  if (!identity) return fail('sin-local');
  const menu = await buildLocalPublicMenu(opts.storage);
  if (!menu) return fail('sin-local');
  if (menu.items.length === 0) return fail('sin-platos');

  const code = opts.activationCode?.trim() || undefined;
  const request = await buildPublishRequest(
    menu,
    { privateKey: await importSigningKey(identity), publicKey: identity.publicJwk },
    code,
  );
  if (new TextEncoder().encode(canonicalJson(request.snapshot)).byteLength > MAX_SNAPSHOT_BYTES) return fail('tamano');

  const slug = menu.restaurant.slug;
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)(`/api/public-menu/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    return fail('sin-red');
  }

  if (res.ok) {
    await patchSettings({ lastPublishedAt: request.snapshot.publishedAt, publishedSlug: slug });
    return { ok: true, url: publicMenuUrl(slug), slug, publishedAt: request.snapshot.publishedAt };
  }
  let detail = '';
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') detail = body.error;
  } catch {
    /* sin cuerpo JSON */
  }
  // Codigos y textos de `src/lib/publicMenuPublish.ts` (el endpoint real): 400 formato/slug/fecha, 401 firma,
  // 403 codigo de activacion u otro dueno del enlace, 409 version mas antigua, 413 tamano, 429 limite diario.
  switch (res.status) {
    case 404:
    case 405:
    case 501:
      return fail('no-disponible');
    case 400:
      return fail('error', detail || `HTTP ${res.status}`);
    case 401:
      // 'Authentication required' = el middleware aun no abre la ruta (despliegue sin publicacion).
      return /authentication required/i.test(detail) ? fail('no-disponible') : fail('error', detail || 'firma no válida');
    case 403:
      return /otro restaurante|another|owner/i.test(detail) ? fail('firma') : fail('codigo');
    case 409:
      return fail('antigua');
    case 413:
      return fail('tamano');
    case 429:
      return fail('limite');
    default:
      return fail('error', `HTTP ${res.status}`);
  }
}
