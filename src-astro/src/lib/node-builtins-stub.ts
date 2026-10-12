// node-builtins-stub.ts — puente a los builtins REALES de Node, para el test.
//
// Por que existe: bajo jsdom, Vite externaliza cualquier builtin de Node y lo
// reemplaza por un stub VACIO. Entonces:
//
//   import crypto from 'node:crypto'   ->  default es undefined
//   import { readFileSync } from 'node:fs'  ->  ERR_UNKNOWN_BUILTIN_MODULE
//                                            "No such built-in module: node:"
//
// Eso tumbaba 25 de 57 suites (todas las que arrastran storageAdapter ->
// storageRouter -> cloudflareVaultAdapter -> @swal/vault) sin llegar a correr un
// solo assert. NO era node_modules desactualizado: `pnpm install
// --frozen-lockfile` no cambiaba nada.
//
// La solucion NO es simular la API. Una version anterior de este archivo
// exportaba randomBytes/createHash de mentira y dejo createCipheriv como
// undefined: las pruebas de persistencia del vault pasaban por el camino feliz
// y dejaban de comprobar el cifrado AES-GCM. Aqui entra el modulo nativo, tal
// cual.
//
// `process.getBuiltinModule()` (Node 22.3+) y no `createRequire`: importar
// 'node:module' aqui pasaba por la resolucion de Vite y fallaba por el mismo
// motivo que venia a arreglar.
//
// Un solo archivo sirve para TODOS los aliases porque el default export es el
// namespace de todos los builtins a la vez: `import path from 'path'` recibe un
// objeto que tiene `resolve` (de node:path) igual que `crypto.createCipheriv`
// (de node:crypto). Los nombres no colisionan entre modulos.
//
// Para anadir un builtin: un alias mas en vitest.config.ts y su `load(...)` aqui.
// Solo se reexportan los nombres que alguien importa hoy; anadir mas es barato.
//
// Alcance: solo lo usa vitest.config.ts. El build de Astro y el worker siguen
// viendo `node:*` nativo y no cambian.

type Builtin = Record<string, unknown>;

const proc = globalThis.process as unknown as
  | { getBuiltinModule?: (id: string) => unknown }
  | undefined;

const load = (id: string): Builtin => {
  const mod = proc?.getBuiltinModule?.(id) as Builtin | undefined;
  if (!mod) {
    throw new Error(
      `node-builtins-stub: no se pudo cargar ${id}. Este archivo solo existe como ` +
        'alias de vitest.config.ts; no debe importarse desde codigo de la app.',
    );
  }
  return mod;
};

const nodeCrypto = load('node:crypto') as typeof import('node:crypto');
const nodeFs = load('node:fs') as typeof import('node:fs');
const nodePath = load('node:path') as typeof import('node:path');
const nodeUrl = load('node:url') as typeof import('node:url');
const nodeHttp = load('node:http') as typeof import('node:http');
const nodeChildProcess = load('node:child_process') as typeof import('node:child_process');
const nodeUtil = load('node:util') as typeof import('node:util');

// --- node:crypto (los que usa @swal/vault) ---

export const {
  webcrypto,
  randomBytes,
  randomInt,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  sign,
} = nodeCrypto;

// --- node:fs / node:path / node:url ---

export const { readFileSync, existsSync, readdirSync } = nodeFs;
export const { dirname, join, resolve } = nodePath;
export const { fileURLToPath } = nodeUrl;

// --- seed-demo-idempotency (spinea un server de verdad) ---

export const { createServer } = nodeHttp;
export const { execFile } = nodeChildProcess;
export const { promisify } = nodeUtil;

// Namespace combinado: `import path from 'path'` y `import crypto from
// 'node:crypto'` reciben ambos el mismo objeto.
// nodePath va el ULTIMO a proposito: node:url y node:util exportan `resolve`,
// `format` y `parse` con otra semantica, y si pisan a los de node:path,
// `path.resolve(dir, '..')` devuelve basura (url.resolve) en vez de la ruta.
export default Object.assign(
  { nodeCrypto, nodeFs, nodePath, nodeUrl, nodeHttp, nodeChildProcess, nodeUtil },
  nodeCrypto,
  nodeFs,
  nodeUrl,
  nodeHttp,
  nodeChildProcess,
  nodeUtil,
  nodePath,
);