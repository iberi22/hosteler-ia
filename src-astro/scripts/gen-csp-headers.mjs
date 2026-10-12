// gen-csp-headers.mjs — cabecera Content-Security-Policy para las paginas prerenderizadas.
//
// Astro emite el CSP por pagina (`security.csp`), pero en una ruta prerenderizada no hay Worker que ponga
// la cabecera: la unica salida es el <meta http-equiv="content-security-policy"> del HTML. Y un <meta> no
// cubre todo (frame-ancestors se ignora, y no aplica a peticiones no-HTML).
//
// Cloudflare Workers Assets SI aplica dist/client/_headers (de ahi salen hoy X-Frame-Options y
// Cache-Control de /local/*, verificados en produccion), asi que este paso post-build copia la politica
// que Astro ya calculo para cada HTML a una regla de `_headers`. Asi las paginas prerenderizadas llevan
// cabecera con los hashes correctos de su propio build.
//
// Dos detalles que no son opcionales:
//   - Cloudflare rechaza cualquier linea de _headers de mas de 2000 caracteres (MAX_LINE_LENGTH en
//     workers-shared). La politica de Astro junta los hashes de TODAS las paginas (script-src ~600 y
//     style-src ~1300) y no cabe: aqui se recorta a los hashes de los scripts/estilos inline QUE ESA
//     PAGINA TIENE. El <meta> se queda con la lista completa, y el navegador aplica la interseccion de
//     las dos politicas, asi que recortar la cabecera no afloja nada. Si aun asi no cabe, el build FALLA.
//   - Si un HTML prerenderizado no trae politica, el build FALLA: esa pagina saldria sin CSP y nadie se
//     enteraria hasta mirar la cabecera en produccion.
// Las reglas existentes (Cache-Control, X-Frame-Options...) se conservan: la cabecera se anade al bloque
// que ya tiene esa ruta, o se crea uno nuevo si no existe. El archivo es idempotente entre builds.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const client = join(root, 'dist', 'client');
const headersFile = join(client, '_headers');
const MAX_LINE_LENGTH = 2000; // MAX_LINE_LENGTH de workers-shared/utils/configuration/constants.ts

function htmls(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmls(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Ruta del HTML en el servidor de assets. `index.html` se sirve con y sin el sufijo. */
function rutasDe(file) {
  const rel = relative(client, file).split(sep).join('/');
  const dir = rel.replace(/\/?index\.html$/, '');
  const conBarra = dir ? `/${dir}/` : '/';
  const index = `${dir ? `/${dir}` : ''}/index.html`;
  return [conBarra, index];
}

function desescapar(texto) {
  return texto
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const sha256 = (texto) => `sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}`;

function politicaDe(html) {
  const meta = html.match(/<meta http-equiv="content-security-policy" content="([^"]*)"/i);
  return meta ? desescapar(meta[1]) : null;
}

/** Hashes de los scripts y estilos inline que esta pagina lleva de verdad (sin comillas). */
function hashesInline(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => sha256(m[1]));
  const estilos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => sha256(m[1]));
  return { scripts: new Set(scripts), estilos: new Set(estilos) };
}

/** La politica de Astro, con `script-src`/`style-src` recortados a los hashes de ESTA pagina. */
function politicaRecortada(politica, hashes) {
  return politica
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((directiva) => {
      const [nombre, ...valores] = directiva.split(/\s+/);
      if (nombre !== 'script-src' && nombre !== 'style-src') return directiva;
      const propios = nombre === 'script-src' ? hashes.scripts : hashes.estilos;
      const recortados = valores.filter((v) => !/^'sha256-/.test(v) || propios.has(v.replace(/'/g, '')));
      return [nombre, ...recortados].join(' ');
    })
    .join('; ');
}

const paginas = htmls(client).map((file) => {
  const html = readFileSync(file, 'utf8');
  const politica = politicaDe(html);
  if (!politica) {
    console.error(`[gen-csp-headers] ${relative(root, file)} no trae <meta http-equiv="content-security-policy">.`);
    console.error('[gen-csp-headers] Sin politica no se puede emitir la cabecera: el build se aborta.');
    process.exit(1);
  }
  return { file, html, rutas: rutasDe(file), politica: politicaRecortada(politica, hashesInline(html)) };
});

