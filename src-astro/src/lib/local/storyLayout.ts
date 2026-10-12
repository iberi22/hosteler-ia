// storyLayout.ts — logica pura de las historias para WhatsApp (Estados) del nodo local.
//
// Todo lo que se puede probar sin canvas vive aqui: medidas de la imagen (1080×1920, 9:16), zonas que tapa
// WhatsApp, formato de precio y fecha, partir texto en lineas, repartir platos en varias imagenes, acomodar
// las filas del menu y comprobar contraste (WCAG 2.2) de cada estilo. El dibujo esta en `storyRender.ts`.
// Medir texto depende del navegador, asi que las funciones reciben `measure` (en tests, una medida falsa).
import { formatCOP } from '../money';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
/** WhatsApp pinta arriba la barra de progreso, el nombre y la hora: sin texto en los primeros 220 px. */
export const SAFE_TOP = 220;
/** Abajo van "Responder" y los botones: sin texto en los ultimos 260 px. */
export const SAFE_BOTTOM = 260;
export const SIDE_MARGIN = 84;
/** Mas platos que esto en una sola imagen ya no se leen en un celular. */
export const MAX_DISHES_PER_IMAGE = 8;
/** Contraste minimo de todo texto de la imagen (WCAG AA, texto normal). */
export const MIN_CONTRAST = 4.5;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zona donde puede ir texto: fuera de lo que tapa WhatsApp y con margen a los lados. */
export function safeBox(): Box {
  return {
    x: SIDE_MARGIN,
    y: SAFE_TOP,
    w: STORY_WIDTH - SIDE_MARGIN * 2,
    h: STORY_HEIGHT - SAFE_TOP - SAFE_BOTTOM,
  };
}

/** True si la caja queda completa dentro de la zona segura. */
export function insideSafeBox(b: Box): boolean {
  const s = safeBox();
  return b.x >= s.x - 0.5 && b.y >= s.y - 0.5 && b.x + b.w <= s.x + s.w + 0.5 && b.y + b.h <= s.y + s.h + 0.5;
}

// ───────────────────────────── Textos ─────────────────────────────

/** Mismo formato que la carta publica (`PublicMenu.svelte` usa `formatCOP`): 18000 -> "$ 18.000". */
export function formatStoryPrice(price: number): string {
  return formatCOP(price);
}

