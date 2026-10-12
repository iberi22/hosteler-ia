// Bindings del Worker (D1/R2) para rutas que los usan directo, sin el adaptador de almacenamiento.
// Mismo mecanismo que `storageAdapter.ts`: Astro 6+ quito `locals.runtime.env`; el env sale de
// `cloudflare:workers`. En Node/tests ese import falla y queda `globalThis.__env` (o nada).
import type { CacheLike, R2Like } from './publicMenuSnapshot';
import type { D1Like } from './publicMenuPublish';

export interface WorkerBindings {
  SWAL_D1?: D1Like;
  SWAL_R2?: R2Like;
}

let pending: Promise<WorkerBindings | undefined> | null = null;

async function load(): Promise<WorkerBindings | undefined> {
  try {
    // @vite-ignore: solo resoluble en runtime workerd; en Node/tests falla y cae al catch
    const specifier = 'cloudflare:workers';
    const mod = await import(/* @vite-ignore */ specifier);
    const env = (mod as { env?: WorkerBindings }).env;
    if (env && (env.SWAL_R2 || env.SWAL_D1)) return env;
  } catch {
    /* fuera de workerd */
  }
  return (globalThis as Record<string, unknown>).__env as WorkerBindings | undefined;
}

export function getWorkerBindings(): Promise<WorkerBindings | undefined> {
  pending ??= load();
  return pending;
}

/** `caches.default` del Worker; null fuera de workerd. */
export function getWorkerCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}
