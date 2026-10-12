// @vitest-environment node
// POST /api/public-menu/<slug>: codigo de activacion la primera vez, llave fija despues, firma, topes,
// cupo diario y limpieza del lado del servidor. D1/R2/Cache falsos; 0 KV.
import { describe, it, expect } from 'vitest';
import {
  handlePublishRequest,
  hashActivationCode,
  normalizeActivationCode,
  MESSAGES,
  MAX_PUBLISHES_PER_DAY,
  type D1Like,
} from './publicMenuPublish';
import {
  buildPublishRequest,
  generateRestaurantKeyPair,
  MAX_SNAPSHOT_BYTES,
  publicJwk,
  publicKeyFingerprint,
  signSnapshot,
  snapshotBytes,
  type PublicMenuSnapshot,
  type PublishMenuRequest,
} from './publicMenuSignature';
import type { PublicMenuData } from './publicMenuBySlug';
import type { CacheLike } from './publicMenuSnapshot';
import {
  generateActivationCode,
  hashActivationCode as scriptHash,
  normalizeActivationCode as scriptNormalize,
  buildInsertCommand,
} from '../../scripts/activation-code.mjs';

type Row = Record<string, unknown>;

/** D1 falso: solo las sentencias del endpoint, con sus guardas. Cuenta lecturas y filas escritas. */
function fakeD1() {
  const menus = new Map<string, Row>();
  const codes = new Map<string, Row>();
  const stats = { reads: 0, writes: 0 };
  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first<T>() {
              stats.reads++;
              if (!sql.startsWith('SELECT slug, pubkey_fp')) throw new Error(`SQL no esperado: ${sql}`);
              return (menus.get(String(a[0])) ?? null) as T | null;
            },
            async run() {
              if (sql.startsWith('UPDATE public_menu_activation')) {
                const [now, fp, hash, slug] = a as string[];
                const c = codes.get(hash);
                if (!c || c.used_at != null || (c.slug != null && c.slug !== slug)) return { meta: { changes: 0 } };
                c.used_at = now;
                c.used_by_fp = fp;
                stats.writes++;
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('INSERT INTO public_menu')) {
                const [slug, fp, jwk, r2Key, bytes, publishedAt, created, updated, day] = a as string[];
                if (menus.has(slug)) return { meta: { changes: 0 } };
                menus.set(slug, {
                  slug, pubkey_fp: fp, pubkey_jwk: jwk, r2_key: r2Key, bytes, published_at: publishedAt,
                  created_at: created, updated_at: updated, publish_day: day, publish_count: 1,
                });
                stats.writes++;
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('UPDATE public_menu SET')) {
                const [day, , r2Key, bytes, publishedAt, now, slug, fp, , max, pubGuard] = a as [string, string, string, number, string, string, string, string, string, number, string];
                const r = menus.get(slug);
                if (!r || r.pubkey_fp !== fp) return { meta: { changes: 0 } };
                if (r.publish_day === day && Number(r.publish_count) >= max) return { meta: { changes: 0 } };
                if (r.published_at != null && String(r.published_at) > pubGuard) return { meta: { changes: 0 } };
                r.publish_count = r.publish_day === day ? Number(r.publish_count) + 1 : 1;
                Object.assign(r, { publish_day: day, r2_key: r2Key, bytes, published_at: publishedAt, updated_at: now });
                stats.writes++;
                return { meta: { changes: 1 } };
              }
              throw new Error(`SQL no esperado: ${sql}`);
            },
          };
        },
      };
    },
  };
  return { db, menus, codes, stats };
}

function fakeCloud() {
  const d1 = fakeD1();
  const r2 = new Map<string, string>();
  let r2Puts = 0;
  let kvCalls = 0;
  const deletedKeys: string[] = [];
  const cache: CacheLike = {
    match: async () => undefined,
    put: async () => undefined,
    delete: async (req: Request) => { deletedKeys.push(req.url); return true; },
  };
  const env = {
    SWAL_D1: d1.db,
    SWAL_R2: {
      get: async (k: string) => (r2.has(k) ? { text: async () => r2.get(k)! } : null),
      put: async (k: string, v: string) => { r2Puts++; r2.set(k, v); },
    },
    // Si el endpoint tocara KV, esto lo contaria (y tiene que quedar en 0).
    SWAL_KV: {
      get: async () => { kvCalls++; return null; },
      put: async () => { kvCalls++; },
    },
  };
  return { env, d1, r2, cache, deletedKeys, r2Puts: () => r2Puts, kvCalls: () => kvCalls };
}

