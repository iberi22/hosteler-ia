// storyRender.ts — dibuja las historias para WhatsApp (1080×1920) con Canvas 2D, en el equipo.
//
// Sin servidor ni dependencias nuevas: el QR sale de `qrcode-generator` (la misma libreria de RealQr.svelte) y
// se pinta modulo a modulo. Los colores salen del tema Bone en vivo (`readStoryPalettes`) y la medida del texto
// del propio canvas; la logica de acomodo es pura y vive en `storyLayout.ts`.
//
// Reglas que cumple todo dibujo: texto solo dentro de `safeBox()` (fuera de lo que tapa WhatsApp), nunca mas
// ancho que la caja (se parte, se achica y como ultimo recurso "…"), y siempre sobre el fondo liso del estilo o
// sobre el velo al 90 % cuando hay foto (los adornos van en las franjas de arriba y abajo, nunca bajo el texto).
import qrcode from 'qrcode-generator';
import {
  PHOTO_SCRIM_ALPHA,
  SAFE_BOTTOM,
  SAFE_TOP,
  STORY_HEIGHT,
  STORY_WIDTH,
  SYSTEM_FONT,
  buildPalettes,
  fitLink,
  fitText,
  formatStoryPrice,
  layoutMenuList,
  parseColor,
  relativeLuminance,
  safeBox,
  shortLink,
  withAlpha,
  wrapText,
  type BoneTokens,
  type FittedText,
  type FontSpec,
  type Measure,
  type StoryDish,
  type StoryPalette,
  type StoryStyleId,
} from './storyLayout';

export interface StoryPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface StoryCommon {
  restaurant: string;
  /** URL completa de la carta publicada. */
  link: string;
  /** false si el local no tiene WhatsApp: la carta se puede ver, pero no pedir por ahi. */
  hasWhatsapp: boolean;
}

export interface MenuStory extends StoryCommon {
  kind: 'menu';
  title: string;
  date: string;
  dishes: StoryDish[];
  page: number;
  pages: number;
}

export interface FeaturedStory extends StoryCommon {
  kind: 'featured';
  label: string;
  dish: StoryDish;
  description: string;
  photo: StoryPhoto | null;
}

export interface OrderStory extends StoryCommon {
  kind: 'order';
}

export type StorySpec = MenuStory | FeaturedStory | OrderStory;

/** Alto de las etiquetas ("Receta del día", "1/2") y medidas del bloque del plato destacado. */
const PILL_H = 76;
const GAP_PILL = 40;
const GAP_NAME = 30;
const PRICE_H = 104;
const GAP_PRICE = 30;

// ───────────────────────────── Pluma ─────────────────────────────

