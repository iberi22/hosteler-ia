// storageRouter.ts — selecciona el StorageAdapter según contexto de ejecución
// Prioridad: force (tests) → Cloudflare bindings (SSR/worker) → edge-hive URL
// (browser online) → IndexedDB (browser offline) → Memory (fallback/SSR sin bindings)

import type { StorageAdapter } from './domain';
import { getMemoryAdapter } from './domain';
import { CloudflareVaultAdapter, type CloudflareEnv } from './cloudflareVaultAdapter';
import { createIdbDeviceShareStore } from './deviceShareStore';
import { getIdbAdapter } from './idbAdapter';
import { SurrealAdapter } from './surreal';

export type AdapterKind = 'vault' | 'surreal' | 'idb' | 'memory';

export interface RouterContext {
  env?: CloudflareEnv;
  edgeHiveUrl?: string;
  force?: AdapterKind;
  /** API SSR del Worker: datos operativos legibles por el servidor (NO E2EE). Ver cloudflareVaultAdapter. */
  serverReadable?: boolean;
}

// Modo E2EE en el browser: los shares x=1/x=2 se persisten en IndexedDB. En SSR (serverReadable) no se usan;
// en E2EE sin IndexedDB no se inyecta nada y el adaptador falla cerrado al sellar.
function vaultOpts(ctx: RouterContext) {
  const e2ee = !ctx.serverReadable && typeof indexedDB !== 'undefined';
  return { serverReadable: ctx.serverReadable, deviceShareStore: e2ee ? createIdbDeviceShareStore() : undefined };
}

export function selectStorageAdapter(ctx: RouterContext = {}): StorageAdapter {
  if (ctx.force === 'memory') return getMemoryAdapter();
  if (ctx.force === 'idb') return getIdbAdapter();
  if (ctx.force === 'surreal') {
    if (!ctx.edgeHiveUrl) throw new Error('edgeHiveUrl required for surreal adapter');
    return new SurrealAdapter(ctx.edgeHiveUrl);
  }
  if (ctx.force === 'vault') {
    if (!ctx.env) throw new Error('env required for vault adapter');
    const vault = CloudflareVaultAdapter.attachIfCloud(ctx.env, undefined, vaultOpts(ctx));
    if (!vault) throw new Error('Cloudflare bindings missing for vault adapter');
    return vault;
  }

  if (ctx.env) {
    const vault = CloudflareVaultAdapter.attachIfCloud(ctx.env, undefined, vaultOpts(ctx));
    if (vault) return vault;
  }
  if (ctx.edgeHiveUrl) return new SurrealAdapter(ctx.edgeHiveUrl);
  if (typeof indexedDB !== 'undefined') return getIdbAdapter();
  return getMemoryAdapter();
}

export function describeSelected(adapter: StorageAdapter): AdapterKind {
  if (adapter instanceof CloudflareVaultAdapter) return 'vault';
  if (adapter instanceof SurrealAdapter) return 'surreal';
  const name = adapter.constructor.name;
  if (name === 'IndexedDBAdapter') return 'idb';
  return 'memory';
}