const NOW = new Date('2026-10-02T15:00:00.000Z');
const SLUG = 'la-esquina';

function menu(slug = SLUG, extra: Partial<PublicMenuData> = {}): PublicMenuData {
  return {
    restaurant: { id: 'r1', name: 'La Esquina', slug, phone: '3001234567' },
    categories: [{ id: 'c1', name: 'Platos' }],
    items: [{ id: 'i1', name: 'Ajiaco', price: 21000, categoryId: 'c1', isAvailable: true }],
    ...extra,
  };
}

async function keys() {
  const pair = await generateRestaurantKeyPair();
  return { privateKey: pair.privateKey, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}

async function seedCode(c: ReturnType<typeof fakeCloud>, code: string, slug: string | null = null) {
  const hash = await hashActivationCode(normalizeActivationCode(code)!);
  c.d1.codes.set(hash, { code_hash: hash, slug, created_at: NOW.toISOString(), used_at: null, used_by_fp: null });
  return hash;
}

function post(slug: string, body: unknown) {
  return new Request(`https://fize.test/api/public-menu/${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function send(c: ReturnType<typeof fakeCloud>, slug: string, body: unknown, now = NOW) {
  const res = await handlePublishRequest(post(slug, body), slug, { env: c.env, origin: 'https://fize.test', cache: c.cache, now: () => now });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const at = (minutesBefore: number) => new Date(NOW.getTime() - minutesBefore * 60_000);

describe('publicar carta: primera vez con codigo de activacion', () => {
  it('sin codigo: 403 y no escribe nada', async () => {
    const c = fakeCloud();
    const k = await keys();
    const r = await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, at(1)));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe(MESSAGES.needsCode);
    expect(c.r2Puts()).toBe(0);
    expect(c.d1.stats.writes).toBe(0);
  });

  it('codigo inexistente, ya usado o de otro slug: 403', async () => {
    const c = fakeCloud();
    const k = await keys();
    const wrong = await send(c, SLUG, await buildPublishRequest(menu(), k, 'FZ-0000-0000', at(1)));
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe(MESSAGES.badCode);

    const garbage = await send(c, SLUG, await buildPublishRequest(menu(), k, 'hola', at(1)));
    expect(garbage.status).toBe(403);

    const hash = await seedCode(c, 'FZ-ABCD-EFGH');
    c.d1.codes.get(hash)!.used_at = '2026-10-01T00:00:00.000Z';
    const used = await send(c, SLUG, await buildPublishRequest(menu(), k, 'FZ-ABCD-EFGH', at(1)));
    expect(used.status).toBe(403);

    await seedCode(c, 'FZ-JKMN-PQRS', 'otro-local');
    const otherSlug = await send(c, SLUG, await buildPublishRequest(menu(), k, 'FZ-JKMN-PQRS', at(1)));
    expect(otherSlug.status).toBe(403);
    expect(c.r2Puts()).toBe(0);
    expect(c.d1.menus.size).toBe(0);
  });

  it('codigo valido: registra la llave, gasta el codigo y guarda en public/menu/<slug>.json', async () => {
    const c = fakeCloud();
    const k = await keys();
    const hash = await seedCode(c, 'FZ-ABCD-EFGH', SLUG);
    // El restaurante lo puede escribir en minusculas, sin guiones y con O en vez de 0.
    const r = await send(c, SLUG, await buildPublishRequest(menu(), k, ' fzabcdefgh ', at(1)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, slug: SLUG, url: `/${SLUG}/menu`, publishedAt: at(1).toISOString() });

    const fp = await publicKeyFingerprint(k.publicKey);
    expect(c.d1.menus.get(SLUG)).toMatchObject({ pubkey_fp: fp, r2_key: `public/menu/${SLUG}.json`, publish_count: 1, publish_day: '2026-10-02' });
    expect(JSON.parse(String(c.d1.menus.get(SLUG)!.pubkey_jwk))).not.toHaveProperty('d');
    expect(c.d1.codes.get(hash)).toMatchObject({ used_at: NOW.toISOString(), used_by_fp: fp });
    expect(c.d1.stats.writes).toBeLessThanOrEqual(2);

    expect([...c.r2.keys()]).toEqual([`public/menu/${SLUG}.json`]);
    const stored = JSON.parse(c.r2.get(`public/menu/${SLUG}.json`)!);
    expect(stored).toMatchObject({ v: 1, slug: SLUG, menu: { restaurant: { name: 'La Esquina', slug: SLUG } } });
    expect(stored.audit).toMatchObject({ pubkeyFp: fp, receivedAt: NOW.toISOString() });
    expect(typeof stored.audit.signature).toBe('string');
    expect(c.deletedKeys).toEqual([`https://fize.test/__fize/public-menu/${SLUG}.json`]);
    expect(c.kvCalls()).toBe(0);
  });

  it('el mismo codigo no sirve dos veces', async () => {
    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    expect((await send(c, SLUG, await buildPublishRequest(menu(), await keys(), 'FZ-ABCD-EFGH', at(2)))).status).toBe(200);
    const again = await send(c, 'otro-local', await buildPublishRequest(menu('otro-local'), await keys(), 'FZ-ABCD-EFGH', at(1)));
    expect(again.status).toBe(403);
    expect(again.body.error).toBe(MESSAGES.badCode);
  });
});

