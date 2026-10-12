import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * El tema no puede quedar FIJO en el markup.
 *
 * Se encontro `<html lang="es" data-theme="dark">` en BaseLayout.astro. Como el
 * atributo gana sobre el bloque `@media (prefers-color-scheme)` del CSS, un
 * usuario con el sistema en claro recibia siempre la app oscura y no podia
 * cambiarla. No era "tema oscuro por defecto": era "tema oscuro para todos".
 *
 * Estos tests fijan las tres reglas del ciclo del tema:
 *   1. el HTML inicial NO lleva data-theme (si lo lleva, el sistema no manda);
 *   2. el scriptinline aplica una eleccion guardada, antes de pintar;
 *   3. existe la media query que hace que el sistema mande cuando no hay
 *      eleccion.
 */

const THEME_CSS = resolve(
  process.cwd(), 'node_modules', '@swal', 'ui', 'src', 'tokens', 'theme.css'
);
const tokens = readFileSync(THEME_CSS, 'utf-8');

/* Extraer los tokens de un bloque del tema por su selector. Cada archivo de
   test corre en su propio contexto de modulo, asi que esto no se comparte con
   theme.test.ts: se vuelve a leer el CSS y a parsear aqui. */
function tokensDe(selector: string): Record<string, string> {
  const i = tokens.indexOf(selector);
  if (i < 0) throw new Error(`no encuentro el bloque ${selector} en theme.css`);
  const ini = tokens.indexOf('{', i);
  let depth = 0;
  let fin = ini;
  for (let k = ini; k < tokens.length; k++) {
    if (tokens[k] === '{') depth++;
    else if (tokens[k] === '}') {
      depth--;
      if (depth === 0) { fin = k; break; }
    }
  }
  const cuerpo = tokens.slice(ini, fin);
  const out: Record<string, string> = {};
  // Solo la primera declaracion de cada token: dentro de un bloque, si un
  // token aparece dos veces gana la ultima (es lo que hace el navegador).
  for (const mt of cuerpo.matchAll(/(--swal-[\w-]+)\s*:\s*([^;]+);/g)) {
    out[mt[1]] = mt[2].trim();
  }
  return out;
}

const darkTokens = tokensDe(":root,\n[data-theme='dark']");
const lightTokens = tokensDe("[data-theme='light']");

const LAYOUT = resolve(process.cwd(), 'src', 'layouts', 'BaseLayout.astro');
const layout = readFileSync(LAYOUT, 'utf-8');

/* El menu y la columna lateral ya no viven en BaseLayout: son AppShell y
   MobileNav del core, y el script de tema es themeBootScript del core. Los
   contratos de abajo se comprueban contra esas fuentes. */
const CORE = resolve(process.cwd(), 'node_modules', '@swal', 'ui', 'src');
const appShell = readFileSync(resolve(CORE, 'components', 'AppShell.svelte'), 'utf-8');
const mobileNav = readFileSync(resolve(CORE, 'components', 'MobileNav.svelte'), 'utf-8');
const themeBoot = readFileSync(resolve(CORE, 'lib', 'theme-boot.js'), 'utf-8');

const dashboard = readFileSync(
  resolve(process.cwd(), 'src', 'pages', 'dashboard', 'index.astro'),
  'utf-8',
);

describe('tema — el HTML no fija el tema', () => {
  it('no hay data-theme en la etiqueta <html>', () => {
    const htmlTag = layout.match(/<html[^>]*>/);
    expect(htmlTag, 'BaseLayout debe tener una etiqueta <html>').not.toBeNull();
    expect(htmlTag![0]).not.toMatch(/data-theme/);
  });

  it('el script de tema es inline (corre antes de pintar)', () => {
    // Con defer o sin inline, el atributo se aplica DESPUES del primer paint y
    // el usuario ve un destello del tema contrario. Viene del core, no se copia.
    expect(layout).toMatch(/<script is:inline set:html=\{themeBootScript\(\)\}><\/script>/);
    expect(layout).toContain('from "@swal/ui/theme-boot"');
    expect(themeBoot).toContain("'swal-theme'");
  });

  it('lee la eleccion guardada y solo acepta light/dark', () => {
    expect(themeBoot).toContain('localStorage.getItem');
    expect(themeBoot).toContain('setAttribute');
    // Sin este filtro, cualquier valor sucio en localStorage inyectaria un
    // atributo arbitrario en <html>.
    expect(themeBoot).toMatch(/DEFAULT_THEMES = \['light', 'dark'\]/);
    expect(themeBoot).toContain('.indexOf(t)>-1');
  });

  it('tolera localStorage bloqueado sin romper la pagina', () => {
    // Modo privado y cookies bloqueadas lanzan en getItem. Si eso revienta el
    // script, el tema se queda sin aplicar y la app arranca a medio pintar.
    const i = themeBoot.indexOf('localStorage.getItem');
    expect(themeBoot.slice(i, i + 700)).toMatch(/catch/);
  });

  it('el CSS del core tiene la media query que hace mandar al sistema', () => {
    // Sin esto, quitar el atributo dejaria la app sin tema en vez de seguir al
    // sistema. Los dos tienen que existir juntos.
    expect(tokens).toContain('@media (prefers-color-scheme: light)');
    expect(tokens).toContain(':root:not([data-theme])');
  });
});

