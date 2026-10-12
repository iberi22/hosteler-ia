import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_URL } from '../lib/contact';
import { CLIENT } from '../config/client';
import { themeBootScript } from '@swal/ui/theme-boot';

/**
 * Contrato visual de la landing y del menu lateral. Lo que se fija aqui son
 * los defectos que la auditoria con capturas encontro en produccion:
 * CTA anidados en enlaces, tarjetas en fila fija que no caben en movil,
 * emojis como iconos y un menu sin seccion activa.
 */
const src = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf-8');
const landing = src('components', 'Landing.svelte');
const layout = src('layouts', 'BaseLayout.astro');
const ticker = src('components', 'GlobalTicker.svelte');
const index = src('pages', 'index.astro');
const contact = src('lib', 'contact.ts');
// El menu es AppShell/MobileNav del core @swal/ui: su CSS y su marcado se
// comprueban en la fuente del core, y BaseLayout solo debe adoptarlo.
const core = (...p: string[]) => readFileSync(resolve(process.cwd(), 'node_modules', '@swal', 'ui', 'src', ...p), 'utf-8');
const mobileNav = core('components', 'MobileNav.svelte');
const appShell = core('components', 'AppShell.svelte');
const navLib = core('lib', 'nav.js');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('landing', () => {
  it('una sola h1 y secciones con titulo propio', () => {
    expect(landing.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(landing).toContain('Orden en tu cocina. Gratis. Tus datos son tuyos.');
    expect(landing.match(/<h2[\s>]/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it('los CTA son enlaces, no un <button> dentro de un <a>', () => {
    expect(landing).not.toMatch(/<a[^>]*>\s*<Button/);
    expect(landing).toMatch(/<Button href=\{START_URL\} variant="primary"[^>]*>Empezar gratis, sin registrarme/);
    expect(landing).toMatch(/\{CONTACT_EMAIL\}/);
    expect(landing).toMatch(/<Button href=\{DEMO_URL\} variant="secondary"[^>]*>Ver la carta demo/);
  });

  it('CONTACT_URL vive en un solo sitio y no apunta al registro cerrado', () => {
    expect(contact).toMatch(/export const CONTACT_URL =\s*'mailto:hola@swal\.network\?subject=/);
    // La carta de ejemplo sale de la config de la clienta, no de un literal.
    expect(contact).toContain('DEMO_URL = CLIENT_MENU_PATH');
    expect(DEMO_URL).toBe(`/${CLIENT.slug}/menu`);
    expect(landing).not.toMatch(/mailto:|wa\.me/);
    expect(landing).not.toContain('/register');
  });

  it('no enlaza a paginas que no existen (directorio, politicas)', () => {
    expect(landing).toContain('Próximamente');
    for (const dead of ['/cerca', '/privacidad', '/terminos', '/registrar']) {
      expect(landing).not.toContain(`href="${dead}`);
    }
  });

  it('privacidad: solo el texto permitido hoy (ALCANCE.md 5.2)', () => {
    expect(landing).toContain('Tus datos se guardan cifrados desde el primer registro.');
    expect(landing).toContain('No vendemos ni usamos tus datos.');
    expect(landing).toContain('hoy SWAL custodia las llaves de cifrado');
    expect(landing).not.toMatch(/extremo a extremo|conocimiento cero|solo t[uú] puedes leer/i);
  });

  it('colores solo por tokens: sin hex ni blanco fijo', () => {
    expect(landing).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(landing).toContain('var(--swal-on-accent)');
  });

  it('usa iconos SVG, no emojis', () => {
    expect(landing).not.toMatch(EMOJI);
    expect(landing).toContain('<Icon name={f.icon}');
  });

  it('esta prerenderizada y sin islas ni ticker de estado simulado', () => {
    expect(index).toContain('export const prerender = true');
    expect(index).not.toMatch(/client:|Astro\.(cookies|locals|redirect)/);
    expect(index).not.toContain('GlobalTicker');
  });

  it('SEO: titulo, descripcion y canonica de LANDING.md', () => {
    expect(index).toContain('title="Fize — Orden en tu cocina, gratis"');
    expect(index).toMatch(/description="Carta digital con QR[^"]{0,160}"/);
    expect(layout).toContain('property="og:title"');
    expect(layout).toContain('property="og:description"');
    expect(layout).toContain('<html lang="es"');
  });

  it('la marca se escribe Fize/Fi’ze, nunca en mayusculas', () => {
    for (const s of [landing, ticker]) {
      expect(s).not.toMatch(/FI['’]?ZE/);
    }
  });
});

describe('menu lateral', () => {
  it('BaseLayout adopta el shell del core y no lleva menu propio', () => {
    // StaffShell envuelve el AppShell del core y le anade "Cerrar sesion".
    expect(layout).toContain('import StaffShell from "../components/StaffShell.svelte"');
    expect(layout).toMatch(/<StaffShell items=\{NAV\} \{currentPath\}[^>]*client:load>/);
    expect(readFileSync(resolve(__dirname, 'StaffShell.svelte'), 'utf-8')).toContain("import { AppShell } from '@swal/ui'");
    expect(layout).not.toContain('class="nav-item"');
    expect(layout).not.toContain('nav-toggle');
  });

  it('marca la seccion actual para lectores de pantalla', () => {
    expect(mobileNav).toMatch(/aria-current=\{active \? 'page' : undefined\}/);
  });

  it('sin currentPath explicito, la seccion sale de la URL', () => {
    // Mesas, Pedidos, Cocina y Analitica no pasaban currentPath y su item
    // nunca se marcaba.
    expect(layout).toMatch(/currentPath = Astro\.url\.pathname/);
  });

  it('la landing tiene item propio, y "/" no marca todo el menu', () => {
    expect(layout).toMatch(/href: "\/", label: "Inicio"/);
    expect(navLib).toMatch(/href === '\/' \|\| item\.exact\) return currentPath === href/);
  });

  it('usa iconos SVG, no emojis', () => {
    const nav = mobileNav.slice(mobileNav.indexOf('<nav'), mobileNav.indexOf('</nav>'));
    expect(nav).not.toMatch(EMOJI);
    expect(nav).toContain('<Icon');
    expect(layout.slice(layout.indexOf('const NAV'), layout.indexOf('---\n\n<!doctype'))).not.toMatch(EMOJI);
  });

  it('el activo lleva un indicador mas alla del velo de fondo', () => {
    expect(mobileNav).toMatch(/a\.nav-item\.active\s*\{[^}]*box-shadow:\s*inset/);
  });
});

describe('menu movil', () => {
  const movil = mobileNav.slice(mobileNav.indexOf('@media (max-width: 768px)'));

  it('es un menu desplegable, no una fila con scroll que corta items', () => {
    // Medido a 390px con la fila desplazable: 1004px de contenido en 390 de
    // ancho y "Cocina" terminaba en x=416, cortado contra el borde.
    expect(movil.slice(0, 4000)).not.toMatch(/overflow-x:\s*auto/);
    expect(movil).toMatch(/\.nav\s*\{[^}]*display:\s*grid/);
    // @swal/ui 0.2.0 (npm): con `html.js` el menu parte plegado salvo data-nav='open'.
    expect(movil).toMatch(/:global\(html\.js\) \.swal-mobile-nav:not\(\[data-nav='open'\]\) \.nav\s*\{\s*display:\s*none/);
  });

  it('el boton expone su estado y a que controla', () => {
    expect(mobileNav).toContain('aria-controls={id}');
    expect(mobileNav).toContain('aria-expanded={open}');
  });

  it('se cierra con Escape', () => {
    expect(mobileNav).toMatch(/e\.key === 'Escape' && open/);
  });

  it('sin JS el menu queda abierto y el boton no se pinta', () => {
    // Sin `html.js` (lo pone el script de arranque del tema antes de pintar) el boton no se pinta y el menu
    // queda abierto; con `html.js` el boton se muestra.
    expect(movil).toMatch(/\.nav-toggle,\s*\.nav-bar\.has-lead \.nav-toggle\s*\{\s*display:\s*none/);
    expect(movil).toMatch(/:global\(html\.js\) \.nav-toggle/);
    expect(themeBootScript()).toContain('classList.add("js")');
  });

  it('el boton cumple el objetivo tactil de 44px', () => {
    expect(movil).toMatch(/\.nav-toggle\s*\{[^}]*min-height:\s*44px/);
  });

  it('la columna lateral usa la superficie del tema', () => {
    expect(appShell).toMatch(/\.sidebar\s*\{[^}]*background:\s*var\(--swal-surface/);
  });
});
