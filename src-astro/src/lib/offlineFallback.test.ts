import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideAccess } from '../middlewareGating';
import { CLIENT_MENU_PATH } from '../config/client';

/**
 * La pantalla /offline tiene que existir DE VERDAD, no solo como idea.
 *
 * Lo que se ve en produccion antes de este cambio: la PWA instala bien
 * (manifest 200, sw.js 200, 60 archivos precacheados) y aun asi no hay donde
 * caer cuando se pierde la red, porque (a) /offline daba 404 y (b) el service
 * worker no declaraba navigateFallback. Una PWA instalable que no funciona
 * offline es exactamente el fallo que el usuario no perdona.
 *
 * Estos tests fijan las tres piezas del contrato:
 *   1. la pagina se sirve con 200 y su HTML dice lo esencial;
 *   2. el service worker declara un destino de navegacion que EXISTE en el
 *      precache (si divergen, workbox aborta el build con `non-precached-url`);
 *   3. /offline no pide sesion: si la gating la cerrara, el fallback serviria
 *      un JSON de 401 al usuario sin conexion, que es peor que un 404.
 *
 * El HTML se lee del PRERENDERIZADO en `dist/`, no de la fuente: asi se prueba
 * lo que el service worker va a servir de verdad, con las mismas reglas que
 * Cloudflare. Si `dist/` no existe (test sin build previo) se salta esa parte
 * en vez de dar un falso rojo; el resto del contrato se comprueba igual.
 */

const raiz = process.cwd();
const OFFLINE_SRC = resolve(raiz, 'src', 'pages', 'offline.astro');
const OFFLINE_HTML = resolve(raiz, 'dist', 'client', 'offline', 'index.html');
const GEN_SW = resolve(raiz, 'scripts', 'gen-sw.mjs');
const SW_GENERADO = resolve(raiz, 'dist', 'client', 'sw.js');

const fuente = readFileSync(OFFLINE_SRC, 'utf-8');
// El script de la pantalla vive en src/lib/inlineScripts.ts (el CSP necesita su hash en build), asi que
// "el boton recarga de verdad" se comprueba en la constante Y que la pagina la inserta sin transformar.
const scriptsInline = readFileSync(resolve(raiz, 'src', 'lib', 'inlineScripts.ts'), 'utf-8');

/** El destino del fallback tal cual lo declara gen-sw.mjs. */
function fallbackDeclarado(): string | null {
  const gen = readFileSync(GEN_SW, 'utf-8');
  // Destino offline de las navegaciones (precacheFallback de las rutas de navegacion).
  const m = gen.match(/fallbackURL:\s*'([^']+)'/);
  return m ? m[1] : null;
}

