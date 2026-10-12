import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryRateLimitStore,
  D1RateLimitStore,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  consumeLoginAttempt,
  type RateLimitStore,
} from './rateLimit';
import type { D1Like } from '../publicMenuPublish';

// Regresion de produccion: un login CORRECTO devolvia HTTP 500 porque
// resetRateLimit escribia con expirationTtl: 1 y Cloudflare KV exige >= 60
// ("Invalid expiration_ttl of 1. Expiration TTL must be at least 60.").
// Estos tests fijan ese contrato para que nadie lo revierta.

/** Store que imita las restricciones de Cloudflare KV. */
class FakeKvStore implements RateLimitStore {
  data = new Map<string, string>();
  putCalls: Array<{ key: string; ttl?: number }> = [];

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const ttl = opts?.expirationTtl;
    this.putCalls.push({ key, ttl });
    if (ttl !== undefined && ttl < 60) {
      throw new Error(`Invalid expiration_ttl of ${ttl}. Expiration TTL must be at least 60.`);
    }
    this.data.set(key, value);
  }
}

describe('resetRateLimit', () => {
  let store: FakeKvStore;

  beforeEach(() => {
    store = new FakeKvStore();
  });

  it('usa expirationTtl >= 60 (minimo de Cloudflare KV)', async () => {
    await resetRateLimit('user@test.com', store);
    expect(store.putCalls).toHaveLength(1);
    expect(store.putCalls[0].ttl).toBeGreaterThanOrEqual(60);
  });

  it('no lanza cuando el store no tiene del()', async () => {
    // El caso que rompia produccion: FakeKvStore sin del()
    await expect(resetRateLimit('user@test.com', store)).resolves.toBeUndefined();
  });

  it('deja el contador en 0 tras un login correcto', async () => {
    await recordFailedAttempt('user@test.com', store);
    await resetRateLimit('user@test.com', store);
    const after = await checkRateLimit('user@test.com', store);
    expect(after.attempts).toBe(0);
    expect(after.allowed).toBe(true);
  });

  it('usa del() cuando el store lo ofrece', async () => {
    const calls: string[] = [];
    const withDel: RateLimitStore = {
      get: async () => null,
      put: async () => {
        throw new Error('put no debe llamarse si existe del()');
      },
      del: async (k: string) => {
        calls.push(k);
      },
    };
    await resetRateLimit('user@test.com', withDel);
    expect(calls).toEqual(['login:user@test.com']);
  });
});

// ---------------------------------------------------------------------------
// Contador en D1 (sustituye a KV: 1000 escrituras/dia para TODA la cuenta →
// 100.000 filas/dia). Misma API publica: D1RateLimitStore implementa RateLimitStore.
// ---------------------------------------------------------------------------

/**
 * D1 falso: ejecuta las sentencias de rateLimit.ts con la MISMA semantica que
 * SQLite (verificada sobre sqlite3 real):
 *  - CONSUME_SQL (UPSERT ... RETURNING) se aplica encadenado (`pending = pending.then`),
 *    como serializa D1 las escrituras: dos consume solapados en 9 dejan 10, no 10 dos veces;
 *  - cuando el bucket esta lleno el WHERE del DO UPDATE no deja escribir:
 *    changes 0 y sin fila devuelta (RETURNING solo devuelve lo que escribe).
 */
function fakeD1() {
  const rows = new Map<string, { count: number; window_start: number }>();
  const statements: string[] = [];
  /** Una entrada por CONSUME_SQL ejecutado: { key, returned (null = denegado), changes }. */
  const consumeLog: Array<{ key: string; returned: number | null; changes: number }> = [];
  let pending: Promise<void> = Promise.resolve();

  const applyConsume = (key: string, now: number, windowMs: number, maxAttempts: number) => {
    const row = rows.get(key);
    if (!row) {
      rows.set(key, { count: 1, window_start: now });
      return { returned: 1, changes: 1 };
    }
    if (now - row.window_start >= windowMs) {
      // ventana expirada: la fila se reinicia a 1
      row.count = 1;
      row.window_start = now;
      return { returned: 1, changes: 1 };
    }
    if (row.count < maxAttempts) {
      row.count += 1;
      row.window_start = now;
      return { returned: row.count, changes: 1 };
    }
    // bucket lleno: ON CONFLICT ... DO UPDATE ... WHERE no se cumple => 0 filas
    return { returned: null, changes: 0 };
  };

  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              statements.push(sql);
              if (sql.includes('ON CONFLICT(key)') && sql.includes('RETURNING count')) {
                const [key, now, windowMs, maxAttempts] = values as [string, number, number, number];
                const apply = pending.then(() => applyConsume(key, now, windowMs, maxAttempts));
                pending = apply.then(() => undefined);
                const res = await apply;
                consumeLog.push({ key, ...res });
                return (res.returned === null ? null : { count: res.returned }) as T | null;
              }
              if (!sql.startsWith('SELECT count, window_start FROM auth_rate_limit')) {
                throw new Error(`SQL no esperado: ${sql}`);
              }
              const row = rows.get(String(values[0]));
              return (row ? { ...row } : null) as T | null;
            },
            async run() {
              statements.push(sql);
              if (sql.startsWith('INSERT INTO auth_rate_limit')) {
                const [key, count, windowStart] = values as [string, number, number];
                rows.set(key, { count, window_start: windowStart });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('DELETE FROM auth_rate_limit')) {
                if (sql.includes('WHERE key IN')) {
                  // barrido de expiradas, acotado
                  let changes = 0;
                  for (const [k, v] of [...rows]) {
                    if (v.window_start < Number(values[0])) {
                      rows.delete(k);
                      changes++;
                    }
                  }
                  return { meta: { changes } };
                }
                rows.delete(String(values[0]));
                return { meta: { changes: 1 } };
              }
              throw new Error(`SQL no esperado: ${sql}`);
            },
          };
        },
      };
    },
  };
  return { db, rows, statements, consumeLog };
}

