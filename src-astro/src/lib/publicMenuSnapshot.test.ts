// @vitest-environment node
// /[slug]/menu: primero la carta publicada (R2 + Cache API 60 s), si no la de la nube. Y `?mesa=N`.
import { describe, it, expect, vi } from 'vitest';
import {
  loadMenuForPublicPage,
  readPublishedMenu,
  sanitizeMesa,
  sanitizePublicMenu,
  snapshotR2Key,
  SNAPSHOT_LIMITS,
  type CacheLike,
  type R2Like,
} from './publicMenuSnapshot';
import type { PublicMenuData } from './publicMenuBySlug';

const ORIGIN = 'https://fize.test';
const published: PublicMenuData = {
  restaurant: { id: 'local-abc', name: 'Publicada', slug: 'la-esquina', phone: '573001234567' },
  categories: [{ id: 'c1', name: 'Platos' }],
  items: [{ id: 'i1', name: 'Ajiaco', price: 21000, categoryId: 'c1', isAvailable: true }],
};
const cloud: PublicMenuData = { ...published, restaurant: { ...published.restaurant, id: 'cloud-1', name: 'Nube' } };

function fakeR2(objects: Record<string, string> = {}) {
  const gets: string[] = [];
  const r2: R2Like = {
    get: async (k) => {
      gets.push(k);
      return k in objects ? { text: async () => objects[k] } : null;
    },
    put: async () => undefined,
  };
  return { r2, gets };
}

/** Cache API falsa con la misma semantica que usa el modulo (match/put/delete por URL). */
function fakeCache() {
  const store = new Map<string, { body: string; headers: [string, string][] }>();
  const cache: CacheLike = {
    match: async (req) => {
      const e = store.get(req.url);
      return e ? new Response(e.body, { headers: e.headers }) : undefined;
    },
    put: async (req, res) => {
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
      store.set(req.url, { body: await res.text(), headers: [...res.headers.entries()] });
    },
    delete: async (req) => store.delete(req.url),
  };
  return { cache, store };
}

const stored = (menu: PublicMenuData, slug = 'la-esquina') =>
  JSON.stringify({ v: 1, slug, publishedAt: '2026-10-02T15:00:00.000Z', menu, audit: { signature: 's', pubkeyFp: 'f', receivedAt: 'x', signedBytes: 1 } });

describe('carta publica: instantanea primero', () => {
  it('si hay instantanea en R2 se usa y NO se consulta el adaptador de la nube', async () => {
    const { r2 } = fakeR2({ [snapshotR2Key('la-esquina')]: stored(published) });
    const loadFromAdapter = vi.fn(async () => cloud);
    const res = await loadMenuForPublicPage({ slug: 'la-esquina', r2, origin: ORIGIN, cache: null, loadFromAdapter });
    expect(res).toEqual({ menu: published, source: 'snapshot' });
    expect(loadFromAdapter).not.toHaveBeenCalled();
  });

  it('sin instantanea cae a la carta de la nube (restaurantes en la nube sin cambios)', async () => {
    const { r2 } = fakeR2();
    const loadFromAdapter = vi.fn(async () => cloud);
    const res = await loadMenuForPublicPage({ slug: 'la-esquina', r2, origin: ORIGIN, cache: null, loadFromAdapter });
    expect(res).toEqual({ menu: cloud, source: 'cloud' });
    expect(loadFromAdapter).toHaveBeenCalledOnce();
  });

  it('sin R2 (Node/tests) o con slug invalido no se lee R2 y se usa la nube', async () => {
    const loadFromAdapter = vi.fn(async () => cloud);
    expect((await loadMenuForPublicPage({ slug: 'la-esquina', r2: undefined, origin: ORIGIN, loadFromAdapter }))?.source).toBe('cloud');
    const { r2, gets } = fakeR2();
    expect((await loadMenuForPublicPage({ slug: 'dashboard', r2, origin: ORIGIN, loadFromAdapter }))?.source).toBe('cloud');
    expect(gets).toEqual([]);
  });

  it('ni instantanea ni carta en la nube: null (la pagina responde 404)', async () => {
    const { r2 } = fakeR2();
    expect(await loadMenuForPublicPage({ slug: 'no-existe', r2, origin: ORIGIN, loadFromAdapter: async () => null })).toBeNull();
  });

  it('instantanea corrupta o de otro slug: se ignora y cae a la nube', async () => {
    const { r2 } = fakeR2({
      [snapshotR2Key('la-esquina')]: '{roto',
      [snapshotR2Key('otro-local')]: stored(published, 'la-esquina'),
    });
    for (const slug of ['la-esquina', 'otro-local']) {
      const res = await loadMenuForPublicPage({ slug, r2, origin: ORIGIN, loadFromAdapter: async () => cloud });
      expect(res?.source, slug).toBe('cloud');
    }
  });

  it('el slug de la URL se normaliza (mayusculas/tildes) antes de buscar en R2', async () => {
    const { r2, gets } = fakeR2({ [snapshotR2Key('la-esquina')]: stored(published) });
    expect(await readPublishedMenu(r2, 'La-Esquina', { origin: ORIGIN })).toEqual(published);
    expect(gets).toEqual(['public/menu/la-esquina.json']);
  });
});