describe('publicar carta: siguientes veces', () => {
  async function registered() {
    const c = fakeCloud();
    const k = await keys();
    await seedCode(c, 'FZ-ABCD-EFGH');
    expect((await send(c, SLUG, await buildPublishRequest(menu(), k, 'FZ-ABCD-EFGH', at(60)))).status).toBe(200);
    c.d1.stats.writes = 0;
    c.d1.stats.reads = 0;
    return { c, k };
  }

  it('misma llave sin codigo: 200, 1 lectura y 1 escritura D1, 1 escritura R2, 0 KV', async () => {
    const { c, k } = await registered();
    const putsBefore = c.r2Puts();
    const m = menu();
    m.items.push({ id: 'i2', name: 'Bandeja paisa', price: 32000, categoryId: 'c1', isAvailable: true });
    const r = await send(c, SLUG, await buildPublishRequest(m, k, undefined, at(30)));
    expect(r.status).toBe(200);
    expect(r.body.items).toBe(2);
    expect(c.d1.stats).toEqual({ reads: 1, writes: 1 });
    expect(c.r2Puts()).toBe(putsBefore + 1);
    expect(JSON.parse(c.r2.get(`public/menu/${SLUG}.json`)!).menu.items).toHaveLength(2);
    expect(c.d1.menus.get(SLUG)!.publish_count).toBe(2);
    expect(c.kvCalls()).toBe(0);
  });

  it('otra llave (aunque traiga codigo): 403 "Este enlace ya pertenece a otro restaurante"', async () => {
    const { c } = await registered();
    await seedCode(c, 'FZ-ZZZZ-ZZZZ');
    const r = await send(c, SLUG, await buildPublishRequest(menu(), await keys(), 'FZ-ZZZZ-ZZZZ', at(30)));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('Este enlace ya pertenece a otro restaurante.');
    expect(JSON.parse(c.r2.get(`public/menu/${SLUG}.json`)!).publishedAt).toBe(at(60).toISOString());
  });

  it('una carta firmada mas vieja que la publicada: 409 (no se puede repetir una vieja)', async () => {
    const { c, k } = await registered();
    const r = await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, at(120)));
    expect(r.status).toBe(409);
    // Reenviar la misma (reintento tras un fallo de red) si se acepta.
    expect((await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, at(60)))).status).toBe(200);
  });

  it(`la publicacion ${MAX_PUBLISHES_PER_DAY + 1} del dia: 429; al otro dia (UTC) vuelve a abrir`, async () => {
    const { c, k } = await registered(); // ya lleva 1 hoy
    for (let i = 2; i <= MAX_PUBLISHES_PER_DAY; i++) {
      const r = await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, at(60 - i)));
      expect(r.status, `publicacion ${i}`).toBe(200);
    }
    const putsBefore = c.r2Puts();
    const over = await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, at(1)));
    expect(over.status).toBe(429);
    expect(over.body.error).toBe(MESSAGES.rateLimited);
    expect(c.r2Puts()).toBe(putsBefore);

    const tomorrow = new Date('2026-10-03T00:00:05.000Z');
    const r = await send(c, SLUG, await buildPublishRequest(menu(), k, undefined, tomorrow), tomorrow);
    expect(r.status).toBe(200);
    expect(c.d1.menus.get(SLUG)).toMatchObject({ publish_day: '2026-10-03', publish_count: 1 });
  });
});

