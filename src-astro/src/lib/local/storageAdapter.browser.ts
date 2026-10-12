// storageAdapter.browser.ts — `createStorageAdapter` para el BUNDLE DEL NAVEGADOR (alias en astro.config.mjs).
//
// En el navegador los handlers de `src/pages/api/*` solo corren en modo local (lib/local/localApi.ts), que
// siempre inyecta `locals.storage` (IndexedDB). La version del servidor (`lib/storageAdapter.ts`) arrastra el
// enrutador con la boveda de Cloudflare (`@swal/vault`, que usa `Buffer` y `node:crypto`) y un `await`
// de nivel superior que intenta importar `cloudflare:workers`: nada de eso debe llegar al navegador.
import type { StorageAdapter } from '../domain';

export function createStorageAdapter(locals?: unknown): StorageAdapter {
  const injected = (locals as { storage?: StorageAdapter } | null | undefined)?.storage;
  if (injected) return injected;
  throw new Error('En el navegador la API solo corre en modo local, con locals.storage (lib/local/localApi.ts).');
}
