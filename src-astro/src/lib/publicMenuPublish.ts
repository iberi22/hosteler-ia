// POST /api/public-menu/<slug> — publicar la carta de un nodo local sin cuenta (NODO-LOCAL.md §2.5).
//
// Reglas (Decision 2, aceptada por Bel):
//  - La primera publicacion de un slug exige un codigo de activacion que entrega SWAL (en D1 solo su
//    SHA-256). Ese primer envio registra la llave publica del restaurante para el slug.
//  - Las siguientes solo necesitan una firma valida de ESA llave. Otra llave = 403.
//  - 256 KB por carta y 30 publicaciones por dia (UTC) por slug.
//
// Costo Cloudflare por publicacion: 1 lectura D1 + 1 escritura de fila (2 la primera vez: el codigo y el
// registro) + 1 escritura R2 (clase A) + 1 `cache.delete` (gratis). 0 KV.
//
// Toda la logica vive aqui (testeable con D1/R2 falsos); la ruta Astro solo entrega el env.
import { z } from 'zod';
import { validateSlug } from './restaurantRules';
import {
  MAX_SNAPSHOT_BYTES,
  publicJwk,
  publicKeyFingerprint,
  snapshotBytes,
  verifySnapshot,
  type PublicMenuSnapshot,
} from './publicMenuSignature';
import {
  sanitizePublicMenu,
  snapshotCacheKey,
  snapshotR2Key,
  type CacheLike,
  type R2Like,
  type StoredPublicMenu,
} from './publicMenuSnapshot';

export const MAX_PUBLISHES_PER_DAY = 30;
/** El cuerpo trae la carta (<= 256 KB canonica) + llave y firma; margen para eso y nada mas. */
export const MAX_BODY_BYTES = MAX_SNAPSHOT_BYTES + 16 * 1024;
/** Tolerancia al reloj adelantado del equipo. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
}

export interface PublishEnv {
  SWAL_D1?: D1Like;
  SWAL_R2?: R2Like;
}

export interface PublishDeps {
  env: PublishEnv | undefined;
  /** Origen de la peticion: la clave de la Cache API va en la misma zona. */
  origin: string;
  cache?: CacheLike | null;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Codigo de activacion: FZ-XXXX-XXXX en base32 de Crockford (40 bits).
// `scripts/activation-code.mjs` usa EXACTAMENTE esta normalizacion (hay test que lo amarra).
// ---------------------------------------------------------------------------