class Pen {
  private current = '';

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly palette: StoryPalette,
  ) {
    ctx.textBaseline = 'middle';
  }

  setFont(f: FontSpec): void {
    const wanted = `${f.weight} ${f.size}px ${this.palette.font}`;
    if (wanted === this.current) return;
    this.ctx.font = wanted;
    // Una pila de fuentes que el canvas no entienda deja la fuente anterior (10px): se cae a la del sistema.
    if (!this.ctx.font.includes(`${f.size}px`)) this.ctx.font = `${f.weight} ${f.size}px ${SYSTEM_FONT}`;
    if (!this.ctx.font.includes(`${f.size}px`)) this.ctx.font = `${f.weight} ${f.size}px sans-serif`;
    this.current = wanted;
  }

  readonly measure: Measure = (text, font) => {
    this.setFont(font);
    return this.ctx.measureText(text).width;
  };

  /** Escribe lineas desde `top` (borde superior de la primera linea). Devuelve el alto usado. */
  lines(lines: string[], x: number, top: number, font: FontSpec, lineHeight: number, color: string, align: CanvasTextAlign = 'left'): number {
    this.setFont(font);
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    lines.forEach((line, i) => this.ctx.fillText(line, x, top + i * lineHeight + lineHeight / 2));
    return lines.length * lineHeight;
  }

  fitted(t: FittedText, x: number, top: number, color: string, align: CanvasTextAlign = 'left'): number {
    return this.lines(t.lines, x, top, t.font, t.lineHeight, color, align);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ───────────────────────────── Fondo y adornos ─────────────────────────────

/** Adornos solo en las franjas que tapa WhatsApp (arriba y abajo): nunca quedan debajo de un texto. */
function drawDecor(ctx: CanvasRenderingContext2D, p: StoryPalette): void {
  const bands: Array<[number, number]> = [
    [0, SAFE_TOP - 24],
    [STORY_HEIGHT - SAFE_BOTTOM + 24, STORY_HEIGHT],
  ];
  for (const [y0, y1] of bands) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, STORY_WIDTH, y1 - y0);
    ctx.clip();
    ctx.fillStyle = p.decor;
    ctx.strokeStyle = p.decor;
    if (p.id === 'cocina') {
      // Mantel de cuadros.
      const s = 48;
      for (let y = y0; y < y1; y += s) {
        for (let x = 0; x < STORY_WIDTH; x += s) {
          if ((Math.floor(x / s) + Math.floor((y - y0) / s)) % 2 === 0) ctx.fillRect(x, y, s, s);
        }
      }
    } else if (p.id === 'taller') {
      // Franjas diagonales de taller.
      ctx.lineWidth = 22;
      for (let x = -STORY_WIDTH; x < STORY_WIDTH * 2; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x + (y1 - y0), y0);
        ctx.stroke();
      }
    } else {
      // Bone: arcos concentricos, como el borde de un plato.
      ctx.lineWidth = 3;
      const cx = y0 === 0 ? STORY_WIDTH - 120 : 120;
      const cy = y0 === 0 ? 40 : STORY_HEIGHT - 40;
      for (let r = 60; r < 420; r += 36) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** Foto a sangre, recortada para cubrir sin deformar (cover). */
function drawCover(ctx: CanvasRenderingContext2D, photo: StoryPhoto): void {
  const scale = Math.max(STORY_WIDTH / photo.width, STORY_HEIGHT / photo.height);
  const w = photo.width * scale;
  const h = photo.height * scale;
  ctx.drawImage(photo.source, (STORY_WIDTH - w) / 2, (STORY_HEIGHT - h) / 2, w, h);
}

// ───────────────────────────── Cabecera y pie ─────────────────────────────

/** Nombre del restaurante + raya de acento. Devuelve el borde inferior. */
function drawHeader(pen: Pen, restaurant: string, top = SAFE_TOP + 8): number {
  const box = safeBox();
  const name = fitText(restaurant.toLocaleUpperCase('es-CO'), box.w, [44, 40, 36, 32], 750, 2, pen.measure, 1.15);
  const h = pen.fitted(name, box.x, top, pen.palette.text);
  pen.ctx.fillStyle = pen.palette.accent;
  roundRect(pen.ctx, box.x, top + h + 18, 88, 8, 4);
  pen.ctx.fill();
  return top + h + 26;
}

interface FooterLayout {
  label: FittedText;
  link: FittedText;
  height: number;
}

function layoutFooter(pen: Pen, label: string, link: string, big: boolean): FooterLayout {
  const box = safeBox();
  const labelText = fitText(label, box.w, big ? [40, 36, 32] : [36, 34, 32], 500, 2, pen.measure, 1.25);
  const linkText = fitLink(shortLink(link), box.w, big ? [52, 46, 42, 38, 34] : [42, 38, 34, 32, 30], 700, 2, pen.measure, 1.2);
  const gap = big ? 14 : 8;
  return { label: labelText, link: linkText, height: labelText.lines.length * labelText.lineHeight + gap + linkText.lines.length * linkText.lineHeight };
}

/** Pie con el enlace de la carta, pegado al borde inferior de la zona segura. Devuelve su borde superior. */
function drawFooter(pen: Pen, label: string, link: string, big = false, align: CanvasTextAlign = 'left'): number {
  const box = safeBox();
  const f = layoutFooter(pen, label, link, big);
  const top = box.y + box.h - f.height;
  const x = align === 'center' ? box.x + box.w / 2 : box.x;
  const used = pen.fitted(f.label, x, top, pen.palette.textSecondary, align);
  pen.fitted(f.link, x, top + used + (big ? 14 : 8), pen.palette.text, align);
  if (!big) {
    pen.ctx.fillStyle = pen.palette.decor;
    pen.ctx.fillRect(box.x, top - 32, box.w, 2);
  }
  return big ? top : top - 32;
}

/** Etiqueta con relleno de acento. Devuelve su alto. */
function drawPill(pen: Pen, text: string, x: number, top: number, maxW: number, align: 'left' | 'right' = 'left'): { w: number; h: number } {
  const fitted = fitText(text, maxW - 64, [40, 36, 32], 750, 1, pen.measure);
  const font = fitted.font;
  const padX = 32;
  const label = fitted.lines[0] ?? '';
  const w = Math.min(maxW, pen.measure(label, font) + padX * 2);
  const h = PILL_H;
  const left = align === 'right' ? x - w : x;
  pen.ctx.fillStyle = pen.palette.accent;
  roundRect(pen.ctx, left, top, w, h, h / 2);
  pen.ctx.fill();
  pen.lines([label], left + padX, top, font, h, pen.palette.onAccent);
  return { w, h };
}

// ───────────────────────────── Plantillas ─────────────────────────────

function footerLabel(s: StoryCommon): string {
  return s.hasWhatsapp ? 'Mira la carta y pide por WhatsApp' : 'Mira la carta completa';
}

function drawMenu(pen: Pen, s: MenuStory): void {
  const box = safeBox();
  const { ctx, palette: p } = pen;
  let y = drawHeader(pen, s.restaurant) + 52;
  const footerTop = drawFooter(pen, footerLabel(s), s.link);

  const title = fitText(s.title.trim() || 'Menú de hoy', box.w, [116, 104, 92, 80, 68, 60], 800, 2, pen.measure, 1.04);
  y += pen.fitted(title, box.x, y, p.accent) + 14;

  const pillW = s.pages > 1 ? 180 : 0;
  const dateFont = { size: 40, weight: 500 };
  const date = wrapText(s.date, box.w - pillW - 16, dateFont, pen.measure, 1);
  pen.lines(date, box.x, y, dateFont, PILL_H, p.textSecondary);
  if (s.pages > 1) drawPill(pen, `${s.page}/${s.pages}`, box.x + box.w, y, pillW, 'right');
  y += PILL_H + 34;

  ctx.fillStyle = p.decor;
  ctx.fillRect(box.x, y, box.w, 2);
  y += 10;

  const listH = footerTop - 40 - y;
  const list = layoutMenuList(s.dishes, { w: box.w, h: listH }, pen.measure);
  list.rows.forEach((row, i) => {
    const top = y + row.y + row.padding;
    pen.lines(row.lines, box.x, top, list.nameFont, list.lineHeight, p.text);
    pen.lines([row.price], box.x + box.w, top, list.priceFont, list.lineHeight, p.accent, 'right');
    if (i < list.rows.length - 1) {
      ctx.fillStyle = p.decor;
      ctx.fillRect(box.x, y + row.y + row.height - 1, box.w, 2);
    }
  });
}

interface FeaturedBlock {
  name: FittedText;
  price: string;
  description: FittedText | null;
  height: number;
}


function layoutFeatured(pen: Pen, s: FeaturedStory, available: number): FeaturedBlock {
  const box = safeBox();
  // Con foto el texto ocupa menos (2 lineas de nombre, 3 de descripcion): la foto es la protagonista.
  const name = s.photo
    ? fitText(s.dish.name.trim() || 'Plato del día', box.w, [104, 92, 80, 68, 60], 800, 2, pen.measure, 1.06)
    : fitText(s.dish.name.trim() || 'Plato del día', box.w, [128, 112, 100, 88, 76, 64, 56], 800, 3, pen.measure, 1.04);
  const fixed = PILL_H + GAP_PILL + name.lines.length * name.lineHeight + GAP_NAME + PRICE_H;
  const desc = s.description.trim();
  let description: FittedText | null = null;
  if (desc) {
    const sizes = s.photo ? [40, 36, 34] : [44, 40, 36];
    const lineH = Math.round(sizes[sizes.length - 1] * 1.35);
    const maxLines = Math.min(s.photo ? 3 : 6, Math.floor((available - fixed - GAP_PRICE) / lineH));
    if (maxLines >= 1) description = fitText(desc, box.w, sizes, 450, maxLines, pen.measure, 1.35);
  }
  const height = fixed + (description ? GAP_PRICE + description.lines.length * description.lineHeight : 0);
  return { name, price: formatStoryPrice(s.dish.price), description, height };
}

function drawFeaturedBlock(pen: Pen, s: FeaturedStory, b: FeaturedBlock, top: number): void {
  const box = safeBox();
  const p = pen.palette;
  let y = top;
  drawPill(pen, s.label.trim() || 'Receta del día', box.x, y, box.w);
  y += PILL_H + GAP_PILL;
  y += pen.fitted(b.name, box.x, y, p.text) + GAP_NAME;
  const priceFont = { size: 92, weight: 800 };
  pen.lines([b.price], box.x, y, priceFont, PRICE_H, p.accent);
  y += PRICE_H;
  if (b.description) pen.fitted(b.description, box.x, y + GAP_PRICE, p.textSecondary);
}

function drawFeatured(pen: Pen, s: FeaturedStory): void {
  const { ctx, palette: p } = pen;
  const box = safeBox();
  if (s.photo) {
    drawCover(ctx, s.photo);
    // Medidas primero (sin pintar) para saber hasta donde va el velo.
    const footer = layoutFooter(pen, footerLabel(s), s.link, false);
    const footerTop = box.y + box.h - footer.height - 32;
    const headerProbe = fitText(s.restaurant.toLocaleUpperCase('es-CO'), box.w, [44, 40, 36, 32], 750, 2, pen.measure, 1.15);
    const headerBottom = SAFE_TOP + 8 + headerProbe.lines.length * headerProbe.lineHeight + 26;
    const block = layoutFeatured(pen, s, footerTop - 48 - (headerBottom + 260));
    const blockTop = footerTop - 48 - block.height;

    // Velo de arriba: liso hasta pasar el nombre del local y luego se desvanece.
    const solidTop = headerBottom + 36;
    ctx.fillStyle = withAlpha(p.bg, PHOTO_SCRIM_ALPHA);
    ctx.fillRect(0, 0, STORY_WIDTH, solidTop);
    let g = ctx.createLinearGradient(0, solidTop, 0, solidTop + 200);
    g.addColorStop(0, withAlpha(p.bg, PHOTO_SCRIM_ALPHA));
    g.addColorStop(1, withAlpha(p.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, solidTop, STORY_WIDTH, 200);

    // Velo de abajo: se desvanece hacia arriba y es liso (90 %) desde un poco antes del texto.
    const solidFrom = blockTop - 48;
    g = ctx.createLinearGradient(0, solidFrom - 280, 0, solidFrom);
    g.addColorStop(0, withAlpha(p.bg, 0));
    g.addColorStop(1, withAlpha(p.bg, PHOTO_SCRIM_ALPHA));
    ctx.fillStyle = g;
    ctx.fillRect(0, solidFrom - 280, STORY_WIDTH, 280);
    ctx.fillStyle = withAlpha(p.bg, PHOTO_SCRIM_ALPHA);
    ctx.fillRect(0, solidFrom, STORY_WIDTH, STORY_HEIGHT - solidFrom);

    drawHeader(pen, s.restaurant);
    drawFeaturedBlock(pen, s, block, blockTop);
    drawFooter(pen, footerLabel(s), s.link);
    return;
  }

  const headerBottom = drawHeader(pen, s.restaurant);
  const footerTop = drawFooter(pen, footerLabel(s), s.link);
  const areaTop = headerBottom + 56;
  const areaBottom = footerTop - 48;
  const block = layoutFeatured(pen, s, areaBottom - areaTop);
  // Centrado vertical, un poco por encima del centro optico.
  const top = Math.max(areaTop, areaTop + (areaBottom - areaTop - block.height) * 0.5);
  drawFeaturedBlock(pen, s, block, top);
}

/** Pinta el QR en negro sobre blanco (siempre: es lo que mejor leen las camaras). Devuelve el lado real. */
export function drawQr(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number): number {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.floor(size / (count + quiet * 2));
  const side = cell * (count + quiet * 2);
  const ox = x + Math.floor((size - side) / 2);
  const oy = y + Math.floor((size - side) / 2);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, ox, oy, side, side, 28);
  ctx.fill();
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
    }
  }
  return side;
}