// Parseo del _headers que deja el build (public/_headers + lo que inyecta el adaptador).
// Cada bloque: { ruta, cabeceras: [[nombre, valor], ...] } en el mismo orden del archivo.
const bloques = [];
let comentarioPendiente = [];
for (const linea of readFileSync(headersFile, 'utf8').split('\n')) {
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

const cspPorRuta = new Map();
for (const { rutas, politica } of paginas) {
  for (const ruta of rutas) {
    const previa = cspPorRuta.get(ruta);
    if (previa && previa !== politica) {
      console.error(`[gen-csp-headers] dos paginas con la misma ruta (${ruta}) y CSP distinta: no se puede emitir.`);
      process.exit(1);
    }
    cspPorRuta.set(ruta, politica);
  }
}

let anadidas = 0;
for (const [ruta, politica] of cspPorRuta) {
  const linea = `  Content-Security-Policy: ${politica}`;
  if (linea.length > MAX_LINE_LENGTH) {
    console.error(`[gen-csp-headers] la cabecera de ${ruta} mide ${linea.length} caracteres (maximo ${MAX_LINE_LENGTH}).`);
    console.error('[gen-csp-headers] Cloudflare descartaria esa linea: hay que recortar hashes o directivas.');
    process.exit(1);
  }
  const cabecera = ['Content-Security-Policy', politica];
  const existente = bloques.find((b) => b.ruta === ruta);
  if (!existente) {
    bloques.push({ ruta, cabeceras: [cabecera], comentario: [] });
    anadidas++;
    continue;
  }
  const i = existente.cabeceras.findIndex(([n]) => n.toLowerCase() === 'content-security-policy');
  if (i === -1) {
    existente.cabeceras.push(cabecera);
    anadidas++;
  } else {
    // Idempotente: si ya estaba (build repetido), se reescribe igual.
    existente.cabeceras[i] = cabecera;
  }
}

const salida = [];
for (const bloque of bloques) {
  if (bloque.comentario?.length) salida.push(...bloque.comentario);
  salida.push(bloque.ruta);
  for (const [nombre, valor] of bloque.cabeceras) salida.push(`  ${nombre}: ${valor}`);
}
writeFileSync(headersFile, `${salida.join('\n')}\n`);

// El <meta> se queda como respaldo (viaja con el HTML: el service worker lo precachea y aplica aunque no
// haya cabecera), pero SIN `frame-ancestors`: en un <meta> el navegador la ignora y lo avisa por consola
// en cada pagina, y la suite de /local/* exige consola limpia. La directiva si va en la cabecera, que es
// donde se aplica.
let metasLimpiados = 0;
for (const { file, html } of paginas) {
  const limpio = html.replace(/(<meta http-equiv="content-security-policy" content="[^"]*?)frame-ancestors[^;]*;/, '$1');
  if (limpio !== html) {
    writeFileSync(file, limpio);
    metasLimpiados++;
  }
}

// Comprobacion final: toda pagina prerenderizada tiene que tener su cabecera en el archivo escrito.
const escrito = readFileSync(headersFile, 'utf8');
const faltan = [...cspPorRuta.keys()].filter((ruta) => {
  const i = escrito.indexOf(`\n${ruta}\n`);
  return i === -1 || !escrito.slice(i, i + MAX_LINE_LENGTH + 200).includes('Content-Security-Policy:');
});
if (faltan.length > 0) {
  console.error(`[gen-csp-headers] rutas sin CSP en _headers: ${faltan.join(', ')}`);
  process.exit(1);
}

const maxLinea = Math.max(...[...cspPorRuta.values()].map((p) => p.length + '  Content-Security-Policy: '.length));
console.log(
  `[gen-csp-headers] ${paginas.length} paginas prerenderizadas con CSP en _headers (${anadidas} reglas nuevas, ` +
    `linea mas larga ${maxLinea}/${MAX_LINE_LENGTH}, ${metasLimpiados} <meta> sin frame-ancestors).`,
);