describe('tema — el body usa la malla ambiental', () => {
  it('el body lee el token --swal-mesh', () => {
    // La malla es lo que da la sensacion de papel bajo luz. Sin ella el tema es
    // un gris plano: technically correcto, visualmente muerto. Y al leerla del
    // token, la malla correcta llega sola segun el tema: con una clase habia
    // que duplicar la regla para data-theme y para prefers-color-scheme, y el
    // body se quedaba con la malla de oscuro cuando el sistema estaba en claro.
    const body = layout.slice(layout.indexOf('body {'));
    expect(body.slice(0, 800)).toContain('var(--swal-mesh)');
  });

  it('el body no codifica degradados propios', () => {
    // Si el layout lleva sus propios radial-gradient, se desincronizan del
    // tema: fue exactamente lo que paso con la malla de claro duplicada a mano.
    const body = layout.slice(layout.indexOf('body {'));
    expect(body.slice(0, 800)).not.toContain('radial-gradient');
  });

  it('los fallbacks de var() son del tema Bone, no de Edge-Hive', () => {
    // Si el CSS del core no carga, estos valores son lo que ve el usuario. Con
    // los de Edge-Hive (#050507 / #e2e8f0) se caia a azul-noche.
    expect(layout).toContain('var(--swal-bg, #121211)');
    expect(layout).toContain('var(--swal-text, #f5f5f4)');
    expect(layout).not.toContain('#050507');
    expect(layout).not.toContain('#e2e8f0');
  });

  it('el item activo del menu no usa tokens de Edge-Hive', () => {
    // Usaba `--swal-neon-cyan`, que el tema Bone ya no define: caia al
    // fallback #22d3ee y el activo se veia turquesa sobre fondo grafito.
    // Solo se miran las SENTENCIAS CSS, no los comentarios: el comentario que
    // explica el fix menciona el token, y un grep ingenuo daria falso positivo.
    const sinComentarios = (layout + mobileNav)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    expect(sinComentarios).not.toContain('--swal-neon-cyan');
    expect(sinComentarios).not.toContain('#22d3ee');
    // Y el activo debe apoyarse en un token que el tema si define.
    expect(sinComentarios).toContain('--swal-accent-muted');
  });

  it('el selector del menu incluye la etiqueta <a>, no solo la clase', () => {
    // El bug mas dificil de este tema, y no lo delata el CSS: lo delata la
    // user-agent stylesheet. Los <a> con href traen
    //   a:-webkit-any-link { color: -webkit-link }   especificidad (0,1,1)
    // que gana a una clase suelta `.nav-item` (0,1,0). Con el `color-scheme`
    // que el tema define, `-webkit-link` resuelve al azul de enlace nativo
    // (rgb(158,158,255)) y el texto salia con el color del tema CLARO
    // mientras el fondo era el oscuro: medido 1.01:1, grafito sobre grafito.
    // CDP fue lo que lo revelo: getComputedStyle y enumerar cssRules
    // mostraban ambos un color coherente y por eso el bug parecia imposible.
    // Anadir la etiqueta empata la especificidad y el orden de fuente decide.
    expect(mobileNav).toContain('a.nav-item {');
    expect(mobileNav).toContain('a.nav-item:hover');
    expect(mobileNav).toContain('a.nav-item.active');
    // Y los tres estados (base, hover, activo) necesitan `!important`. Anadir solo
    // la etiqueta deja el empate en (0,1,1) y lo gana el ORDEN, donde la hoja
    // del usuario se aplica despues.
    expect(mobileNav).toMatch(/a\.nav-item\s*\{[^}]*color:[^;}]*!important/);
    expect(mobileNav).toMatch(/a\.nav-item:hover\s*\{[^}]*color:[^;}]*!important/);
    expect(mobileNav).toMatch(/a\.nav-item\.active\s*\{[^}]*color:[^;}]*!important/);
    // Y el menu NO puede transicionar `color`. Su valor viene de un token de
    // tema: la transicion se re-dispara al cambiar de tema y, mientras esta en
    // vuelo, getComputedStyle devuelve el color ANTERIOR. Asi se midio el menu
    // como 1.01:1 cuando el token era el correcto — un falso negativo que
    // llevaba a "arreglar" algo que ya estaba bien.
    const navBase = mobileNav.match(/a\.nav-item\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navBase).not.toMatch(/transition:[^;]*\bcolor\b/);
    // El fondo si se anima: es lo que da la sensacion de respuesta al hover.
    expect(navBase).toMatch(/transition:[^;]*background/);
    // Y ningun estado del menu puede quedarse con la clase suelta, que es la
    // que pierde contra el navegador.
    const sueltos = (mobileNav.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[\s,>+~])([a-z]*)\.nav-item(?![\w-])/g) ?? [])
      .filter((m) => !m.endsWith('a.nav-item'));
    expect(sueltos).toEqual([]);
  });

  it('el sidebar usa el token de superficie del tema', () => {
    // El bug mas grave que se ha visto en este tema, y lo encontro la revision
    // con vision antes que el test: el sidebar tenia `rgba(15,15,20,.9)`
    // hardcodeado (azul-noche de Edge-Hive) mientras el texto si usaba tokens.
    // Medido en produccion: 1.09:1 — texto casi invisible en oscuro Y en
    // claro. Un fondo fijo y un texto tematico no se pueden combinar: el texto
    // hay que medirlo contra el fondo REAL, no contra el token que se espera.
    const sb = appShell.slice(appShell.indexOf('.sidebar {'));
    const bg = sb.slice(0, 900).match(/background:\s*([^;]+);/)?.[1] ?? '';
    expect(bg, 'el sidebar debe declarar background').toBeTruthy();
    expect(bg).toContain('var(--swal-surface');
    expect(bg).not.toMatch(/rgba\(\s*15,\s*15,\s*20/);
  });

  it('los tokens legacy de Edge-Hive existen como alias de un rol', () => {
    // 97 usos en la app referenciaban tokens que Bone no declaraba, asi que
    // caian a su fallback literal: cyan #22d3ee y naranja #f97316 hardcodeados
    // por la interfaz. Se definen aqui como alias de un ROL — nunca de un
    // color — para que el tema los migre a la vez sin tocar los 12 componentes
    // (que son justo los que la wave de agentes esta editando: definir el
    // alias en el core evita un conflicto de merge por cada token).
    const legacy = [
      '--swal-accent-cyan', '--swal-neon-cyan', '--swal-cyan-bright',
      '--swal-accent-orange', '--swal-accent-red', '--swal-neon-green',
      '--swal-bg-elevated', '--swal-bg-surface', '--swal-card-bg',
      '--swal-hover-bg', '--swal-active-bg', '--swal-danger-bg',
    ];
    for (const tok of legacy) {
      for (const [tema, bloque] of [['oscuro', darkTokens], ['claro', lightTokens]] as const) {
        expect(bloque, `${tok} debe existir en el tema ${tema}`).toHaveProperty(tok);
        // Un alias con color fijo seria el mismo bug con otro nombre: no
        // seguiria al tema y ademas reintroduiria el cyan.
        expect(bloque[tok].trim(), `${tok} (${tema}) debe ser un alias`).toMatch(/^var\(--swal-/);
      }
    }
    // El cyan acaba en el acento (un solo tono) y el verde neon en el exito:
    // cyan era el color de marca del tema anterior, y en Bone el acento ES el
    // texto. El rojo es lo unico que conserva su significado cromatico.
    const alias = (tok: string) => darkTokens[tok].trim();
    for (const tok of ['--swal-accent-cyan', '--swal-neon-cyan', '--swal-cyan-bright']) {
      expect(alias(tok), tok).toBe('var(--swal-accent)');
    }
    expect(alias('--swal-neon-green')).toBe('var(--swal-success)');
    expect(alias('--swal-accent-red')).toBe('var(--swal-danger)');
    // Los tres nombres de "un plano por encima del fondo" son el mismo rol.
    for (const tok of ['--swal-bg-elevated', '--swal-bg-surface', '--swal-card-bg']) {
      expect(alias(tok), tok).toBe('var(--swal-surface)');
    }
  });

  it('las tarjetas del dashboard no transicionan border-color', () => {
    // Una transicion sobre una propiedad cuyo valor viene de var(--swal-*)
    // se re-dispara en bucle al cambiar de tema: el token cambia, la
    // transicion arranca, y con ella activa el color computado devuelve el
    // valor ANTERIOR. Medido en produccion: 40 transiciones vivas
    // permanentes (32 en .module + 8 en a.nav-item) y el menu salia con el
    // color del tema claro sobre el fondo oscuro, 1.01:1.
    // Regla: animar solo propiedades que NO dependen de un token de tema
    // (transform, opacity, filter). Los colores los cambia el tema de golpe.
    const mod = dashboard.slice(dashboard.indexOf('.module {'));
    const trans = mod.slice(0, 1200).match(/transition:\s*([^;]+);/)?.[1] ?? '';
    expect(trans).not.toMatch(/border-color/);
    expect(trans).not.toMatch(/(?<!-)background(?:-color)?/);
    expect(trans).toMatch(/transform/);
    // Y su hover no puede caer al cyan de Edge-Hive.
    const hover = mod.match(/\.module:hover\s*\{[^}]*\}/)?.[0] ?? '';
    expect(hover).not.toContain('#06b6d4');
    expect(hover).toContain('var(--swal-accent');
  });
});
