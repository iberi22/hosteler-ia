// cloud.config.mjs — decide en build que implementacion del modulo cloud usa la app (src/cloud/types.ts).
//
// El alias `@fize/cloud-impl/*` apunta a:
//   - src/cloud/local/*                          -> sin nube (lo que trae el repo publico)
//   - ../private/cloud/src-astro/src/cloud/*     -> facturacion, creditos de IA, consumo y facturas SaaS
//
// FIZE_CLOUD:
//   - "1"      -> exige el modulo; falla el build si private/cloud no existe (deploy de la version cloud)
//   - "0"      -> fuerza el modo sin nube aunque el modulo exista (probar lo que ve el repo publico)
//   - sin fijar -> auto: usa el modulo si existe
//
// Lo usan astro.config.mjs (build y dev) y vitest.config.ts. tsconfig.json apunta siempre a local/* para
// el type-check: los dos lados implementan el mismo contrato (CloudServer / CloudClient).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CLOUD_IMPL_ALIAS = '@fize/cloud-impl';

const LOCAL_DIR = fileURLToPath(new URL('./src/cloud/local', import.meta.url));
export const PRIVATE_CLOUD_ROOT = fileURLToPath(new URL('../private/cloud/src-astro', import.meta.url));
const PRIVATE_DIR = fileURLToPath(new URL('../private/cloud/src-astro/src/cloud', import.meta.url));

/** @returns {{ enabled: boolean, dir: string }} */
export function resolveCloud(env = process.env) {
  const flag = env.FIZE_CLOUD;
  const present = existsSync(`${PRIVATE_DIR}/server.ts`) && existsSync(`${PRIVATE_DIR}/client.ts`);
  if (flag === '1' && !present) {
    throw new Error(`FIZE_CLOUD=1 pero el modulo cloud no existe en ${PRIVATE_DIR}`);
  }
  const enabled = flag === '0' ? false : present;
  return { enabled, dir: enabled ? PRIVATE_DIR : LOCAL_DIR };
}

/** Alias de Vite para `@fize/cloud-impl/{server,client}`. */
export function cloudAlias(env = process.env) {
  const { dir } = resolveCloud(env);
  return { find: new RegExp(`^${CLOUD_IMPL_ALIAS}/`), replacement: `${dir}/` };
}

/**
 * Paquetes que los archivos de private/ importan por nombre. private/ no tiene node_modules propio: sin
 * dedupe, Vite los buscaria subiendo desde private/ y no los encontraria (viven en src-astro/node_modules).
 */
export const CLOUD_DEDUPE = ['svelte', '@swal/ui', 'zod', 'astro'];
