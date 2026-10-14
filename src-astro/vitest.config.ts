import { defineConfig } from 'vitest/config';
import path from 'path';
import { cloudAlias, CLOUD_DEDUPE, resolveCloud } from './cloud.config.mjs';

// Modulo cloud (src/cloud): con private/cloud presente sus tests corren aqui tambien; sin el, la suite es
// la de la app local-first. FIZE_CLOUD=0 fuerza el modo sin nube aunque el modulo exista.
const cloud = resolveCloud();

// Un unico destino para todos los aliases de builtins de Node.
const stubUrl = path.resolve(import.meta.dirname, './src/lib/node-builtins-stub.ts');

export default defineConfig({
  resolve: {
    dedupe: CLOUD_DEDUPE,
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      cloudAlias(),
      ...Object.entries({
      'astro:middleware': path.resolve(import.meta.dirname, './src/lib/astro-middleware-stub.ts'),

      // Builtins de Node -> el modulo nativo real (ver node-builtins-stub.ts).
      //
      // Bajo jsdom, Vite externaliza los builtins y los deja como stub VACIO:
      // `import crypto from 'node:crypto'` recibe undefined y
      // `import { readFileSync } from 'node:fs'` muere con
      // ERR_UNKNOWN_BUILTIN_MODULE. Eso tumbaba 25 de 57 suites —todas las que
      // arrastran storageAdapter -> storageRouter -> cloudflareVaultAdapter ->
      // @swal/vault— sin que llegara a correr un solo assert. NO era
      // node_modules desactualizado: `pnpm install --frozen-lockfile` no
      // cambiaba nada.
      //
      // Solo test: el build de Astro y el worker siguen viendo node:* nativo.
      ...Object.fromEntries(
        [
          'node:crypto', 'node:fs', 'node:path', 'node:url',
          'node:http', 'node:child_process', 'node:util',
          // saas.test.ts importa `fs` y `path` SIN prefijo. Un alias a 'path'
          // se resolveria contra si mismo en este archivo, de ahi el stub.
          'fs', 'path',
        ].map((id) => [id, stubUrl]),
      ),
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // `../cores/**`: tests de los cores que siguen vendorizados (hoy solo gos-client, sin tests propios).
    // @swal/ui y @swal/vault vienen de npm: sus tests viven en sus repos.
    include: [
      'src/**/*.{test,spec}.{ts,js}',
      '../cores/**/*.{test,spec}.{ts,js}',
      ...(cloud.enabled ? ['../private/cloud/src-astro/src/**/*.{test,spec}.{ts,js}'] : []),
    ],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});