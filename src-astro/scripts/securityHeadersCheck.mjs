// securityHeadersCheck.mjs — cabeceras de transporte/seguridad que tienen que estar en dist/client/_headers.
//
// No se generan aqui (viven en public/_headers, que el build copia tal cual a dist/client), pero si faltan
// o si algun bloque las repite, el build FALLA (scripts/gen-csp-headers.mjs). Motivo: una pagina
// prerenderizada servida sin HSTS o sin nosniff no se nota hasta que ya hay trafico en HTTP, y repetir una
// cabecera en dos bloques que aplican a la misma ruta no es inocuo: Cloudflare CONCATENA los valores
// (`X-Content-Type-Options: nosniff, nosniff`), que es exactamente el fallo que trajo la regla `/local`.
//
// La comprobacion mira SOLO el bloque global `/*` (el que cubre todo lo que sirve Workers Assets). Que HSTS
// exista en `/solo-una-ruta` no sirve de nada: el resto del sitio saldria sin ella.
//
// Este modulo es .mjs y no puede importar src/lib/securityHeaders.ts (valores canonicos del middleware en
// TypeScript); los tests comparan las DOS copias para que no se separen (src/lib/genCspHeaders.test.ts).
//
// Cloudflare ordena los nombres de cabecera sin distinguir mayusculas, asi que aqui se normalizan a
// minusculas: `strict-transport-security` vale igual que `Strict-Transport-Security`.

/** @typedef {[string, string]} Cabecera */
/** @typedef {{ ruta: string, cabeceras: Cabecera[], comentario: string[] }} Bloque */

/** [nombre normalizado a minusculas, valor esperado] tal cual tienen que estar en el bloque `/*`.
 *  @type {Cabecera[]} */
export const CABECERAS_EXIGIDAS = [
  ['strict-transport-security', 'max-age=31536000; includeSubDomains; preload'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
];

/**
 * Parseo de un `_headers` al formato de bloques. Mismo formato que usa el generador para reescribir el
 * archivo: `{ ruta, cabeceras: [[nombre, valor], ...], comentario: [lineas] }` en el orden del archivo.
 * @param {string} texto
 * @returns {Bloque[]}
 */
export function parsearHeaders(texto) {
  /** @type {Bloque[]} */
  const bloques = [];
  /** @type {string[]} */
  let comentarioPendiente = [];
  for (const linea of texto.split('\n')) {
    if (linea.trim() === '' || linea.trimStart().startsWith('#')) {
      if (linea.trim() !== '') comentarioPendiente.push(linea);
      continue;
    }
    if (/^\s/.test(linea)) {
      const [nombre, ...resto] = linea.trim().split(':');
      bloques[bloques.length - 1]?.cabeceras.push([nombre, resto.join(':').trim()]);
    } else {
      bloques.push({ ruta: linea.trim(), cabeceras: [], comentario: comentarioPendiente });
      comentarioPendiente = [];
    }
  }
  return bloques;
}

/** Compara valores sin que importen los espacios de mas (mismo valor, distinta maquetacion). */
const normalizarValor = (valor) => valor.trim().replace(/\s+/g, ' ');

/**
 * Problemas de las cabeceras de seguridad en un `_headers` (lista vacia = correcto). Devuelve texto en vez
 * de un booleano para que el build pueda imprimir el motivo exacto y el test pueda afirmarlo.
 * @param {string} texto
 * @returns {string[]}
 */
export function problemasDeSeguridad(texto) {
  /** @type {string[]} */
  const problemas = [];
  const bloques = parsearHeaders(texto);
  const global = bloques.find((b) => b.ruta === '/*');
  if (!global) {
    problemas.push(
      'no existe el bloque global `/*`: lo que sirve Workers Assets saldria sin HSTS, sin nosniff y sin Referrer-Policy',
    );
    return problemas;
  }

  // Nombres que ya pone `/*`: ningun otro bloque puede repetirlos (Cloudflare concatenaria los valores).
  const delGlobal = new Set(global.cabeceras.map(([nombre]) => nombre.toLowerCase()));

  /** @type {Map<string, string[]>} */
  const declaradas = new Map(); // nombre normalizado -> valores declarados en `/*`
  for (const [nombre, valor] of global.cabeceras) {
    const clave = nombre.toLowerCase();
    if (!declaradas.has(clave)) declaradas.set(clave, []);
    declaradas.get(clave).push(valor);
  }
  for (const [clave, valores] of declaradas) {
    if (valores.length > 1) {
      problemas.push(
        `el bloque \`/*\` declara ${clave} ${valores.length} veces (${valores.join(' | ')}): Cloudflare concatenaria los valores`,
      );
    }
  }

  for (const [nombre, esperado] of CABECERAS_EXIGIDAS) {
    const valores = declaradas.get(nombre);
    if (!valores) {
      problemas.push(`el bloque \`/*\` no declara ${nombre} (esperado: ${esperado})`);
      continue;
    }
    if (normalizarValor(valores[0]) !== normalizarValor(esperado)) {
      problemas.push(`el bloque \`/*\` declara ${nombre}: ${valores[0]} (esperado: ${esperado})`);
    }
  }

  for (const bloque of bloques) {
    if (bloque.ruta === '/*') continue;
    for (const [nombre] of bloque.cabeceras) {
      const clave = nombre.toLowerCase();
      if (delGlobal.has(clave)) {
        problemas.push(
          `el bloque ${bloque.ruta} repite ${clave}, que ya pone \`/*\`: Cloudflare concatenaria los valores`,
        );
      }
    }
  }

  return problemas;
}
