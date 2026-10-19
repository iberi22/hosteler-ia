// cspHashes.mjs — utilidades de CSP para el build.
// Este modulo es puro y vive aparte de gen-csp-headers.mjs para que los
// tests lo puedan importar y verificar sin los efectos colaterales de lectura de dist/.
import { createHash } from 'node:crypto';

export const sha256 = (texto) => `sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}`;

/** Hashes de los scripts y estilos inline que esta pagina lleva de verdad (sin comillas). */
export function hashesInline(html) {
  const scripts = new Set();
  const estilos = new Set();

  for (const m of html.matchAll(/<!--[\s\S]*?-->|<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>|<style[^>]*>([\s\S]*?)<\/style>/g)) {
    if (m[1] !== undefined) {
      scripts.add(sha256(m[1]));
    } else if (m[2] !== undefined) {
      estilos.add(sha256(m[2]));
    }
  }

  return { scripts, estilos };
}
