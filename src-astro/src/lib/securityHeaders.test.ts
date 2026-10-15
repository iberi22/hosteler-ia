import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Mismo parser que usa el build (scripts/securityHeadersCheck.mjs): lo que valida el generador es lo que
// comprueba este test, sin una segunda implementacion que se pueda desviar.
import { parsearHeaders } from '../../scripts/securityHeadersCheck.mjs';
import {
  HSTS_VALUE,
  X_CONTENT_TYPE_OPTIONS_VALUE,
  REFERRER_POLICY_VALUE,
} from './securityHeaders';

// F12 — cabeceras de seguridad de lo que NO pasa por el Worker.
//
// Las paginas prerenderizadas y los estaticos los sirve Workers Assets y no ven el middleware: sus cabeceras
// salen de public/_headers, que el build copia a dist/client/_headers. Aqui se comprueba la fuente (el
// archivo versionado) porque un build completo no corre en vitest; scripts/gen-csp-headers.mjs aborta el
// build si alguna de las tres desaparece, y e2e/csp.spec.ts las afirma sobre la respuesta real.
//
// El valor de HSTS se compara con HSTS_VALUE (src/lib/securityHeaders.ts), el mismo que usa el middleware:
// si alguien cambia uno y no el otro, esto falla. `_headers` es texto plano y no puede importar nada.

const headers = readFileSync(resolve(process.cwd(), 'public', '_headers'), 'utf8');
const bloques = parsearHeaders(headers);

/** Cabeceras del bloque global `/*` (el que cubre estaticos y prerenderizadas), nombres en minusculas. */
function bloqueGlobal(archivo: string): Map<string, string> {
  const global = parsearHeaders(archivo).find((b) => b.ruta === '/*');
  expect(global, 'no hay regla global `/*` en public/_headers').toBeDefined();
  return new Map((global?.cabeceras ?? []).map(([nombre, valor]) => [nombre.toLowerCase(), valor]));
}

describe('public/_headers: cabeceras de seguridad de estaticos y prerenderizadas', () => {
  const cabeceras = bloqueGlobal(headers);

  it('manda HSTS en todo el sitio (mismo valor que el middleware)', () => {
    expect(cabeceras.get('strict-transport-security')).toBe(HSTS_VALUE);
    expect(HSTS_VALUE).toBe('max-age=31536000; includeSubDomains; preload');
    // Sin includeSubDomains, `preload` no vale; y sin preload, la cabecera no sirve para la lista.
    expect(HSTS_VALUE).toContain('includeSubDomains');
    expect(HSTS_VALUE).toContain('preload');
    expect(HSTS_VALUE).toMatch(/max-age=\d{5,}/);
  });

  it('manda nosniff y una Referrer-Policy explicita', () => {
    expect(cabeceras.get('x-content-type-options')).toBe(X_CONTENT_TYPE_OPTIONS_VALUE);
    expect(X_CONTENT_TYPE_OPTIONS_VALUE).toBe('nosniff');
    expect(cabeceras.get('referrer-policy')).toBe(REFERRER_POLICY_VALUE);
    expect(REFERRER_POLICY_VALUE).toBe('strict-origin-when-cross-origin');
  });

  it('no declara un CSP propio: el del build lo pone gen-csp-headers.mjs por ruta (con sus hashes)', () => {
    expect(headers).not.toContain('Content-Security-Policy');
    expect(headers).not.toContain('unsafe-inline');
  });

  // Un bloque que repite una cabecera que ya pone `/*` no la sustituye: Cloudflare CONCATENA los valores
  // (`X-Content-Type-Options: nosniff, nosniff`). Es lo que traia `/local` y `/local/*` antes de la ronda 2;
  // aqui se recorren TODOS los bloques del archivo para que no vuelva a colarse en ninguno.
  it('ningun otro bloque repite una cabecera que ya pone `/*` (Cloudflare concatenaria los valores)', () => {
    const global = new Set(
      bloques
        .filter((b) => b.ruta === '/*')
        .flatMap((b) => b.cabeceras.map(([nombre]) => nombre.toLowerCase())),
    );
    expect(global.size).toBeGreaterThan(0);
    const repetidas = bloques
      .filter((b) => b.ruta !== '/*')
      .flatMap((b) => b.cabeceras.map(([nombre]) => [b.ruta, nombre] as const))
      .filter(([, nombre]) => global.has(nombre.toLowerCase()))
      .map(([ruta, nombre]) => `${ruta} -> ${nombre}`);
    expect(repetidas).toEqual([]);
  });
});