function drawOrder(pen: Pen, s: OrderStory): void {
  const box = safeBox();
  const p = pen.palette;
  let y = drawHeader(pen, s.restaurant) + 52;
  const footerTop = drawFooter(pen, 'Escanea el código o abre el enlace:', s.link, true, 'center');
  const title = fitText(s.hasWhatsapp ? 'Pide por WhatsApp' : 'Mira nuestra carta', box.w, [108, 96, 84, 72], 800, 2, pen.measure, 1.04);
  y += pen.fitted(title, box.x, y, p.accent) + 18;
  const sub = fitText(
    s.hasWhatsapp ? 'Mira la carta, arma tu pedido y envíalo por WhatsApp.' : 'Precios al día y platos disponibles.',
    box.w,
    [42, 38, 34],
    450,
    3,
    pen.measure,
    1.3,
  );
  y += pen.fitted(sub, box.x, y, p.textSecondary) + 48;

  const space = footerTop - 48 - y;
  const size = Math.max(240, Math.min(640, space));
  drawQr(pen.ctx, s.link, box.x + (box.w - size) / 2, y + Math.max(0, (space - size) / 2), size);
}

// ───────────────────────────── API ─────────────────────────────

/** Dibuja la historia en `canvas` (lo deja en 1080×1920). Devuelve los milisegundos que tardo. */
export function renderStory(canvas: HTMLCanvasElement, spec: StorySpec, palette: StoryPalette): number {
  const t0 = performance.now();
  if (canvas.width !== STORY_WIDTH) canvas.width = STORY_WIDTH;
  if (canvas.height !== STORY_HEIGHT) canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Este navegador no puede dibujar imágenes (Canvas 2D no disponible).');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  drawDecor(ctx, palette);
  const pen = new Pen(ctx, palette);
  if (spec.kind === 'menu') drawMenu(pen, spec);
  else if (spec.kind === 'featured') drawFeatured(pen, spec);
  else drawOrder(pen, spec);
  return performance.now() - t0;
}

