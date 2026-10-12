#!/usr/bin/env node
// Compila con wrangler.e2e.jsonc (bindings locales, sin `AI`), exista o no un wrangler.jsonc real.
//
// Por que: `AI` es de tipo "remote" en @cloudflare/vite-plugin, o sea que no
// tiene simulador local. Al arrancar, el plugin abre una sesion remota de
// wrangler y exige CLOUDFLARE_API_TOKEN. En CI no hay token ni sesion
// guardada, y `astro preview` moria antes de que Playwright corriera un test:
//
//   Failed to start the remote proxy session ... necessary to set a
//   CLOUDFLARE_API_TOKEN environment variable for wrangler to work
//   -> Process from config.webServer was not able to start. Exit code: 1
//
// La app no necesita `AI` para compilar ni para la suite. Lo que si se conserva
// son SESSION (KV), SWAL_D1, SWAL_R2 y SWAL_KV, que es donde se persisten los
// datos que afirman los tests.
//
// DISENO: antes este script sobrescribia wrangler.jsonc con el de E2E y lo
// restauraba al final. Ahora wrangler.jsonc no se versiona (tiene ids reales) y
// astro.config.mjs acepta FIZE_WRANGLER_CONFIG: no se toca ningun archivo.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_CONFIG = 'wrangler.e2e.jsonc';

/** Los bindings que deben sobrevivir al build de E2E. */
const BINDINGS_REQUERIDOS = ['SESSION', 'SWAL_D1', 'SWAL_R2', 'SWAL_KV'];

const e2eConfig = readFileSync(join(root, E2E_CONFIG), 'utf8');

// Validar ANTES de compilar: si el config de E2E pierde un binding, el fallo
// tiene que verse aqui y no como un test raro que falla despues.
for (const b of BINDINGS_REQUERIDOS) {
  if (!e2eConfig.includes(`"binding": "${b}"`)) {
    console.error(`[build-ci] ${E2E_CONFIG} no declara el binding ${b}; se aborta`);
    process.exit(1);
  }
}
if (e2eConfig.includes('"binding": "AI"')) {
  console.error(`[build-ci] ${E2E_CONFIG} trae AI: necesitaria CLOUDFLARE_API_TOKEN`);
  process.exit(1);
}

const res = spawnSync('pnpm', ['build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FIZE_WRANGLER_CONFIG: E2E_CONFIG },
});
const codigo = res.status ?? 1;
if (codigo !== 0) console.error(`[build-ci] el build fallo (exit ${codigo})`);
else console.log(`[build-ci] build listo con ${E2E_CONFIG} (sin el binding AI)`);
process.exit(codigo);