describe('D1RateLimitStore', () => {
  let clock = 1_000_000_000_000;
  const makeStore = () => new D1RateLimitStore(fakeD1().db, { now: () => clock });

  it('get devuelve null cuando no hay fila', async () => {
    const store = makeStore();
    expect(await store.get('login:user@test.com')).toBeNull();
  });

  it('put hace UPSERT (INSERT ... ON CONFLICT) y get devuelve el contador', async () => {
    const { db, rows, statements } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });

    await store.put('login:user@test.com', '1');
    await store.put('login:user@test.com', '2');

    expect([...statements].every((s) => s.startsWith('INSERT INTO auth_rate_limit'))).toBe(true);
    for (const s of statements) {
      expect(s).toContain('ON CONFLICT(key)');
    }
    expect(rows.get('login:user@test.com')).toEqual({ count: 2, window_start: clock });
    expect(await store.get('login:user@test.com')).toBe('2');
  });

  it('ignora la fila cuando la ventana de 60 s ya expiro', async () => {
    const { db } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    await store.put('login:user@test.com', '7');

    clock += 59_000;
    expect(await store.get('login:user@test.com')).toBe('7');
    clock += 2_000; // 61 s en total
    expect(await store.get('login:user@test.com')).toBeNull();
  });

  it('del borra la fila', async () => {
    const { db, rows } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    await store.put('login:user@test.com', '3');
    await store.del!('login:user@test.com');
    expect(rows.size).toBe(0);
    expect(await store.get('login:user@test.com')).toBeNull();
  });

  it('si D1 falla (tabla ausente o cuota agotada), FALLA CERRADO: 429 + log, sin propagar', async () => {
    // Regresion de revision: antes degradaba a memoria por isolate (un cold
    // isolate arrancaba en 0 y el limite desaparecia sin dejar rastro). Ahora
    // consume() devuelve denied y console.error deja la degradacion visible.
    const brokenDb: D1Like = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                throw new Error('D1_ERROR: no such table: auth_rate_limit');
              },
              async run() {
                throw new Error('D1_ERROR: no such table: auth_rate_limit');
              },
            };
          },
        };
      },
    };
    const store = new D1RateLimitStore(brokenDb, { now: () => clock });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await consumeLoginAttempt('user@test.com', store);
      expect(res.allowed).toBe(false);
      expect(res.attempts).toBe(10);
      expect(res.retryAfterSeconds).toBe(60);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('consume en un solo statement: N llamadas paralelas dejan exactamente N', async () => {
    // Review finding 1: el read-modify-write perdia incrementos (dos lectores
    // de 9 escribian 10 dos veces). Con el UPSERT ... RETURNING encadenado,
    // una de las dos consume es DENEGADA y la fila se queda en 10.
    let clock = 1_700_000_000_000;
    const { db, rows, consumeLog } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    const key = 'login:user@test.com';
    for (let i = 0; i < 9; i++) {
      await consumeLoginAttempt('user@test.com', store);
    }
    expect(rows.get(key)?.count).toBe(9);

    const [a, b] = await Promise.all([
      consumeLoginAttempt('user@test.com', store),
      consumeLoginAttempt('user@test.com', store),
    ]);
    const allowed = [a, b].filter((r) => r.allowed);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].attempts).toBe(10);
    expect(rows.get(key)?.count).toBe(10);
    // las 11 escrituras encadenadas: 9 + 1 permitida + 1 denegada sin escribir
    expect(consumeLog.filter((e) => e.key === key)).toHaveLength(11);
    expect(consumeLog.filter((e) => e.key === key && e.changes === 0)).toHaveLength(1);
  });

  it('bucket lleno: deniega SIN escribir (changes 0, no gasta cuota de D1)', async () => {
    const { db, rows, consumeLog } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    const key = 'login:user@test.com';
    for (let i = 0; i < 10; i++) {
      const r = await consumeLoginAttempt('user@test.com', store);
      expect(r.allowed).toBe(true);
    }
    const insertsBefore = consumeLog.filter((e) => e.key === key && e.changes > 0).length;

    const blocked = await consumeLoginAttempt('user@test.com', store);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // ninguna escritura nueva para esa llamada
    expect(consumeLog.filter((e) => e.key === key && e.changes > 0).length).toBe(insertsBefore);
    expect(rows.get(key)?.count).toBe(10);
  });

  it('frontera exacta de ventana: 59_999 deniega, 60_000 reinicia a 1', async () => {
    let clock = 1_700_000_000_000;
    const { db, rows } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    for (let i = 0; i < 10; i++) {
      await consumeLoginAttempt('user@test.com', store);
    }
    const windowStart = rows.get('login:user@test.com')!.window_start;
    expect(windowStart).toBe(clock);

    clock += 59_999;
    const stillBlocked = await consumeLoginAttempt('user@test.com', store);
    expect(stillBlocked.allowed).toBe(false);

    clock = windowStart + 60_000;
    const reset = await consumeLoginAttempt('user@test.com', store);
    expect(reset.allowed).toBe(true);
    expect(reset.attempts).toBe(1);
  });

  it('slot de IP primero: 30/min y el 31o NO inserta la fila del email', async () => {
    const { db, rows } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    for (let i = 0; i < 30; i++) {
      const r = await consumeLoginAttempt('ip:203.0.113.5', store, 30, 60);
      expect(r.allowed).toBe(true);
    }
    const blocked = await consumeLoginAttempt('ip:203.0.113.5', store, 30, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // el host que rota emails jamas llega a crear la fila del email
    expect(rows.has('login:other@test.com')).toBe(false);
    expect(rows.has('login:ip:203.0.113.5')).toBe(true);
  });

  it('el barrido borra expiradas con LIMIT, como maximo una vez por hora', async () => {
    let clock = 1_000_000_000_000;
    const { db, rows, statements } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });
    await consumeLoginAttempt('user@test.com', store); // primera consume barre
    expect(statements.filter((s) => s.startsWith('DELETE FROM auth_rate_limit WHERE key IN'))).toHaveLength(1);
    await consumeLoginAttempt('user@test.com', store); // dentro de la hora: no barre
    expect(statements.filter((s) => s.startsWith('DELETE FROM auth_rate_limit WHERE key IN'))).toHaveLength(1);
    clock += 60 * 60 * 1000 + 1;
    rows.set('login:stale@test.com', { count: 5, window_start: 0 });
    await consumeLoginAttempt('user@test.com', store);
    expect(statements.filter((s) => s.startsWith('DELETE FROM auth_rate_limit WHERE key IN'))).toHaveLength(2);
    expect(rows.has('login:stale@test.com')).toBe(false);
  });
});

