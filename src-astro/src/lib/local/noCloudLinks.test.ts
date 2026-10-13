import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// QA pre-entrega 2026-10-13 #2 y #4: en modo local no hay cuenta, asi que un enlace a
// /dashboard o /login expulsa al duenno a una pantalla que no existe para el.
// El caso real fue "Imprimir QR" -> /dashboard/tables/print -> /login. Este test recorre las
// pantallas y componentes de /local/ y falla si aparece un enlace (o un prop de enlace)
// a la nube. Los comentarios se strip-ean: explicar por que NO se enlaza es correcto.

const ROOT_DIRS = ['src/pages/local', 'src/components/local'];
const EXTRA_FILES = ['src/layouts/LocalLayout.astro'];
const CLOUD_PATH = /["'`](\/(?:dashboard|login|register)\b[^"'`\s]*)/g;

function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `//` de comentario, pero no el de un esquema (`https://`).
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function filesUnder(abs: string): string[] {
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    return /\.(astro|svelte|ts)$/.test(entry.name) ? [child] : [];
  });
}

describe('modo local sin enlaces a la nube', () => {
  it('ninguna pantalla de /local/* enlaza a /dashboard, /login ni /register', () => {
    const root = path.resolve(import.meta.dirname, '..', '..', '..');
    const files = [
      ...ROOT_DIRS.flatMap((rel) => filesUnder(path.join(root, rel))),
      ...EXTRA_FILES.map((rel) => path.join(root, rel)),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const match of src.matchAll(CLOUD_PATH)) {
        offenders.push(`${path.relative(root, file)} -> ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
