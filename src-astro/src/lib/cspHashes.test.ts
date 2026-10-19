import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256, hashesInline } from '../../scripts/cspHashes.mjs';

const computeSha256 = (texto: string) => `sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}`;

describe('cspHashes.mjs', () => {
  it('1. Pagina simple: un script y un estilo inline producen sus hashes exactos', () => {
    const html = '<html><head><style>body{color:red;}</style></head><body><script>console.log("hola");</script></body></html>';
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(1);
    expect(scripts.has(computeSha256('console.log("hola");'))).toBe(true);
    expect(estilos.size).toBe(1);
    expect(estilos.has(computeSha256('body{color:red;}'))).toBe(true);
  });

  it('2. Un comentario que contiene <script> antes del script real: solo se obtiene el hash del real', () => {
    const html = '<head><!-- ejemplo: <script> aqui --><script>console.log(1)</script></head>';
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(1);
    expect(scripts.has(computeSha256('console.log(1)'))).toBe(true);
    expect(estilos.size).toBe(0);
  });

  it('3. Un comentario que contiene <style> entre dos estilos reales: ambos reales estan presentes y nada mas', () => {
    const html = '<style>a{}</style><!-- <style> --><style>b{}</style>';
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(0);
    expect(estilos.size).toBe(2);
    expect(estilos.has(computeSha256('a{}'))).toBe(true);
    expect(estilos.has(computeSha256('b{}'))).toBe(true);
  });

  it('4. Un script cuyo cuerpo contiene <!-- dentro de un string de JS se hashea completo', () => {
    const cuerpo = 'const x = "<!-- y"; console.log(x);';
    const html = `<script>${cuerpo}</script><!-- fin -->`;
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(1);
    expect(scripts.has(computeSha256(cuerpo))).toBe(true);
    expect(estilos.size).toBe(0);
  });

  it('5. Un <script> comentado por completo se ignora, mientras que el siguiente real se hashea', () => {
    const html = '<!-- <script>hidden()</script> --><script>visible()</script>';
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(1);
    expect(scripts.has(computeSha256('visible()'))).toBe(true);
    expect(estilos.size).toBe(0);
  });

  it('6. <script src="..."> no se hashea; <script type="application/ld+json"> si se hashea', () => {
    const ldjson = '{"@context":"https://schema.org"}';
    const html = `<script src="/a.js"></script><script type="application/ld+json">${ldjson}</script>`;
    const { scripts, estilos } = hashesInline(html);
    expect(scripts.size).toBe(1);
    expect(scripts.has(computeSha256(ldjson))).toBe(true);
    expect(estilos.size).toBe(0);
  });

  it('7. sha256("") equivale al hash vacio estandar (evita que el formato cambie)', () => {
    expect(sha256('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});
