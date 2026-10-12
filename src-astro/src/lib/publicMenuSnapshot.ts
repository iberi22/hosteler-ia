// Carta publicada (instantanea) — docs/producto/NODO-LOCAL.md §2.5.
//
// Un nodo local (sin cuenta en la nube) publica su carta firmada por `POST /api/public-menu/<slug>`.
// El Worker la vuelve a limpiar aqui (nunca confia en el equipo), la guarda en R2
// `public/menu/<slug>.json` y `/<slug>/menu` la lee primero, con la Cache API a 60 s para gastar
// lo minimo de R2 (clase B) y CPU. Si no hay instantanea, la carta sale como siempre de
// `loadMenuBySlug` (restaurantes en la nube sin cambios). 0 KV.
import {
  dedupeMenuItems,
  isPublicItem,
  normalizeSlug,
  sanitizePublicDescription,
  type PublicMenuCategory,
  type PublicMenuData,
  type PublicMenuItem,
} from './publicMenuBySlug';
import { validateSlug } from './restaurantRules';

// ---------------------------------------------------------------------------
// Limites de lo que se publica. El JSON ya viene acotado a 256 KB por el contrato;
// estos topes evitan cartas absurdas (y CPU de render) aunque quepan en 256 KB.
// ---------------------------------------------------------------------------
export const SNAPSHOT_LIMITS = {
  items: 500,
  categories: 100,
  id: 64,
  name: 120,
  description: 500,
  address: 200,
  phone: 32,
  maxPrice: 100_000_000,
} as const;

/** Segundos que una carta publicada (o su ausencia) queda en la Cache API del Worker. */
export const SNAPSHOT_CACHE_SECONDS = 60;

export function snapshotR2Key(slug: string): string {
  return `public/menu/${slug}.json`;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

// Caracteres de control fuera: la carta es texto para humanos, no lleva saltos ni escapes.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Texto limpio y recortado por puntos de codigo (no parte emojis por la mitad). */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join('').trim();
}

/** Solo lo que sirve para el enlace wa.me: digitos, `+`, espacios, guiones y parentesis. */
function cleanPhone(v: unknown): string {
  return cleanText(v, SNAPSHOT_LIMITS.phone).replace(/[^0-9+()\s-]/g, '').trim();
}

/**
 * Vuelve a aplicar en el Worker los filtros publicos de `loadMenuBySlug` sobre lo que mando el equipo:
 * fuera platos ocultos (`isPublic:false`) y no disponibles, descripciones con "receta/costo/..." fuera,
 * solo los campos de `PublicMenuData`, solo categorias usadas, topes de cantidad y de largo.
 * El slug de la carta es SIEMPRE el de la URL, no el que diga el JSON.
 */
export function sanitizePublicMenu(menu: unknown, slug: string): PublicMenuData {
  const m = isRec(menu) ? menu : {};
  const r = isRec(m.restaurant) ? m.restaurant : {};
  const rawItems = Array.isArray(m.items) ? m.items.filter(isRec) : [];
  const rawCategories = Array.isArray(m.categories) ? m.categories.filter(isRec) : [];

  const items: PublicMenuItem[] = [];
  for (const i of dedupeMenuItems(rawItems)) {
    if (items.length >= SNAPSHOT_LIMITS.items) break;
    if (!isPublicItem(i) || i.isAvailable === false) continue;
    const id = cleanText(i.id, SNAPSHOT_LIMITS.id);
    const name = cleanText(i.name, SNAPSHOT_LIMITS.name);
    const price = typeof i.price === 'number' ? i.price : Number.NaN;
    if (!id || !name || !Number.isFinite(price) || price < 0 || price > SNAPSHOT_LIMITS.maxPrice) continue;
    const description = sanitizePublicDescription(cleanText(i.description, SNAPSHOT_LIMITS.description));
    items.push({
      id,
      name,
      price,
      ...(description ? { description } : {}),
      categoryId: cleanText(i.categoryId, SNAPSHOT_LIMITS.id),
      isAvailable: true,
    });
  }

  const used = new Set(items.map((i) => i.categoryId));
  const seen = new Set<string>();
  const categories: PublicMenuCategory[] = [];
  for (const c of rawCategories) {
    if (categories.length >= SNAPSHOT_LIMITS.categories) break;
    const id = cleanText(c.id, SNAPSHOT_LIMITS.id);
    if (!id || !used.has(id) || seen.has(id)) continue;
    seen.add(id);
    const description = sanitizePublicDescription(cleanText(c.description, SNAPSHOT_LIMITS.description));
    categories.push({ id, name: cleanText(c.name, SNAPSHOT_LIMITS.name) || 'Carta', ...(description ? { description } : {}) });
  }

  const address = cleanText(r.address, SNAPSHOT_LIMITS.address);
  const phone = cleanPhone(r.phone);
  return {
    restaurant: {
      id: cleanText(r.id, SNAPSHOT_LIMITS.id) || slug,
      name: cleanText(r.name, SNAPSHOT_LIMITS.name) || "Fi'ze",
      slug,
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
    },
    categories,
    items,
  };
}

