import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// El guardia que aborta el build: scripts/gen-csp-headers.mjs lo importa y lo aplica al
// dist/client/_headers escrito, y aqui se prueba con casos sinteticos (positivos y negativos).
import {
  CABECERAS_EXIGIDAS,
  parsearHeaders,
  problemasDeSeguridad,
} from '../../scripts/securityHeadersCheck.mjs';
import { HSTS_VALUE, X_CONTENT_TYPE_OPTIONS_VALUE, REFERRER_POLICY_VALUE } from './securityHeaders';

const headers = readFileSync(resolve(process.cwd(), 'public', '_headers'), 'utf8');

describe('guardia de cabeceras de seguridad (scripts/securityHeadersCheck.mjs)', () => {
  it('el _headers versionado pasa el guardia del build', () => {
    expect(problemasDeSeguridad(headers)).toEqual([]);
  });

  // scripts/securityHeadersCheck.mjs no puede importar TypeScript, asi que lleva su copia de los valores;
  // este test es lo que impide que las dos copias se separen (y con ellas el middleware y el build).
  it('los valores del guardia son los mismos que los del middleware (src/lib/securityHeaders.ts)', () => {
    expect(CABECERAS_EXIGIDAS).toEqual([
      ['strict-transport-security', HSTS_VALUE],
      ['x-content-type-options', X_CONTENT_TYPE_OPTIONS_VALUE],
      ['referrer-policy', REFERRER_POLICY_VALUE],
    ]);
  });

  it('acepta los nombres en cualquier caja (las cabeceras HTTP no distinguen mayusculas)', () => {
    const texto = [
      '/*',
      '  STRICT-TRANSPORT-SECURITY: max-age=31536000; includeSubDomains; preload',
      '  x-Content-Type-Options: nosniff',
      '  referrer-policy: strict-origin-when-cross-origin',
      '',
    ].join('\n');
    expect(problemasDeSeguridad(texto)).toEqual([]);
  });

  it('acepta los espacios de mas en el valor (mismo valor, otra maquetacion)', () => {
    const texto = [
      '/*',
      '  Strict-Transport-Security:   max-age=31536000;  includeSubDomains;  preload',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '',
    ].join('\n');
    expect(problemasDeSeguridad(texto)).toEqual([]);
  });

  it('aborta si no hay bloque `/*`', () => {
    const problemas = problemasDeSeguridad('/solo\n  X-Content-Type-Options: nosniff\n');
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('no existe el bloque global `/*`');
  });

  // El caso que la comprobacion de la ronda 1 dejaba pasar: HSTS existia, pero en una ruta suelta, asi que
  // el resto del sitio salia sin ella y el build terminaba bien.
  it('aborta si HSTS solo esta en una ruta suelta y no en `/*`', () => {
    const texto = [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '/solo',
      `  Strict-Transport-Security: ${HSTS_VALUE}`,
      '',
    ].join('\n');
    const problemas = problemasDeSeguridad(texto);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('no declara strict-transport-security');
  });

  it('aborta si el valor declarado no es el esperado', () => {
    const texto = [
      '/*',
      '  Strict-Transport-Security: max-age=60',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '',
    ].join('\n');
    const problemas = problemasDeSeguridad(texto);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('declara strict-transport-security: max-age=60');
    expect(problemas[0]).toContain(HSTS_VALUE);
  });

  it('aborta si `/*` declara una cabecera dos veces (Cloudflare concatenaria los valores)', () => {
    const texto = [
      '/*',
      `  X-Content-Type-Options: ${X_CONTENT_TYPE_OPTIONS_VALUE}`,
      `  X-Content-Type-Options: ${X_CONTENT_TYPE_OPTIONS_VALUE}`,
      `  Strict-Transport-Security: ${HSTS_VALUE}`,
      `  Referrer-Policy: ${REFERRER_POLICY_VALUE}`,
      '',
    ].join('\n');
    const problemas = problemasDeSeguridad(texto);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('declara x-content-type-options 2 veces');
  });

  // El fallo exacto de la ronda 1: `/local` y `/local/*` repetian nosniff y Referrer-Policy del bloque
  // global, y Cloudflare respondia `X-Content-Type-Options: nosniff, nosniff`.
  it('aborta si otro bloque repite una cabecera que ya pone `/*`', () => {
    const texto = [
      '/*',
      `  Strict-Transport-Security: ${HSTS_VALUE}`,
      `  X-Content-Type-Options: ${X_CONTENT_TYPE_OPTIONS_VALUE}`,
      `  Referrer-Policy: ${REFERRER_POLICY_VALUE}`,
      '/local',
      '  Cache-Control: public, max-age=0, must-revalidate, no-transform',
      `  X-Content-Type-Options: ${X_CONTENT_TYPE_OPTIONS_VALUE}`,
      `  Referrer-Policy: ${REFERRER_POLICY_VALUE}`,
      '',
    ].join('\n');
    const problemas = problemasDeSeguridad(texto);
    expect(problemas).toHaveLength(2);
    expect(problemas.join('\n')).toContain('el bloque /local repite x-content-type-options');
    expect(problemas.join('\n')).toContain('el bloque /local repite referrer-policy');
  });

  // Forma del archivo que ve el guardia DESPUES del build: gen-csp-headers.mjs anade el CSP por ruta y
  // conserva los bloques que ya traia public/_headers (Cache-Control, X-Frame-Options, Permissions-Policy).
  it('no marca como problema las rutas que el generador rellena con CSP', () => {
    const texto = [
      '/*',
      `  Strict-Transport-Security: ${HSTS_VALUE}`,
      `  X-Content-Type-Options: ${X_CONTENT_TYPE_OPTIONS_VALUE}`,
      `  Referrer-Policy: ${REFERRER_POLICY_VALUE}`,
      '/',
      '  Cache-Control: public, max-age=0, must-revalidate, no-transform',
      "  Content-Security-Policy: default-src 'self'",
      '/local',
      '  X-Frame-Options: DENY',
      '  Permissions-Policy: camera=(self), microphone=(), geolocation=()',
      "  Content-Security-Policy: default-src 'self'",
      '',
    ].join('\n');
    expect(problemasDeSeguridad(texto)).toEqual([]);
  });
});

describe('parsearHeaders (parser compartido con gen-csp-headers.mjs)', () => {
  it('devuelve bloques y cabeceras en orden, y no parte los valores que llevan `:`', () => {
    const texto = [
      '# comentario',
      '/*',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '/local',
      '  Cache-Control: public, max-age=0',
      '  Link: <https://ejemplo.test/material>; rel=preconnect',
      '',
    ].join('\n');
    const bloques = parsearHeaders(texto);
    expect(bloques.map((b) => b.ruta)).toEqual(['/*', '/local']);
    expect(bloques[0].cabeceras).toEqual([['Referrer-Policy', 'strict-origin-when-cross-origin']]);
    expect(bloques[1].cabeceras).toEqual([
      ['Cache-Control', 'public, max-age=0'],
      ['Link', '<https://ejemplo.test/material>; rel=preconnect'],
    ]);
  });

  it('rechaza un segundo bloque /* aunque repita una cabecera ya valida', () => {
    const texto = [
      '/*',
      '  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '',
      '/*',
      '  X-Content-Type-Options: nosniff',
      '',
    ].join('\n');
    const problemas = problemasDeSeguridad(texto);
    expect(problemas.some((p) => p.includes('bloques `/*`'))).toBe(true);
  });
});