describe('rate limit de login sobre D1 (API publica sin cambios)', () => {
  it('bloquea tras superar el maximo de intentos', async () => {
    const store = new D1RateLimitStore(fakeD1().db, { now: () => 1_700_000_000_000 });
    for (let i = 0; i < 10; i++) {
      await recordFailedAttempt('user@test.com', store);
    }
    const res = await checkRateLimit('user@test.com', store);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSeconds).toBe(60);
  });

  it('resetRateLimit deja el contador a 0 tras un login correcto', async () => {
    const store = new D1RateLimitStore(fakeD1().db, { now: () => 1_700_000_000_000 });
    await recordFailedAttempt('user@test.com', store);
    await resetRateLimit('user@test.com', store);
    const after = await checkRateLimit('user@test.com', store);
    expect(after.attempts).toBe(0);
    expect(after.allowed).toBe(true);
  });

  it('normaliza el identificador a minusculas', async () => {
    const store = new D1RateLimitStore(fakeD1().db, { now: () => 1_700_000_000_000 });
    await recordFailedAttempt('User@Test.com', store);
    const res = await checkRateLimit('user@test.com', store);
    expect(res.attempts).toBe(1);
  });

  it('cada intento refresca la ventana (comportamiento deslizante, igual que el TTL de KV)', async () => {
    let clock = 1_700_000_000_000;
    const { db, rows } = fakeD1();
    const store = new D1RateLimitStore(db, { now: () => clock });

    await recordFailedAttempt('user@test.com', store);
    expect(rows.get('login:user@test.com')?.window_start).toBe(clock);

    clock += 45_000;
    await recordFailedAttempt('user@test.com', store);
    expect(rows.get('login:user@test.com')?.window_start).toBe(clock);
  });
});

describe('recordFailedAttempt + checkRateLimit', () => {
  it('bloquea tras superar el maximo de intentos', async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 10; i++) {
      await recordFailedAttempt('user@test.com', store);
    }
    const res = await checkRateLimit('user@test.com', store);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('normaliza el identificador a minusculas', async () => {
    const store = new MemoryRateLimitStore();
    await recordFailedAttempt('User@Test.com', store);
    const res = await checkRateLimit('user@test.com', store);
    expect(res.attempts).toBe(1);
  });
});
