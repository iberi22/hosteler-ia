import {
  createGosClient, indexedDbCache, memoryCache,
  type CacheAdapter, type GosClient, type Ingredient,
} from '@swal/gos-client';

export type { Ingredient } from '@swal/gos-client';
export const GOS_BASE_URL = import.meta.env.PUBLIC_GOS_API || 'https://gos.swal.network/api/v1';

/** Storage restrictions must not turn optional food metadata into an app failure. */
export function resilientCache(persistent: CacheAdapter): CacheAdapter {
  const fallback = memoryCache();
  return {
    async get<T>(key: string) {
      try {
        const value = await persistent.get<T>(key);
        if (value !== undefined) { await fallback.set(key, value); return value; }
      } catch { /* private browsing / IndexedDB unavailable */ }
      return fallback.get<T>(key);
    },
    async set<T>(key: string, value: T) {
      await fallback.set(key, value);
      try { await persistent.set(key, value); } catch { /* keep session copy */ }
    },
  };
}

export function createAppGosClient(options: {
  baseUrl?: string; cache?: CacheAdapter; fetch?: typeof fetch; timeoutMs?: number;
} = {}) {
  const baseUrl = (options.baseUrl ?? GOS_BASE_URL).replace(/\/+$/, '');
  const cache = resilientCache(options.cache ?? (typeof window === 'undefined'
    ? memoryCache() : indexedDbCache('fize-gos-v1')));
  const fetcher = options.fetch ?? globalThis.fetch;
  const boundedFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(input, { ...init, signal: controller.signal });
          // Fetch resolves at headers; include the entire body in the deadline.
          const body = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : body, {
            status: response.status, statusText: response.statusText, headers: response.headers,
          });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('GOS timeout')); }, options.timeoutMs ?? 2500);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const client = createGosClient({ baseUrl, cache, fetch: boundedFetch });
  return {
    async searchIngredients(query: string) {
      try { return await client.searchIngredients(query); } catch { return []; }
    },
    async getIngredient(id: string) {
      try { return await client.getIngredient(id); } catch { return undefined; }
    },
    async getManifest() {
      try { return await client.getManifest(); } catch { return undefined; }
    },
    /** Pin the complete cached collection and its identity for one calculation. */
    async snapshot(): Promise<{ client: GosClient; ingredients: Ingredient[]; dataset: string } | undefined> {
      try {
        await client.listIngredients();
        const key = await cache.get<string>(`${baseUrl}:ingredients:latest`);
        if (!key) return undefined;
        const ingredients = await cache.get<Ingredient[]>(key);
        if (!ingredients) return undefined;
        const [version, hash] = key.slice(baseUrl.length + 1).split(':');
        const manifest = { schemaVersion: '1', version, contentHash: hash,
          files: { ingredients: 'ingredients.json' } };
        // A separate in-memory client keeps refreshes from mixing dataset versions.
        const pinned = createGosClient({ fetch: async (url) => new Response(JSON.stringify(
          String(url).endsWith('manifest.json') ? manifest : ingredients,
        )) });
        await pinned.listIngredients();
        return { client: pinned, ingredients, dataset: `${version}+sha256:${hash}` };
      } catch { return undefined; }
    },
  };
}

export const gos = createAppGosClient();