/** Lo que se guarda en R2: la carta ya limpia + la firma original y la huella para auditoria. */
export interface StoredPublicMenu {
  v: 1;
  slug: string;
  publishedAt: string;
  menu: PublicMenuData;
  audit: {
    /** Firma del equipo sobre la carta TAL COMO LLEGO (antes de la limpieza del servidor). */
    signature: string;
    pubkeyFp: string;
    receivedAt: string;
    signedBytes: number;
  };
}

// ---------------------------------------------------------------------------
// Lectura con Cache API
// ---------------------------------------------------------------------------

export interface R2Like {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

/**
 * Clave de cache por slug, en el mismo origen de la peticion (la Cache API es por zona).
 * Ojo: la cache es por centro de datos; `delete` al publicar solo limpia el centro que recibio la
 * publicacion. Los demas ven la carta nueva en <= 60 s.
 */
export function snapshotCacheKey(origin: string, slug: string): Request {
  return new Request(`${origin.replace(/\/$/, '')}/__fize/public-menu/${encodeURIComponent(slug)}.json`);
}

const MISSING_HEADER = 'X-Fize-Snapshot';

function looksLikeMenu(v: unknown): v is PublicMenuData {
  return (
    isRec(v) &&
    isRec(v.restaurant) &&
    typeof v.restaurant.name === 'string' &&
    Array.isArray(v.categories) &&
    Array.isArray(v.items)
  );
}

function parseStored(text: string, slug: string): PublicMenuData | null {
  try {
    const obj: unknown = JSON.parse(text);
    if (!isRec(obj) || obj.v !== 1 || obj.slug !== slug || !looksLikeMenu(obj.menu)) return null;
    return obj.menu;
  } catch {
    return null;
  }
}

/**
 * Carta publicada para `slug`, o null si no hay (o si algo falla: la pagina cae a `loadMenuBySlug`).
 * Por visita: 0 operaciones R2 si esta en cache; si no, 1 lectura clase B y se guarda 60 s
 * (tambien la AUSENCIA, para que las cartas en la nube no paguen una lectura R2 por visita).
 */
export async function readPublishedMenu(
  r2: R2Like | undefined,
  rawSlug: string,
  opts: { origin: string; cache?: CacheLike | null },
): Promise<PublicMenuData | null> {
  const slug = normalizeSlug(rawSlug);
  if (!r2 || validateSlug(slug)) return null;
  const cache = opts.cache ?? null;
  const key = snapshotCacheKey(opts.origin, slug);
  try {
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) {
      if (hit.headers.get(MISSING_HEADER) === 'none') return null;
      return parseStored(await hit.text(), slug);
    }
    const obj = await r2.get(snapshotR2Key(slug));
    const text = obj ? await obj.text() : null;
    if (cache) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${SNAPSHOT_CACHE_SECONDS}`,
      };
      if (text === null) headers[MISSING_HEADER] = 'none';
      await cache.put(key, new Response(text ?? '', { status: 200, headers })).catch(() => undefined);
    }
    return text === null ? null : parseStored(text, slug);
  } catch {
    return null;
  }
}

/** Lo que usa `/[slug]/menu`: primero la instantanea publicada, si no la carta de la nube. */
export async function loadMenuForPublicPage(args: {
  slug: string;
  r2: R2Like | undefined;
  origin: string;
  cache?: CacheLike | null;
  loadFromAdapter: () => Promise<PublicMenuData | null>;
}): Promise<{ menu: PublicMenuData; source: 'snapshot' | 'cloud' } | null> {
  const published = await readPublishedMenu(args.r2, args.slug, { origin: args.origin, cache: args.cache });
  if (published) return { menu: published, source: 'snapshot' };
  const menu = await args.loadFromAdapter();
  return menu ? { menu, source: 'cloud' } : null;
}

/**
 * `?mesa=N` del QR de la mesa. Solo letras, numeros y guion, maximo 8: va dentro del mensaje de
 * WhatsApp, asi que nada de espacios, saltos ni texto arbitrario. Invalido = sin mesa.
 */
export function sanitizeMesa(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  return /^[0-9A-Za-z-]{1,8}$/.test(s) ? s : '';
}