const CROCKFORD_BODY = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Forma canonica `FZ-XXXX-XXXX`, tolerante a minusculas, espacios, guiones y O/I/L; null si no es un codigo. */
export function normalizeActivationCode(raw: string): string | null {
  let s = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 10 && s.startsWith('FZ')) s = s.slice(2);
  if (s.length !== 8) return null;
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!CROCKFORD_BODY.test(s)) return null;
  return `FZ-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** SHA-256 en hex del codigo canonico: es lo unico que se guarda en D1. */
export async function hashActivationCode(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Forma del cuerpo. La firma se verifica sobre el JSON CRUDO (zod quita claves y cambiaria los bytes);
// zod solo decide si la forma sirve. Los campos de cada plato se limpian despues en sanitizePublicMenu.
// ---------------------------------------------------------------------------

const looseRecord = z.looseObject({});
const requestSchema = z.object({
  snapshot: z.looseObject({
    v: z.literal(1),
    slug: z.string().max(100),
    publishedAt: z.iso.datetime({ offset: true }),
    menu: z.looseObject({
      restaurant: z.looseObject({ name: z.string().max(1000) }),
      categories: z.array(looseRecord).max(2000),
      items: z.array(z.looseObject({ id: z.string(), name: z.string(), price: z.number() })).max(5000),
    }),
  }),
  publicKey: z.looseObject({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().min(1).max(64),
    y: z.string().min(1).max(64),
  }),
  signature: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),
  activationCode: z.string().max(64).optional(),
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

export const MESSAGES = {
  badJson: 'El cuerpo de la petición no es JSON válido.',
  badShape: 'La carta no tiene el formato esperado.',
  slugMismatch: 'La carta es de otro enlace: el slug no coincide con la dirección.',
  tooBig: 'La carta pesa más de 256 KB. Acorta descripciones o quita platos e intenta de nuevo.',
  badSignature: 'La firma de la carta no es válida.',
  futureDate: 'La fecha de la carta está adelantada. Revisa la fecha y la hora del equipo.',
  needsCode: 'Para publicar este enlace por primera vez necesitas el código de activación que entrega SWAL.',
  badCode: 'El código de activación no es válido, ya se usó o es para otro enlace.',
  otherOwner: 'Este enlace ya pertenece a otro restaurante.',
  older: 'Ya hay una versión más reciente de esta carta publicada.',
  rateLimited: `Llegaste al límite de ${MAX_PUBLISHES_PER_DAY} publicaciones de hoy. Intenta de nuevo mañana.`,
  unavailable: 'La publicación de cartas no está disponible en este momento.',
  internal: 'No pudimos publicar la carta. Intenta de nuevo en un momento.',
} as const;

/** Lee el cuerpo sin pasar de `max` bytes (no se carga en memoria un cuerpo gigante). */
async function readBodyCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

interface PublicMenuRow {
  slug: string;
  pubkey_fp: string;
  published_at: string | null;
  publish_day: string | null;
  publish_count: number | null;
}

export async function handlePublishRequest(
  request: Request,
  slugParam: string | undefined,
  deps: PublishDeps,
): Promise<Response> {
  const slug = String(slugParam ?? '');
  const slugError = validateSlug(slug);
  if (slugError || slug !== slug.trim()) return fail(400, slugError ?? MESSAGES.slugMismatch);

  const db = deps.env?.SWAL_D1;
  const r2 = deps.env?.SWAL_R2;
  if (!db || !r2) return fail(503, MESSAGES.unavailable);

  try {
    const text = await readBodyCapped(request, MAX_BODY_BYTES);
    if (text === null) return fail(413, MESSAGES.tooBig);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail(400, MESSAGES.badJson);
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, MESSAGES.badShape, {
        details: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;
    // La firma cubre el snapshot tal como lo armo el equipo: se verifica sobre el objeto crudo.
    const snapshot = (raw as { snapshot: PublicMenuSnapshot }).snapshot;
    if (body.snapshot.slug !== slug) return fail(400, MESSAGES.slugMismatch);

    const signedBytes = snapshotBytes(snapshot);
    if (signedBytes > MAX_SNAPSHOT_BYTES) return fail(413, MESSAGES.tooBig);

    const jwk = publicJwk(body.publicKey);
    if (!(await verifySnapshot(snapshot, body.signature, jwk))) return fail(401, MESSAGES.badSignature);

    const now = (deps.now ?? (() => new Date()))();
    const publishedMs = Date.parse(body.snapshot.publishedAt);
    if (publishedMs > now.getTime() + MAX_CLOCK_SKEW_MS) return fail(400, MESSAGES.futureDate);
    const publishedAt = new Date(publishedMs).toISOString();
    const nowIso = now.toISOString();
    const day = nowIso.slice(0, 10);
    const fp = await publicKeyFingerprint(jwk);

    const menu = sanitizePublicMenu(body.snapshot.menu, slug);
    const stored: StoredPublicMenu = {
      v: 1,
      slug,
      publishedAt,
      menu,
      audit: { signature: body.signature, pubkeyFp: fp, receivedAt: nowIso, signedBytes },
    };
    const storedJson = JSON.stringify(stored);
    const storedBytes = new TextEncoder().encode(storedJson).byteLength;
    const r2Key = snapshotR2Key(slug);

    const row = await db
      .prepare('SELECT slug, pubkey_fp, published_at, publish_day, publish_count FROM public_menu WHERE slug = ?')
      .bind(slug)
      .first<PublicMenuRow>();

    if (!row) {
      // Primera publicacion: el codigo se consume y la llave queda registrada para el slug.
      if (!body.activationCode) return fail(403, MESSAGES.needsCode);
      const code = normalizeActivationCode(body.activationCode);
      if (!code) return fail(403, MESSAGES.badCode);
      const codeHash = await hashActivationCode(code);
      const claimed = await db
        .prepare(
          'UPDATE public_menu_activation SET used_at = ?, used_by_fp = ? ' +
            'WHERE code_hash = ? AND used_at IS NULL AND (slug IS NULL OR slug = ?)',
        )
        .bind(nowIso, fp, codeHash, slug)
        .run();
      if ((claimed.meta?.changes ?? 0) !== 1) return fail(403, MESSAGES.badCode);
      const inserted = await db
        .prepare(
          'INSERT INTO public_menu (slug, pubkey_fp, pubkey_jwk, r2_key, bytes, published_at, created_at, updated_at, publish_day, publish_count) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(slug) DO NOTHING',
        )
        .bind(slug, fp, JSON.stringify(jwk), r2Key, storedBytes, publishedAt, nowIso, nowIso, day)
        .run();
      // Otro equipo gano la carrera por el mismo slug entre la lectura y este INSERT.
      if ((inserted.meta?.changes ?? 0) !== 1) return fail(403, MESSAGES.otherOwner);
    } else {
      if (row.pubkey_fp !== fp) return fail(403, MESSAGES.otherOwner);
      // Una carta firmada vieja no puede pisar a una nueva (reenviar la misma si: reintento idempotente).
      if (row.published_at && publishedAt < row.published_at) return fail(409, MESSAGES.older);
      const usedToday = row.publish_day === day ? Number(row.publish_count ?? 0) : 0;
      if (usedToday >= MAX_PUBLISHES_PER_DAY) return fail(429, MESSAGES.rateLimited);
      // Una sola escritura: cuenta + metadatos, con el tope y la llave como guardas (carreras incluidas).
      const updated = await db
        .prepare(
          'UPDATE public_menu SET ' +
            'publish_count = CASE WHEN publish_day = ? THEN publish_count + 1 ELSE 1 END, publish_day = ?, ' +
            'r2_key = ?, bytes = ?, published_at = ?, updated_at = ? ' +
            'WHERE slug = ? AND pubkey_fp = ? AND (publish_day IS NOT ? OR publish_count < ?) ' +
            'AND (published_at IS NULL OR published_at <= ?)',
        )
        .bind(day, day, r2Key, storedBytes, publishedAt, nowIso, slug, fp, day, MAX_PUBLISHES_PER_DAY, publishedAt)
        .run();
      if ((updated.meta?.changes ?? 0) !== 1) return fail(429, MESSAGES.rateLimited);
    }

    await r2.put(r2Key, storedJson, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    const cache = deps.cache ?? null;
    if (cache) await cache.delete(snapshotCacheKey(deps.origin, slug)).catch(() => false);

    return json(200, {
      ok: true,
      slug,
      url: `/${slug}/menu`,
      publishedAt,
      items: menu.items.length,
      categories: menu.categories.length,
    });
  } catch (err) {
    console.error('[public-menu] publicacion fallida:', err instanceof Error ? err.name : 'desconocido');
    return fail(500, MESSAGES.internal);
  }
}