/** PNG del canvas. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen.'))), 'image/png');
  });
}

/**
 * Prepara la foto elegida: la decodifica (respetando la orientacion de la camara) y la recorta a 1080×1920 una
 * sola vez, para que cada redibujo sea rapido aunque la foto original tenga 12 MP. Queda solo en memoria.
 */
export async function preparePhoto(file: Blob): Promise<StoryPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No se pudo abrir esa foto. Prueba con otra (JPG o PNG).');
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador no puede dibujar imágenes (Canvas 2D no disponible).');
    ctx.imageSmoothingQuality = 'high';
    drawCover(ctx, { source: bitmap, width: bitmap.width, height: bitmap.height });
    return { source: canvas, width: STORY_WIDTH, height: STORY_HEIGHT };
  } finally {
    bitmap.close();
  }
}

function readTokens(doc: Document, theme: 'light' | 'dark'): BoneTokens {
  // Las reglas del tema son `[data-theme='…']` (no solo :root): una sonda con el atributo recibe sus valores.
  const probe = doc.createElement('div');
  probe.setAttribute('data-theme', theme);
  probe.hidden = true;
  doc.body.appendChild(probe);
  try {
    const cs = getComputedStyle(probe);
    const v = (name: string) => cs.getPropertyValue(name).trim() || null;
    return {
      bg: v('--swal-bg'),
      text: v('--swal-text'),
      textSecondary: v('--swal-text-secondary'),
      accent: v('--swal-accent'),
      onAccent: v('--swal-on-accent'),
    };
  } finally {
    probe.remove();
  }
}

/** Los cuatro estilos con los tokens del tema Bone en vivo (claro y oscuro) y la fuente de la app. */
export function readStoryPalettes(doc: Document = document): Record<StoryStyleId, StoryPalette> {
  const font = getComputedStyle(doc.documentElement).getPropertyValue('--swal-font').trim() || null;
  return buildPalettes(readTokens(doc, 'light'), readTokens(doc, 'dark'), font);
}

/** Estilo que corresponde al tema actual de la app (para elegirlo por defecto). */
export function currentThemeStyle(doc: Document = document): StoryStyleId {
  const bg = parseColor(getComputedStyle(doc.documentElement).getPropertyValue('--swal-bg').trim());
  return bg && relativeLuminance(bg) > 0.4 ? 'bone-claro' : 'bone-oscuro';
}