/** "viernes 3 de octubre" (es-CO, sin la coma que agrega Intl tras el dia de la semana). */
export function formatStoryDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} de ${get('month')}`.toLowerCase();
}

/** Fecha local AAAA-MM-DD (para el nombre del archivo, no UTC: a las 8 p. m. en Colombia ya es "mañana" en UTC). */
export function isoLocalDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** `historia-<slug>-<fecha>-<n>.png`; n empieza en 1. */
export function storyFileName(slug: string, date: Date, n: number): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'carta';
  return `historia-${safe}-${isoLocalDate(date)}-${n}.png`;
}

/** Enlace sin `https://` para mostrar en la imagen. */
export function shortLink(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** Texto que acompaña la imagen al compartir (en WhatsApp queda como pie del estado). */
export function shareText(restaurant: string, url: string): string {
  return `${restaurant.trim()} — mira la carta y pide aquí: ${url}`;
}

// ───────────────────────────── Partir texto ─────────────────────────────

export interface FontSpec {
  size: number;
  weight: number;
}

/** Ancho en px de `text` con esa fuente. En el navegador es `ctx.measureText`. */
export type Measure = (text: string, font: FontSpec) => number;

export const ELLIPSIS = '…';

/** Recorta `text` hasta que `text + …` quepa en `maxWidth`. */
export function ellipsize(text: string, maxWidth: number, font: FontSpec, measure: Measure): string {
  if (measure(text, font) <= maxWidth) return text;
  let chars = Array.from(text.trimEnd());
  while (chars.length > 0 && measure(chars.join('').trimEnd() + ELLIPSIS, font) > maxWidth) chars = chars.slice(0, -1);
  return chars.join('').trimEnd() + ELLIPSIS;
}

/** Parte una palabra que sola no cabe en el ancho (enlaces largos, nombres sin espacios). */
function breakWord(word: string, maxWidth: number, font: FontSpec, measure: Measure): string[] {
  const out: string[] = [];
  let current = '';
  for (const ch of Array.from(word)) {
    if (current && measure(current + ch, font) > maxWidth) {
      out.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Parte `text` en lineas de como mucho `maxWidth`. Las palabras demasiado largas se cortan por letras.
 * Si no cabe en `maxLines`, la ultima linea termina en "…" (ultimo recurso: antes se prueba fuente menor).
 */
export function wrapText(text: string, maxWidth: number, font: FontSpec, measure: Measure, maxLines = Infinity): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (measure(word, font) <= maxWidth) {
      current = word;
    } else {
      const pieces = breakWord(word, maxWidth, font, measure);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? '';
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  const rest = lines.slice(kept.length - 1).join(' ');
  kept[kept.length - 1] = ellipsize(rest, maxWidth, font, measure);
  return kept;
}

export interface FittedText {
  lines: string[];
  font: FontSpec;
  lineHeight: number;
  /** false si ni con la fuente minima cupo y se uso "…". */
  complete: boolean;
}

/**
 * Prueba de la fuente mas grande a la mas chica hasta que el texto quepa entero en `maxLines`.
 * Con la mas chica, si aun no cabe, recorta con "…".
 */
export function fitText(
  text: string,
  maxWidth: number,
  sizes: readonly number[],
  weight: number,
  maxLines: number,
  measure: Measure,
  lineHeightRatio = 1.12,
): FittedText {
  for (const size of sizes) {
    const font = { size, weight };
    const lines = wrapText(text, maxWidth, font, measure);
    if (lines.length <= maxLines) return { lines, font, lineHeight: Math.round(size * lineHeightRatio), complete: true };
  }
  const size = sizes[sizes.length - 1] ?? 32;
  const font = { size, weight };
  return {
    lines: wrapText(text, maxWidth, font, measure, maxLines),
    font,
    lineHeight: Math.round(size * lineHeightRatio),
    complete: false,
  };
}

/**
 * Parte un enlace solo despues de "/", "-" o "." (nunca "…/m" + "enu"). Un tramo que solo no cabe se corta por
 * letras. Con tope de lineas, la ultima termina en "…".
 */
export function wrapUrl(url: string, maxWidth: number, font: FontSpec, measure: Measure, maxLines = Infinity): string[] {
  const tokens = url.match(/[^/.-]+[/.-]*|[/.-]+/g) ?? [];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (measure(current + token, font) <= maxWidth) {
      current += token;
      continue;
    }
    if (current) lines.push(current);
    if (measure(token, font) <= maxWidth) {
      current = token;
    } else {
      const pieces = breakWord(token, maxWidth, font, measure);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? '';
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = ellipsize(lines.slice(kept.length - 1).join(''), maxWidth, font, measure);
  return kept;
}

/** Como `fitText` pero para enlaces: primero en una sola linea, luego partido por "/", "-" o ".". */
export function fitLink(
  url: string,
  maxWidth: number,
  sizes: readonly number[],
  weight: number,
  maxLines: number,
  measure: Measure,
  lineHeightRatio = 1.2,
): FittedText {
  const result = (lines: string[], size: number, complete: boolean): FittedText => ({
    lines,
    font: { size, weight },
    lineHeight: Math.round(size * lineHeightRatio),
    complete,
  });
  for (const size of sizes) {
    if (measure(url, { size, weight }) <= maxWidth) return result([url], size, true);
  }
  for (const size of sizes) {
    const lines = wrapUrl(url, maxWidth, { size, weight }, measure);
    if (lines.length <= maxLines) return result(lines, size, true);
  }
  const size = sizes[sizes.length - 1] ?? 28;
  return result(wrapUrl(url, maxWidth, { size, weight }, measure, maxLines), size, false);
}

// ───────────────────────────── Platos ─────────────────────────────

export interface StoryDish {
  name: string;
  price: number;
}

/**
 * Reparte los platos en imagenes de como mucho `perPage`, parejas: 9 platos son 5 + 4, no 8 + 1
 * (una imagen con un solo plato se ve vacia y confunde).
 */
export function paginateDishes<T>(items: readonly T[], perPage = MAX_DISHES_PER_IMAGE): T[][] {
  if (items.length === 0) return [];
  const per = Math.max(1, Math.floor(perPage));
  const pages = Math.ceil(items.length / per);
  const size = Math.ceil(items.length / pages);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface MenuRowLayout {
  /** Lineas del nombre del plato (1–3). */
  lines: string[];
  price: string;
  /** Borde superior de la fila, relativo a la caja de la lista. */
  y: number;
  height: number;
  /** Desplazamiento vertical del texto dentro de la fila. */
  padding: number;
}

export interface MenuListLayout {
  nameFont: FontSpec;
  priceFont: FontSpec;
  lineHeight: number;
  rows: MenuRowLayout[];
  /** Alto total ocupado (≤ alto de la caja). */
  height: number;
  /** true si algun nombre se recorto con "…". */
  truncated: boolean;
}

const NAME_SIZES = [56, 52, 48, 44, 40, 36] as const;
const ROW_MIN_PAD = 14;
const ROW_MAX_PAD = 30;
const PRICE_GAP = 32;

/**
 * Acomoda los platos de una imagen en una caja: nombre a la izquierda (hasta 2 lineas) y precio a la derecha.
 * Elige la fuente mas grande con la que todo cabe; el espacio que sobra se reparte entre filas (con tope).
 */
export function layoutMenuList(dishes: readonly StoryDish[], box: { w: number; h: number }, measure: Measure): MenuListLayout {
  const build = (size: number, maxLines: number) => {
    const nameFont = { size, weight: 600 };
    const priceFont = { size, weight: 750 };
    const lineHeight = Math.round(size * 1.18);
    const prices = dishes.map((d) => formatStoryPrice(d.price));
    let truncated = false;
    const rows = dishes.map((d, i) => {
      const priceW = measure(prices[i], priceFont);
      const nameW = Math.max(box.w * 0.4, box.w - priceW - PRICE_GAP);
      const all = wrapText(d.name, nameW, nameFont, measure);
      const lines = all.length > maxLines ? wrapText(d.name, nameW, nameFont, measure, maxLines) : all;
      if (all.length > maxLines) truncated = true;
      return { lines, price: prices[i] };
    });
    const textH = rows.reduce((acc, r) => acc + r.lines.length * lineHeight, 0);
    return { nameFont, priceFont, lineHeight, rows, textH, truncated };
  };

  const fits = (textH: number) => textH + dishes.length * ROW_MIN_PAD * 2 <= box.h;
  let chosen = build(NAME_SIZES[NAME_SIZES.length - 1], 1);
  let found = false;
  for (const size of NAME_SIZES) {
    const attempt = build(size, 2);
    if (!attempt.truncated && fits(attempt.textH)) {
      chosen = attempt;
      found = true;
      break;
    }
  }
  if (!found) {
    // Nombres muy largos: 3 lineas con fuente chica si caben enteros. Ultimo recurso: 2 lineas con "…", luego 1.
    for (const size of NAME_SIZES.slice(-2)) {
      const three = build(size, 3);
      if (!three.truncated && fits(three.textH)) {
        chosen = three;
        found = true;
        break;
      }
    }
  }
  if (!found) {
    const two = build(NAME_SIZES[NAME_SIZES.length - 1], 2);
    chosen = fits(two.textH) ? two : chosen;
  }

  const n = Math.max(1, dishes.length);
  const spare = Math.max(0, box.h - chosen.textH);
  const padding = Math.min(ROW_MAX_PAD, Math.max(ROW_MIN_PAD, Math.floor(spare / n / 2)));
  let y = 0;
  const rows: MenuRowLayout[] = chosen.rows.map((r) => {
    const height = r.lines.length * chosen.lineHeight + padding * 2;
    const row = { lines: r.lines, price: r.price, y, height, padding };
    y += height;
    return row;
  });
  return {
    nameFont: chosen.nameFont,
    priceFont: chosen.priceFont,
    lineHeight: chosen.lineHeight,
    rows,
    height: y,
    truncated: chosen.truncated,
  };
}

// ───────────────────────────── Color y contraste ─────────────────────────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Lee `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (con comas o espacios). Null si no lo entiende. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = 'f'] = h.split('');
      return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: parseInt(a + a, 16) / 255 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!fn) return null;
  const nums = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (nums.length < 3) return null;
  const channel = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
  const alpha = (v: string | undefined) => (v === undefined ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
  const out = { r: channel(nums[0]), g: channel(nums[1]), b: channel(nums[2]), a: alpha(nums[3]) };
  return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : null;
}

/** `fg` (con su alfa) pintado sobre `bg` opaco. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = Math.min(1, Math.max(0, fg.a));
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

export function relativeLuminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Contraste WCAG 2.2 de `fg` sobre `bg` (el alfa de `fg` se mezcla sobre `bg`). 0 si algun color no se entiende. */
export function contrastRatio(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return 0;
  const base = b.a < 1 ? composite(b, { r: 255, g: 255, b: 255, a: 1 }) : b;
  const L1 = relativeLuminance(composite(f, base));
  const L2 = relativeLuminance(base);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

/** Color opaco resultante de pintar `scrim` con alfa `alpha` sobre `under` (para el velo encima de la foto). */
export function scrimOver(scrim: string, alpha: number, under: string): string {
  const s = parseColor(scrim);
  const u = parseColor(under);
  if (!s || !u) return scrim;
  const c = composite({ ...s, a: alpha }, u);
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

/** `rgba()` de un color con otro alfa (degradados del velo de la foto). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

// ───────────────────────────── Estilos ─────────────────────────────

export type StoryStyleId = 'bone-claro' | 'bone-oscuro' | 'taller' | 'cocina';

export interface StoryPalette {
  id: StoryStyleId;
  label: string;
  /** Fondo opaco. */
  bg: string;
  /** Texto principal (nombre del plato, restaurante). */
  text: string;
  /** Texto de apoyo (fecha, descripcion, pie). */
  textSecondary: string;
  /** Titulos y precios. */
  accent: string;
  /** Texto sobre un relleno de `accent` (etiquetas). */
  onAccent: string;
  /** Lineas divisorias y adornos: no llevan texto encima. */
  decor: string;
  /** Pila de fuentes (la del sistema o la que trae el tema; nunca fuentes externas). */
  font: string;
}

/** Fuente si el tema no la da: solo fuentes del sistema (un nodo local funciona sin internet). */
export const SYSTEM_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Acento del estilo "Taller": naranja de taller. 6,5:1 sobre el carbon de Bone. */
export const TALLER_ORANGE = '#ff6a13';

/**
 * Valores de respaldo. Los de Bone son los de `@swal/ui/src/tokens/theme.css` (paquete de npm) (hay un test que lo comprueba);
 * en el navegador se leen del tema en vivo (`readStoryPalettes` en storyRender.ts) y estos solo se usan si un
 * token falta o deja de cumplir el contraste.
 */
export const FALLBACK_PALETTES: Record<StoryStyleId, StoryPalette> = {
  'bone-claro': {
    id: 'bone-claro',
    label: 'Bone claro',
    bg: '#faf9f5',
    text: '#1c1917',
    textSecondary: 'rgba(28, 25, 23, 0.78)',
    accent: '#1c1917',
    onAccent: '#faf9f5',
    decor: 'rgba(28, 25, 23, 0.14)',
    font: SYSTEM_FONT,
  },
  'bone-oscuro': {
    id: 'bone-oscuro',
    label: 'Bone oscuro',
    bg: '#121211',
    text: '#f5f5f4',
    textSecondary: 'rgba(245, 245, 244, 0.74)',
    accent: '#f5f5f4',
    onAccent: '#1c1917',
    decor: 'rgba(245, 245, 244, 0.16)',
    font: SYSTEM_FONT,
  },
  taller: {
    id: 'taller',
    label: 'Taller naranja',
    bg: '#121211',
    text: '#f5f5f4',
    textSecondary: 'rgba(245, 245, 244, 0.74)',
    accent: TALLER_ORANGE,
    onAccent: '#121211',
    decor: 'rgba(255, 106, 19, 0.38)',
    font: SYSTEM_FONT,
  },
  cocina: {
    id: 'cocina',
    label: 'Cocina',
    bg: '#fbf1e1',
    text: '#2e1a0e',
    textSecondary: 'rgba(46, 26, 14, 0.8)',
    accent: '#a3341a',
    onAccent: '#fff8ee',
    decor: 'rgba(163, 52, 26, 0.2)',
    font: SYSTEM_FONT,
  },
};

export const STORY_STYLE_IDS: readonly StoryStyleId[] = ['bone-claro', 'bone-oscuro', 'taller', 'cocina'];

/** Alfa minimo del velo detras del texto cuando hay foto: con el, todo texto pasa 4,5:1 sobre cualquier pixel. */
export const PHOTO_SCRIM_ALPHA = 0.9;

/** Pares texto/fondo que la imagen pinta. Todos deben pasar `MIN_CONTRAST`. */
export function contrastPairs(p: StoryPalette): Array<{ role: string; fg: string; bg: string }> {
  const pairs = [
    { role: 'texto', fg: p.text, bg: p.bg },
    { role: 'texto secundario', fg: p.textSecondary, bg: p.bg },
    { role: 'acento', fg: p.accent, bg: p.bg },
    { role: 'texto sobre acento', fg: p.onAccent, bg: p.accent },
  ];
  // Con foto: el texto va sobre el velo (fondo al 90 %) encima del pixel mas claro y del mas oscuro posibles.
  for (const under of ['#ffffff', '#000000']) {
    const veil = scrimOver(p.bg, PHOTO_SCRIM_ALPHA, under);
    pairs.push(
      { role: `texto sobre foto (${under})`, fg: p.text, bg: veil },
      { role: `texto secundario sobre foto (${under})`, fg: p.textSecondary, bg: veil },
      { role: `acento sobre foto (${under})`, fg: p.accent, bg: veil },
    );
  }
  return pairs;
}

export function paletteFailures(p: StoryPalette): string[] {
  return contrastPairs(p)
    .filter((pair) => !(contrastRatio(pair.fg, pair.bg) >= MIN_CONTRAST))
    .map((pair) => `${pair.role}: ${contrastRatio(pair.fg, pair.bg).toFixed(2)}:1`);
}

/** Tokens de Bone leidos del tema en vivo (null = el token no esta). */
export interface BoneTokens {
  bg: string | null;
  text: string | null;
  textSecondary: string | null;
  accent: string | null;
  onAccent: string | null;
}

/**
 * Arma los cuatro estilos con los tokens del tema (claro y oscuro) y la fuente de la app. Cada paleta se valida:
 * si un token falta, no se entiende o el resultado no pasa 4,5:1, ese estilo usa sus valores de respaldo.
 */
export function buildPalettes(light: BoneTokens, dark: BoneTokens, font: string | null): Record<StoryStyleId, StoryPalette> {
  const family = font && font.trim() ? font.replace(/\s+/g, ' ').trim() : SYSTEM_FONT;
  const pick = (v: string | null, fallback: string) => (v && parseColor(v) ? v.trim() : fallback);
  const opaque = (v: string | null, fallback: string) => {
    if (!v) return fallback;
    const c = parseColor(v);
    return c && c.a >= 1 ? v.trim() : fallback;
  };

  const fromBone = (base: StoryPalette, t: BoneTokens, overrides: Partial<StoryPalette> = {}): StoryPalette => ({
    ...base,
    bg: opaque(t.bg, base.bg),
    text: pick(t.text, base.text),
    textSecondary: pick(t.textSecondary, base.textSecondary),
    accent: pick(t.accent, base.accent),
    onAccent: pick(t.onAccent, base.onAccent),
    ...overrides,
    font: family,
  });

  const fb = FALLBACK_PALETTES;
  const candidates: Record<StoryStyleId, StoryPalette> = {
    'bone-claro': fromBone(fb['bone-claro'], light),
    'bone-oscuro': fromBone(fb['bone-oscuro'], dark),
    // Taller = carbon de Bone con acento naranja; el texto sobre el naranja es el propio fondo carbon.
    taller: fromBone(fb.taller, dark, { accent: TALLER_ORANGE, onAccent: opaque(dark.bg, fb.taller.onAccent) }),
    cocina: { ...fb.cocina, font: family },
  };
  const out = {} as Record<StoryStyleId, StoryPalette>;
  for (const id of STORY_STYLE_IDS) {
    out[id] = paletteFailures(candidates[id]).length === 0 ? candidates[id] : { ...fb[id], font: family };
  }
  return out;
}