describe('carta publica: Cache API (60 s) para no leer R2 en cada visita', () => {
  it('segunda visita sale de la cache: 1 sola lectura R2', async () => {
    const { r2, gets } = fakeR2({ [snapshotR2Key('la-esquina')]: stored(published) });
    const { cache } = fakeCache();
    expect(await readPublishedMenu(r2, 'la-esquina', { origin: ORIGIN, cache })).toEqual(published);
    expect(await readPublishedMenu(r2, 'la-esquina', { origin: ORIGIN, cache })).toEqual(published);
    expect(gets).toHaveLength(1);
  });

  it('tambien se cachea la AUSENCIA: una carta en la nube no paga una lectura R2 por visita', async () => {
    const { r2, gets } = fakeR2();
    const { cache, store } = fakeCache();
    const loadFromAdapter = vi.fn(async () => cloud);
    for (let i = 0; i < 3; i++) {
      expect((await loadMenuForPublicPage({ slug: 'la-esquina', r2, origin: ORIGIN, cache, loadFromAdapter }))?.source).toBe('cloud');
    }
    expect(gets).toHaveLength(1);
    expect([...store.keys()]).toEqual([`${ORIGIN}/__fize/public-menu/la-esquina.json`]);
  });

  it('al publicar se borra la entrada (misma clave que usa el endpoint) y la siguiente visita lee R2', async () => {
    const objects: Record<string, string> = {};
    const { r2, gets } = fakeR2(objects);
    const { cache } = fakeCache();
    expect(await readPublishedMenu(r2, 'la-esquina', { origin: ORIGIN, cache })).toBeNull();
    objects[snapshotR2Key('la-esquina')] = stored(published);
    await cache.delete(new Request(`${ORIGIN}/__fize/public-menu/la-esquina.json`));
    expect(await readPublishedMenu(r2, 'la-esquina', { origin: ORIGIN, cache })).toEqual(published);
    expect(gets).toHaveLength(2);
  });

  it('si R2 falla no rompe la carta: cae a la nube', async () => {
    const r2: R2Like = { get: async () => { throw new Error('R2 caido'); }, put: async () => undefined };
    const res = await loadMenuForPublicPage({ slug: 'la-esquina', r2, origin: ORIGIN, loadFromAdapter: async () => cloud });
    expect(res?.source).toBe('cloud');
  });
});

describe('sanitizePublicMenu', () => {
  it('topes de cantidad y de largo', () => {
    const items = Array.from({ length: 700 }, (_, i) => ({
      id: `i${i}`, name: `${'N'.repeat(300)}${i}`, price: 1000 + i, categoryId: `c${i % 150}`, isAvailable: true,
    }));
    const categories = Array.from({ length: 150 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}` }));
    const out = sanitizePublicMenu({ restaurant: { name: 'X'.repeat(500) }, categories, items }, 'la-esquina');
    expect(out.items).toHaveLength(SNAPSHOT_LIMITS.items);
    expect(out.categories).toHaveLength(SNAPSHOT_LIMITS.categories);
    expect(Math.max(...out.items.map((i) => i.name.length))).toBeLessThanOrEqual(SNAPSHOT_LIMITS.name);
    expect(out.restaurant.name).toHaveLength(SNAPSHOT_LIMITS.name);
    expect(out.restaurant.slug).toBe('la-esquina');
  });

  it('caracteres de control fuera y emojis enteros', () => {
    const out = sanitizePublicMenu(
      { restaurant: { name: 'La\u0000 Esquina\n🍲' }, categories: [], items: [{ id: 'a', name: 'Sopa\t🍲', price: 1, categoryId: '' }] },
      'la-esquina',
    );
    expect(out.restaurant.name).toBe('La Esquina 🍲');
    expect(out.items[0].name).toBe('Sopa 🍲');
  });

  it('entrada basura no lanza', () => {
    expect(sanitizePublicMenu(null, 'la-esquina')).toEqual({
      restaurant: { id: 'la-esquina', name: "Fi'ze", slug: 'la-esquina' }, categories: [], items: [],
    });
  });
});

describe('?mesa=N del QR', () => {
  it('acepta numeros, letras y guion hasta 8', () => {
    expect(sanitizeMesa('3')).toBe('3');
    expect(sanitizeMesa(' 12 ')).toBe('12');
    expect(sanitizeMesa('T-4')).toBe('T-4');
    expect(sanitizeMesa('terraza1')).toBe('terraza1');
  });

  it('rechaza todo lo demas (va dentro del mensaje de WhatsApp)', () => {
    for (const bad of [null, undefined, '', 'terraza-12', '3\nTotal: 0', '<b>1</b>', '%0A', 'mesa 3']) {
      expect(sanitizeMesa(bad), String(bad)).toBe('');
    }
  });
});