describe('publicar carta: validacion', () => {
  it('firma invalida (carta cambiada despues de firmar): 401', async () => {
    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    const req = await buildPublishRequest(menu(), await keys(), 'FZ-ABCD-EFGH', at(1));
    req.snapshot.menu.items[0].price = 1;
    const r = await send(c, SLUG, req);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe(MESSAGES.badSignature);
    expect(c.d1.stats.writes).toBe(0);
  });

  it('firma de otra llave que la enviada: 401', async () => {
    const c = fakeCloud();
    const req = await buildPublishRequest(menu(), await keys(), 'FZ-ABCD-EFGH', at(1));
    req.publicKey = (await keys()).publicKey;
    expect((await send(c, SLUG, req)).status).toBe(401);
  });

  it('slug de la carta distinto al de la URL, slug reservado o con formato invalido: 400', async () => {
    const c = fakeCloud();
    const k = await keys();
    const req = await buildPublishRequest(menu('otro-local'), k, 'FZ-ABCD-EFGH', at(1));
    const mismatch = await send(c, SLUG, req);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe(MESSAGES.slugMismatch);

    for (const bad of ['dashboard', 'api', 'local', 'Mi_Local', 'ab', '-x-']) {
      const r = await send(c, bad, await buildPublishRequest(menu(bad), k, 'FZ-ABCD-EFGH', at(1)));
      expect(r.status, bad).toBe(400);
    }
  });

  it('cuerpo no JSON o sin la forma del contrato: 400', async () => {
    const c = fakeCloud();
    expect((await send(c, SLUG, '{no es json')).status).toBe(400);
    const req = await buildPublishRequest(menu(), await keys(), undefined, at(1));
    expect((await send(c, SLUG, { ...req, snapshot: { ...req.snapshot, v: 2 } })).status).toBe(400);
    expect((await send(c, SLUG, { ...req, signature: undefined })).status).toBe(400);
    expect((await send(c, SLUG, { ...req, publicKey: { kty: 'RSA' } })).status).toBe(400);
  });

  it('carta de mas de 256 KB: 413 (por el JSON firmado y por el tamano del cuerpo)', async () => {
    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    const k = await keys();
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `Plato ${i}`, price: 1000, categoryId: 'c1', isAvailable: true, description: 'x'.repeat(200) }));
    // Apenas por encima de 256 KB: el cuerpo pasa el tope de lectura pero el JSON firmado no.
    let n = 800;
    const sizeOf = (count: number) =>
      snapshotBytes({ v: 1, slug: SLUG, publishedAt: at(1).toISOString(), menu: menu(SLUG, { items: items(count) }) });
    while (sizeOf(n) <= MAX_SNAPSHOT_BYTES) n++;
    const justOver = await buildPublishRequest(menu(SLUG, { items: items(n) }), k, 'FZ-ABCD-EFGH', at(1));
    expect(snapshotBytes(justOver.snapshot)).toBeGreaterThan(MAX_SNAPSHOT_BYTES);
    expect(JSON.stringify(justOver).length).toBeLessThan(MAX_SNAPSHOT_BYTES + 16 * 1024);
    expect((await send(c, SLUG, justOver)).status).toBe(413);
    // ~600 KB: se corta al leer el cuerpo.
    const huge = await buildPublishRequest(menu(SLUG, { items: items(2400) }), k, 'FZ-ABCD-EFGH', at(1));
    expect((await send(c, SLUG, huge)).status).toBe(413);
    expect(c.r2Puts()).toBe(0);
  });

  it('fecha de la carta adelantada mas de 10 minutos: 400', async () => {
    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    const future = new Date(NOW.getTime() + 60 * 60_000);
    const r = await send(c, SLUG, await buildPublishRequest(menu(), await keys(), 'FZ-ABCD-EFGH', future));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(MESSAGES.futureDate);
  });

  it('sin bindings: 503; fallo de R2: 500 sin detalles internos', async () => {
    const req = await buildPublishRequest(menu(), await keys(), 'FZ-ABCD-EFGH', at(1));
    const none = await handlePublishRequest(post(SLUG, req), SLUG, { env: undefined, origin: 'https://fize.test' });
    expect(none.status).toBe(503);

    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    c.env.SWAL_R2.put = async () => { throw new Error('R2 internal: bucket fize-astro-r2 token xyz'); };
    const r = await send(c, SLUG, req);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/R2|bucket|token|stack/);
    expect(r.body.error).toBe(MESSAGES.internal);
  });
});