describe('pagina /offline', () => {
  it('esta prerenderizada, sin lo cual nunca entra en el precache', () => {
    // `output: 'server'` no deja HTML en dist/client. El precache es de
    // archivos, y navigateFallback se resuelve contra el manifiesto: sin
    // prerender, generateSW aborta y la PWA se queda sin destino offline.
    expect(fuente).toMatch(/export const prerender = true/);
  });

  it('no depende de sesion ni de bindings: es alcanzable sin conexion', () => {
    const decision = decideAccess('/offline', null, 'free');
    expect(decision.kind).toBe('allow');
    // Sin sesion y sin tier: ni redireccion al login ni 401. Un fallback que
    // redirige a /login deja al usuario en un bucle sin red.
    expect(fuente).not.toMatch(/createStorageAdapter|Astro\.locals|resolveSession/);
  });

  it('ofrece acciones reales: reintentar y un enlace a la carta', () => {
    expect(fuente).toMatch(/id="reintentar"/);
    // El boton recarga de verdad; un enlace decorativo a 'javascript:void(0)'
    // habria pasado un chequeo de texto y no habria hecho nada.
    expect(scriptsInline).toMatch(/location\.reload\(\)/);
    expect(fuente).toMatch(/set:html=\{OFFLINE_RETRY_SCRIPT\}/);
    // El enlace se construye en build y el HTML prerenderizado lo lleva ya
    // resuelto (el test de abajo lo comprueba contra dist/).
    expect(fuente).toMatch(/href=\{cartaHref\}/);
    expect(fuente).toMatch(/const cartaHref = `/);
    // La ruta publica real de la carta es /{slug}/menu (src/pages/[slug]/menu.astro).
    expect(fuente).toMatch(/publicMenuBySlug\.ts/);
    // Por defecto, la carta de la clienta (src/config/client.ts), no un slug escrito a mano.
    expect(fuente).toMatch(/PUBLIC_CARTA_SLUG \|\| CLIENT\.slug/);
  });

  it('reutiliza el prepaint del tema en vez de inventar otro', () => {
    // El tema se aplica antes de pintar con este scriptinline. Copiarlo aqui
    // seria tener dos fuentes de verdad para el mismo comportamiento.
    expect(fuente).toMatch(/<BaseLayout/);
    expect(fuente).not.toMatch(/data-theme=["']dark["']/);
    // Sin barra lateral: es un tope, no un sitio por el que pasear.
    expect(fuente).toMatch(/showNav=\{false\}/);
  });

  it('es accesible: un solo h1, estados nombrados y sin emojis', () => {
    // Un unico h1: el esqueleto lo anuncia como titulo de la pagina.
    expect((fuente.match(/<h1/g) ?? []).length).toBe(1);
    expect(fuente).toMatch(/aria-labelledby="offline-titulo"/);
    expect(fuente).toMatch(/aria-live="polite"/);
    expect(fuente).toMatch(/role="status"/);
    // El foco visible lo aporta el layout (WCAG 2.4.7); no se fija aqui.
    expect(fuente).not.toMatch(/outline:\s*none/);
    // Sin emojis: el tono del producto es el del tema Bone, no el de una
    // etiqueta de utilidad.
    expect(fuente).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('los botones secondary usan una clase que EXISTE en el <style>', () => {
    // Un `.btn-secondary` en el CSS con `btn-secundario` en el HTML compila
    // sin error, no lo ve astro check, y deja el enlace con el color azul de
    // la user-agent sheet: se ve bien en el codigo y roto en pantalla. Se
    // comprueba que cada clase usada en el markup tenga su regla.
    const estilos = fuente.slice(fuente.indexOf('<style>'));
    const usadas = [...fuente.matchAll(/class="(btn[^"]*)"/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean);
    expect(usadas.length).toBeGreaterThan(0);
    for (const clase of usadas) {
      expect(estilos, `falta la regla .${clase} en el <style>`).toMatch(
        new RegExp(`\\.${clase}[\\s{]`)
      );
    }
  });

  it('el boton secundario anula el color de enlace del navegador', () => {
    // `a:-webkit-any-link` (0,1,1) gana a un selector de clase (0,1,0).
    // El comentario se admite entre las declaraciones, asi que se quita antes
    // de comprobar: si no, el test midiria como esta redactado el CSS y no si
    // el enlace sale del color del tema.
    const bloque = fuente
      .slice(fuente.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const regla = bloque.match(/\.btn-secundario\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(regla).toMatch(/text-decoration:\s*none/);
    expect(regla).toMatch(/color:\s*var\(--swal-text/);
  });

  it('el color sale de los tokens Bone, no de hex fijados en el estilo', () => {
    // Los valores hex que aparecen son los FALLBACKS de un var(): si el core
    // @swal/ui no cargara, son lo unico que el usuario veria. Eso se permite;
    // un color tematico escrito sin var() es lo que no se permite.
    const estilos = fuente.slice(fuente.indexOf('<style>'));
    const varUsos = estilos.match(/var\(--swal-[a-z-]+/g) ?? [];
    expect(varUsos.length).toBeGreaterThanOrEqual(10);
    expect(estilos).toMatch(/var\(--swal-accent-contrast/);
    expect(estilos).toMatch(/var\(--swal-text-secondary/);
  });
});

describe('service worker', () => {
  it('declara un destino de navegacion que EXISTE en el precache', () => {
    const fallback = fallbackDeclarado();
    expect(fallback).not.toBeNull();
    // La resolucion de workbox prueba la URL tal cual y la URL con '.html'
    // anadido, no la ruta desnuda. Sin build previo no se puede comprobar el
    // precache, pero el valor sigue siendo el que se espera.
    expect(fallback).toBe('/offline/index.html');
  });

  it('el build genera el sw enlazando ese destino al precache', () => {
    if (!existsSync(SW_GENERADO)) {
      // Sin `pnpm build` no hay dist/: se comprueba arriba, con el codigo.
      expect(fallbackDeclarado()).toBe('/offline/index.html');
      return;
    }
    const sw = readFileSync(SW_GENERADO, 'utf-8');
    // Las dos mitades del contrato: la pagina esta PRECACHEADA y el SW la usa
    // como destino. Con solo una de las dos, workbox o el runtime falla.
    expect(sw).toMatch(/PrecacheFallbackPlugin\(\{fallbackURL:"\/offline\/index\.html"\}\)/);
    expect(sw).toMatch(/url:"offline\/index\.html",revision:/);
    // Regresion 2026-10-02: `navigateFallback` (NavigationRoute + createHandlerBoundToURL) servia
    // /offline para TODA navegacion SSR con la red bien. La pagina offline es solo para cuando falla la red.
    expect(sw).not.toMatch(/createHandlerBoundToURL|NavigationRoute/);
  });

  it('el fallback no secuestra la API ni sustituye paginas con red', () => {
    // Solo las navegaciones (`request.mode === 'navigate'`) tienen destino offline; un fetch a /api/
    // nunca recibe el HTML de "sin conexion". Y no hay `navigateFallback`, que lo serviria siempre.
    const gen = readFileSync(GEN_SW, 'utf-8');
    expect(gen).toMatch(/request\.mode === 'navigate'/);
    expect(gen).not.toMatch(/^\s*navigateFallback\s*:/m);
  });
});

describe('HTML prerenderizado de /offline', () => {
  const hayBuild = existsSync(OFFLINE_HTML);

  it('responde con el contenido esencial', () => {
    if (!hayBuild) {
      // Sin build, lo que se afirma aqui ya esta comprobado sobre el fuente.
      expect(fuente).toMatch(/No hay conexión a internet/);
      return;
    }
    const html = readFileSync(OFFLINE_HTML, 'utf-8');
    // El mensaje, en espanol y sin emojis.
    expect(html).toMatch(/No hay conexión a internet/);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    // Un solo h1 en el HTML servido, no solo en el fuente.
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    // Las dos acciones, con su href resuelto en build.
    expect(html).toMatch(/id="reintentar"/);
    expect(html).toMatch(/location\.reload\(\)/);
    expect(html).toContain(`href="${CLIENT_MENU_PATH}"`);
    // El tema lo resuelve el layout, y el HTML no fija tema oscuro.
    expect(html).toMatch(/lang="es"/);
    // Solo la etiqueta real de <html>. Un `/<html[^>]+data-theme/` mas laxo
    // casaba con el comentario de BaseLayout que DOCUMENTA el antiguo bug
    // (`<html data-theme="dark">`), y daba un falso rojo legitimo.
    const tagHtml = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
    expect(tagHtml).not.toMatch(/data-theme/);
    // Es una pagina servible: documento completo con head y body.
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it('devuelve 200 como ruta /offline, no un 404', () => {
    if (!hayBuild) {
      expect(fuente).toMatch(/export const prerender = true/);
      return;
    }
    // Astro solo emite el archivo si la ruta se resolvio. El hecho de que
    // exista dist/client/offline/index.html ES la prueba de que /offline se
    // sirve: antes de este cambio ese archivo no se generaba y el GET daba 404.
    const html = readFileSync(OFFLINE_HTML, 'utf-8');
    expect(html.length).toBeGreaterThan(500);
    expect(html).toMatch(/<title>Sin conexión/);
  });
});
