// storageAdapter.ts — factory usada por los endpoints API (SSR).
// Delega en el router canónico. El env Cloudflare se lee de
// `cloudflare:workers` (Astro 6 eliminó locals.runtime.env — el getter
// LANZA si se accede). En Node/tests el import falla y cae a MemoryAdapter.

import type { StorageAdapter } from './domain';
import { selectStorageAdapter } from './storageRouter';
import type { CloudflareEnv } from './cloudflareVaultAdapter';

async function getCloudEnv(): Promise<CloudflareEnv | undefined> {
  try {
    // @vite-ignore: solo resoluble en runtime workerd; en Node/tests falla y cae al catch
    const specifier = 'cloudflare:workers';
    const mod = await import(/* @vite-ignore */ specifier);
    const env = (mod as { env?: CloudflareEnv }).env;
    if (env && (env.SWAL_R2 || env.SWAL_D1)) return env;
    return undefined;
  } catch {
    return (globalThis as Record<string, unknown>).__env as CloudflareEnv | undefined;
  }
}

const cloudEnv: CloudflareEnv | undefined = await getCloudEnv().catch(() => undefined);

/**
 * `locals.storage` (si viene) gana: el modo local del navegador (`lib/local/localApi.ts`) ejecuta estos
 * mismos handlers sobre IndexedDB. En el Worker nadie lo pone, asi que el servidor se comporta igual que antes.
 */
export function createStorageAdapter(locals?: unknown): StorageAdapter {
  const injected = (locals as { storage?: StorageAdapter } | null | undefined)?.storage;
  if (injected) return injected;
  const env = cloudEnv ?? ((globalThis as Record<string, unknown>).__env as CloudflareEnv | undefined);
  return selectStorageAdapter(env ? { env, serverReadable: true } : {});
}
