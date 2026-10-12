import type { D1Like } from '../publicMenuPublish';

// rateLimit.ts — SWAL D1 / In-memory login rate limiter.
// Prevents brute-force attacks against authentication endpoints.
// Stores failed attempts by key `login:<identifier>` in D1 (auth_rate_limit) with a
// 60 s sliding window. Max 10 failed attempts before triggering 429 + Retry-After.
//
// Antes el contador vivia en KV (SWAL_KV): cada intento fallido era una escritura KV
// y la cuota gratuita de KV (1.000 escrituras/dia PARA TODA LA CUENTA de Cloudflare)
// se quemaba en login (16-22 % medido). D1 permite 100.000 filas/dia, asi que el
// contador pasa a una fila por llave en la D1 `fize-db` (migration 005).
//
// El slot se toma con UN statement (consume: UPSERT ... RETURNING), nunca
// read-modify-write: dos logins paralelos que leen 9 deben dejar 10, no 10 dos
// veces. Si D1 falla se FALLA CERRADO (429 + console.error): en Workers no hay
// fallback a memoria (la memoria es por isolate y un cold isolate arranca en 0).
// El store en memoria solo se usa donde cloudflare:workers no existe (Node/vitest).

export interface RateLimitResult {
  allowed: boolean;
  attempts: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  del?(key: string): Promise<void>;
  /** Toma un slot de forma atomica. Opcional: los stores sin el lo emulan con get/put. */
  consume?(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, { count: number; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return String(entry.count);
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const ttlSeconds = opts?.expirationTtl ?? 60;
    this.map.set(key, {
      count: Number(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  /** Toma el slot en una sola operacion sincrona: sin await entre leer y escribir. */
  async consume(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const entry = this.map.get(key);
    if (!entry || now >= entry.expiresAt) {
      this.map.set(key, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, attempts: 1, remaining: Math.max(0, maxAttempts - 1), retryAfterSeconds: 0 };
    }
    if (entry.count >= maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
      return { allowed: false, attempts: entry.count, remaining: 0, retryAfterSeconds };
    }
    entry.count += 1;
    entry.expiresAt = now + windowMs;
    return {
      allowed: true,
      attempts: entry.count,
      remaining: Math.max(0, maxAttempts - entry.count),
      retryAfterSeconds: 0,
    };
  }

  clear(): void {
    this.map.clear();
  }
}

const READ_SQL = 'SELECT count, window_start FROM auth_rate_limit WHERE key = ?1';

// Verificado en SQLite: la 10a llamada RETURNs 10 con changes()=1; la 11a no
// devuelve fila y changes()=0 (no escribe, window_start no cambia); en
// window_start + windowMs exactos la fila se reinicia a 1.
const CONSUME_SQL = `INSERT INTO auth_rate_limit (key, count, window_start)
VALUES (?1, 1, ?2)
ON CONFLICT(key) DO UPDATE SET
  count = CASE
    WHEN (?2 - auth_rate_limit.window_start) >= ?3 THEN 1
    ELSE auth_rate_limit.count + 1
  END,
  window_start = ?2
WHERE (?2 - auth_rate_limit.window_start) >= ?3
   OR auth_rate_limit.count < ?4
RETURNING count`;

// Barrido de filas expiradas: como maximo una vez por hora por isolate y
// acotado (LIMIT 10) para no gastar la cuota de escrituras de D1 de golpe.
const SWEEP_SQL = `DELETE FROM auth_rate_limit WHERE key IN (
  SELECT key FROM auth_rate_limit WHERE window_start < ?1 LIMIT 10
)`;

function denied(attempts: number, retryAfterSeconds: number): RateLimitResult {
  return { allowed: false, attempts, remaining: 0, retryAfterSeconds };
}

/**
 * Contador de intentos fallidos en D1 (tabla `auth_rate_limit`, migration 005).
 *
 * Ventana deslizante: cada consume fija window_start = ahora (igual que el TTL de
 * KV, que tambien se renovaba en cada put). La expiracion la aplica la propia
 * sentencia (now - window_start >= ventana => la fila se reinicia).
 *
 * Fail-closed: si D1 falla (tabla ausente o cuota agotada) consume() devuelve
 * denied y registra el error. En Workers NUNCA se degrada a memoria por isolate
 * (no es compartida, un cold isolate arranca en 0 y el limite desaparece). El
 * MemoryRateLimitStore se usa solo donde cloudflare:workers no existe.
 */
export class D1RateLimitStore implements RateLimitStore {
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(
    private readonly db: D1Like,
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare(READ_SQL)
      .bind(key)
      .first<{ count: number; window_start: number }>();
    if (!row) return null;
    if (this.now() - Number(row.window_start) >= 60_000) return null;
    return String(row.count);
  }

  /** Escritura absoluta (solo para tests/compat KV-shaped); NO la usa el login. */
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    void opts;
    await this.db
      .prepare(
        `INSERT INTO auth_rate_limit (key, count, window_start) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET count = ?2, window_start = ?3`,
      )
      .bind(key, Number(value), this.now())
      .run();
  }

  async del(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM auth_rate_limit WHERE key = ?1').bind(key).run();
  }

  async consume(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    const windowMs = windowSeconds * 1000;
    try {
      await this.sweep(now);
      // Via rapida: si la ventana sigue viva y el bucket ya esta lleno, negar
      // SIN escribir (no se gasta una escritura de D1 en un intento bloqueado).
      const existing = await this.db
        .prepare(READ_SQL)
        .bind(key)
        .first<{ count: number; window_start: number }>();
      if (
        existing &&
        now - Number(existing.window_start) < windowMs &&
        Number(existing.count) >= maxAttempts
      ) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((Number(existing.window_start) + windowMs - now) / 1000),
        );
        return denied(Number(existing.count), retryAfterSeconds);
      }
      const taken = await this.db
        .prepare(CONSUME_SQL)
        .bind(key, now, windowMs, maxAttempts)
        .first<{ count: number }>();
      if (!taken) {
        const again = await this.db
          .prepare(READ_SQL)
          .bind(key)
          .first<{ count: number; window_start: number }>();
        const start = again ? Number(again.window_start) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((start + windowMs - now) / 1000));
        return denied(again ? Number(again.count) : maxAttempts, retryAfterSeconds);
      }
      const attempts = Number(taken.count);
      return {
        allowed: true,
        attempts,
        remaining: Math.max(0, maxAttempts - attempts),
        retryAfterSeconds: 0,
      };
    } catch (err) {
      console.error('[auth/rateLimit] D1 consume failed; failing closed', err);
      return denied(maxAttempts, windowSeconds);
    }
  }

  private async sweep(now: number): Promise<void> {
    if (now - this.lastSweep < 60 * 60 * 1000) return;
    this.lastSweep = now;
    try {
      await this.db.prepare(SWEEP_SQL).bind(now - 120_000).run();
    } catch (err) {
      console.error('[auth/rateLimit] sweep failed', err);
    }
  }
}

const globalMemoryStore = new MemoryRateLimitStore();

/**
 * Resuelve el D1 real del runtime.
 *
 * NO usar `locals.runtime.env`: Astro v6 eliminó ese getter y ACCEDERLO
 * LANZA ("Astro.locals.runtime.env has been removed in Astro v6"), lo que
 * convertía /api/auth/login en un 500 en produccion. La via correcta es
 * `import { env } from 'cloudflare:workers'`, igual que storageAdapter.ts.
 * El import es dinamico con specifier en variable para que en Node/tests
 * (vitest, SSR de Node) falle y caiga al MemoryStore en vez de romper.
 */
async function resolveD1Store(): Promise<RateLimitStore | undefined> {
  try {
    // @vite-ignore: solo resoluble en runtime workerd; en Node/tests cae al catch
    const specifier = 'cloudflare:workers';
    const mod = await import(/* @vite-ignore */ specifier);
    const env = (mod as { env?: { SWAL_D1?: unknown } }).env;
    const db = env?.SWAL_D1 as D1Like | undefined;
    if (db && typeof (db as { prepare?: unknown }).prepare === 'function') {
      return new D1RateLimitStore(db);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

let d1Store: RateLimitStore | undefined | null = null; // null = aun no resuelto

/** RateLimitStore para la peticion en curso. Idempotente y barato. */
export async function getRateLimitStoreAsync(
  _locals?: Record<string, unknown> | App.Locals | unknown,
): Promise<RateLimitStore> {
  if (d1Store === null) {
    d1Store = (await resolveD1Store()) ?? undefined;
  }
  return d1Store ?? globalMemoryStore;
}

/**
 * Version sincrona. Se mantiene para no romper llamadores sync, pero sin acceso
 * a `locals.runtime.env`: devuelve el store en memoria. El limite por memoria
 * es por isolate de worker, suficiente para frenar fuerza bruta basica.
 * Para el limite compartido y persistente (D1) usar getRateLimitStoreAsync().
 */
export function getRateLimitStore(_locals?: Record<string, unknown> | App.Locals | unknown): RateLimitStore {
  return globalMemoryStore;
}

export async function checkRateLimit(
  identifier: string,
  store: RateLimitStore = globalMemoryStore,
  maxAttempts = 10,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  const key = loginKey(identifier);
  const raw = await store.get(key);
  const attempts = raw ? parseInt(raw, 10) : 0;

  if (attempts >= maxAttempts) {
    return {
      allowed: false,
      attempts,
      remaining: 0,
      retryAfterSeconds: windowSeconds,
    };
  }

  return {
    allowed: true,
    attempts,
    remaining: Math.max(0, maxAttempts - attempts),
    retryAfterSeconds: 0,
  };
}

export async function recordFailedAttempt(
  identifier: string,
  store: RateLimitStore = globalMemoryStore,
  windowSeconds = 60,
): Promise<number> {
  if (store.consume) {
    const slot = await store.consume(loginKey(identifier), 10, windowSeconds);
    return slot.attempts;
  }
  const key = loginKey(identifier);
  const raw = await store.get(key);
  const current = raw ? parseInt(raw, 10) : 0;
  const next = current + 1;
  await store.put(key, String(next), { expirationTtl: windowSeconds });
  return next;
}

export function loginKey(identifier: string): string {
  const id = identifier.trim().toLowerCase();
  if (id.length === 0 || id.length > 320) {
    throw new Error('rate-limit identifier length');
  }
  return `login:${id}`;
}

/**
 * Toma un slot de login (atomo si el store ofrece consume). Es lo que debe
 * llamar el endpoint: el slot se toma ANTES de verificar la password, asi que
 * cada peticion fallida cuenta exactamente una vez aunque lleguen en paralelo.
 */
export async function consumeLoginAttempt(
  identifier: string,
  store: RateLimitStore = globalMemoryStore,
  maxAttempts = 10,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  let key: string;
  try {
    key = loginKey(identifier);
  } catch {
    return denied(maxAttempts, windowSeconds);
  }
  if (store.consume) return store.consume(key, maxAttempts, windowSeconds);
  const current = await checkRateLimit(identifier, store, maxAttempts, windowSeconds);
  if (!current.allowed) return current;
  const attempts = await recordFailedAttempt(identifier, store, windowSeconds);
  return {
    allowed: attempts <= maxAttempts,
    attempts,
    remaining: Math.max(0, maxAttempts - attempts),
    retryAfterSeconds: 0,
  };
}

export async function resetRateLimit(
  identifier: string,
  store: RateLimitStore = globalMemoryStore,
): Promise<void> {
  const key = loginKey(identifier);
  if (store.del) {
    await store.del(key);
  } else {
    // Cloudflare KV RECHAZA expirationTtl < 60 ("Invalid expiration_ttl of 1.
    // Expiration TTL must be at least 60."). Con un TTL de 1 el reset lanzaba
    // y convertia un login correcto en HTTP 500. 60 es el minimo valido.
    await store.put(key, '0', { expirationTtl: 60 });
  }
}
