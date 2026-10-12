#!/usr/bin/env node
// Genera un codigo de activacion para publicar la carta de un nodo local (NODO-LOCAL.md §2.5).
//
//   node scripts/activation-code.mjs                 # codigo para cualquier slug
//   node scripts/activation-code.mjs mi-restaurante  # codigo amarrado a ese slug (recomendado)
//   node scripts/activation-code.mjs mi-restaurante --local   # contra la D1 local (pruebas)
//
// Imprime el codigo UNA vez (se le entrega al restaurante; no se guarda en ningun lado) y el comando
// `wrangler d1 execute` que inserta SOLO su SHA-256. Este script no llama a Cloudflare: el operador
// revisa y ejecuta el comando desde src-astro/.
//
// La normalizacion y el hash son los mismos de `src/lib/publicMenuPublish.ts`
// (`normalizeActivationCode`, `hashActivationCode`); un test los amarra.
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_BODY = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 40 bits aleatorios -> 8 caracteres Crockford -> FZ-XXXX-XXXX.
 * @param {Uint8Array} [bytes] 5 bytes (solo para pruebas; por defecto `randomBytes(5)`)
 * @returns {string}
 */
export function generateActivationCode(bytes = new Uint8Array(randomBytes(5))) {
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let body = '';
  for (let i = 7; i >= 0; i--) body += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return `FZ-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeActivationCode(raw) {
  let s = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 10 && s.startsWith('FZ')) s = s.slice(2);
  if (s.length !== 8) return null;
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!CROCKFORD_BODY.test(s)) return null;
  return `FZ-${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * @param {string} canonical
 * @returns {string}
 */
export function hashActivationCode(canonical) {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * @param {unknown} slug
 * @returns {boolean}
 */
export function validSlug(slug) {
  return typeof slug === 'string' && slug.length >= 3 && slug.length <= 60 && SLUG_PATTERN.test(slug);
}

/**
 * Comando para el operador. Solo hex y un slug validado: nada que escapar en el SQL.
 * @param {string} hash
 * @param {string | null} slug
 * @param {string} nowIso
 * @param {'--remote' | '--local'} [target]
 * @returns {string}
 */
export function buildInsertCommand(hash, slug, nowIso, target = '--remote') {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('hash invalido');
  if (slug !== null && !validSlug(slug)) throw new Error('slug invalido');
  const slugSql = slug === null ? 'NULL' : `'${slug}'`;
  const sql = `INSERT INTO public_menu_activation (code_hash, slug, created_at) VALUES ('${hash}', ${slugSql}, '${nowIso}');`;
  return `npx wrangler d1 execute fize-db ${target} --command "${sql}"`;
}

/** @param {string[]} argv */
function main(argv) {
  const local = argv.includes('--local');
  const slug = argv.find((a) => !a.startsWith('--')) ?? null;
  if (slug !== null && !validSlug(slug)) {
    console.error(`Slug inválido: "${slug}". Solo minúsculas sin tildes, números y guiones (3 a 60).`);
    process.exit(1);
  }
  const code = generateActivationCode();
  const hash = hashActivationCode(code);
  const cmd = buildInsertCommand(hash, slug, new Date().toISOString(), local ? '--local' : '--remote');
  console.log('Código de activación (entrégalo al restaurante; no se vuelve a mostrar):');
  console.log('');
  console.log(`  ${code}`);
  console.log('');
  console.log(slug ? `Solo sirve para el enlace /${slug}/menu, una vez.` : 'Sirve para cualquier enlace libre, una vez.');
  console.log('');
  console.log('Registra el hash en D1 (desde src-astro/):');
  console.log('');
  console.log(`  ${cmd}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