describe('publicar carta: el servidor vuelve a limpiar (no confia en el equipo)', () => {
  it('quita no disponibles, ocultos, descripciones internas, campos extra y categorias sin platos', async () => {
    const c = fakeCloud();
    await seedCode(c, 'FZ-ABCD-EFGH');
    const dirty = {
      restaurant: { id: 'r1', name: 'La Esquina', slug: 'otro-slug', phone: '300 123 4567', ownerEmail: 'dueno@x.co' },
      categories: [
        { id: 'c1', name: 'Platos', costCenter: 'cocina' },
        { id: 'c2', name: 'Solo agotados' },
        { id: 'c3', name: 'Vacia' },
      ],
      items: [
        { id: 'i1', name: 'Ajiaco', price: 21000, categoryId: 'c1', isAvailable: true, description: 'Con guascas', unitCost: 7000, recipeId: 'rec-1' },
        { id: 'i2', name: 'Agotado', price: 9000, categoryId: 'c2', isAvailable: false },
        { id: 'i3', name: 'Oculto', price: 9000, categoryId: 'c1', isAvailable: true, isPublic: false },
        { id: 'i4', name: 'Bandeja', price: 32000, categoryId: 'c1', isAvailable: true, description: 'Receta aplicada al inventario' },
        { id: 'i5', name: 'Precio raro', price: -5, categoryId: 'c1', isAvailable: true },
      ],
    } as unknown as PublicMenuData;
    // El equipo firma lo que quiera (aqui, un restaurant.slug distinto): manda el slug de la URL.
    const k = await keys();
    const snapshot: PublicMenuSnapshot = { v: 1, slug: SLUG, publishedAt: at(1).toISOString(), menu: dirty };
    const signed: PublishMenuRequest = {
      snapshot,
      publicKey: publicJwk(k.publicKey),
      signature: await signSnapshot(snapshot, k.privateKey),
      activationCode: 'FZ-ABCD-EFGH',
    };
    const r = await send(c, SLUG, signed);
    expect(r.status).toBe(200);

    const raw = c.r2.get(`public/menu/${SLUG}.json`)!;
    const stored = JSON.parse(raw);
    expect(stored.menu.items.map((i: { id: string }) => i.id)).toEqual(['i1', 'i4']);
    expect(stored.menu.items[0]).toEqual({ id: 'i1', name: 'Ajiaco', price: 21000, description: 'Con guascas', categoryId: 'c1', isAvailable: true });
    expect(stored.menu.items[1]).not.toHaveProperty('description');
    expect(stored.menu.categories).toEqual([{ id: 'c1', name: 'Platos' }]);
    expect(stored.menu.restaurant).toEqual({ id: 'r1', name: 'La Esquina', slug: SLUG, phone: '300 123 4567' });
    expect(raw).not.toMatch(/unitCost|recipeId|rec-1|ownerEmail|costCenter|Receta|Agotado|Oculto/);
  });
});

describe('codigo de activacion: script del operador y endpoint usan lo mismo', () => {
  it('genera FZ-XXXX-XXXX en Crockford y el hash del script es el del endpoint', async () => {
    for (let i = 0; i < 20; i++) {
      const code = generateActivationCode();
      expect(code).toMatch(/^FZ-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(normalizeActivationCode(code)).toBe(code);
      expect(scriptNormalize(code.toLowerCase().replace(/-/g, ''))).toBe(code);
      expect(scriptHash(code)).toBe(await hashActivationCode(code));
    }
    expect(generateActivationCode(new Uint8Array([0, 0, 0, 0, 0]))).toBe('FZ-0000-0000');
    expect(generateActivationCode(new Uint8Array([255, 255, 255, 255, 255]))).toBe('FZ-ZZZZ-ZZZZ');
    // O -> 0, I/L -> 1 (Crockford); U no existe en el alfabeto.
    expect(normalizeActivationCode('fz-ab0o-il1x')).toBe('FZ-AB00-111X');
    expect(normalizeActivationCode('ABCD EFGH')).toBe('FZ-ABCD-EFGH');
    expect(normalizeActivationCode('FZ-ABCD-EFGU')).toBe(null);
    expect(normalizeActivationCode('FZ-ABCD-EFG')).toBe(null);
  });

  it('el comando solo lleva el hash (nunca el codigo) y valida el slug', () => {
    const code = generateActivationCode();
    const cmd = buildInsertCommand(scriptHash(code), 'la-esquina', '2026-10-02T00:00:00.000Z');
    expect(cmd).toContain('npx wrangler d1 execute fize-db --remote --command');
    expect(cmd).toContain(scriptHash(code));
    expect(cmd).toContain("'la-esquina'");
    expect(cmd).not.toContain(code);
    expect(buildInsertCommand(scriptHash(code), null, 'x', '--local')).toContain("--local --command");
    expect(() => buildInsertCommand(scriptHash(code), "x'); DROP TABLE credits; --", 'x')).toThrow();
  });
});
