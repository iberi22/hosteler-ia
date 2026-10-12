import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELLIPSIS,
  FALLBACK_PALETTES,
  MAX_DISHES_PER_IMAGE,
  MIN_CONTRAST,
  SAFE_BOTTOM,
  SAFE_TOP,
  STORY_HEIGHT,
  STORY_STYLE_IDS,
  STORY_WIDTH,
  TALLER_ORANGE,
  buildPalettes,
  contrastPairs,
  contrastRatio,
  fitLink,
  fitText,
  formatStoryDate,
  formatStoryPrice,
  insideSafeBox,
  isoLocalDate,
  layoutMenuList,
  paginateDishes,
  paletteFailures,
  parseColor,
  safeBox,
  shareText,
  shortLink,
  storyFileName,
  wrapText,
  wrapUrl,
  type BoneTokens,
  type FontSpec,
  type Measure,
} from './storyLayout';

/** Medida falsa y determinista: cada caracter mide 0,55 em (0,6 em en negrita). */
const measure: Measure = (text: string, font: FontSpec) => Array.from(text).length * font.size * (font.weight >= 700 ? 0.6 : 0.55);

describe('medidas y zona segura', () => {
  it('la imagen es 9:16 de 1080×1920', () => {
    expect(STORY_WIDTH).toBe(1080);
    expect(STORY_HEIGHT).toBe(1920);
    expect(STORY_WIDTH / STORY_HEIGHT).toBeCloseTo(9 / 16);
  });

  it('la zona segura deja libres 220 px arriba y 260 px abajo', () => {
    const b = safeBox();
    expect(b.y).toBe(SAFE_TOP);
    expect(b.y + b.h).toBe(STORY_HEIGHT - SAFE_BOTTOM);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x + b.w).toBeLessThan(STORY_WIDTH);
    expect(insideSafeBox({ x: b.x, y: b.y, w: b.w, h: b.h })).toBe(true);
    expect(insideSafeBox({ x: b.x, y: 100, w: 10, h: 10 })).toBe(false);
    expect(insideSafeBox({ x: b.x, y: STORY_HEIGHT - 200, w: 10, h: 10 })).toBe(false);
  });
});

describe('textos', () => {
  it('precio en pesos con el mismo formato de la carta publica', () => {
    expect(formatStoryPrice(18000).replace(/\s/g, ' ')).toBe('$ 18.000');
    expect(formatStoryPrice(1250000).replace(/\s/g, ' ')).toBe('$ 1.250.000');
  });

  it('fecha en es-CO sin coma: "viernes 3 de octubre"', () => {
    expect(formatStoryDate(new Date(2025, 9, 3, 12))).toBe('viernes 3 de octubre');
    expect(formatStoryDate(new Date(2026, 0, 1, 12))).toBe('jueves 1 de enero');
  });

  it('nombre de archivo con slug, fecha local y numero', () => {
    const d = new Date(2026, 9, 2, 22, 30); // 10:30 p. m. local: en UTC ya seria el 3
    expect(isoLocalDate(d)).toBe('2026-10-02');
    expect(storyFileName('dona-rosa', d, 1)).toBe('historia-dona-rosa-2026-10-02-1.png');
    expect(storyFileName('Raro/../ slug', d, 2)).toBe('historia-raro-slug-2026-10-02-2.png');
    expect(storyFileName('', d, 1)).toBe('historia-carta-2026-10-02-1.png');
  });

  it('enlace corto y texto para compartir', () => {
    expect(shortLink('https://fize.swal.network/dona-rosa/menu')).toBe('fize.swal.network/dona-rosa/menu');
    expect(shareText(' Doña Rosa ', 'https://fize.swal.network/dona-rosa/menu')).toBe(
      'Doña Rosa — mira la carta y pide aquí: https://fize.swal.network/dona-rosa/menu',
    );
  });
});

describe('wrapText / fitText', () => {
  const font = { size: 40, weight: 600 }; // 22 px por caracter

  it('parte por palabras sin pasarse del ancho', () => {
    const lines = wrapText('Bandeja paisa completa con chicharrón', 300, font, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, font)).toBeLessThanOrEqual(300);
    expect(lines.join(' ')).toBe('Bandeja paisa completa con chicharrón');
  });

  it('corta por letras una palabra que sola no cabe (enlaces)', () => {
    const lines = wrapText('fize.swal.network/un-restaurante-con-nombre-larguisimo/menu', 220, font, measure);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(measure(l, font)).toBeLessThanOrEqual(220);
    expect(lines.join('')).toBe('fize.swal.network/un-restaurante-con-nombre-larguisimo/menu');
  });

  it('con tope de lineas termina en "…" y no se pasa del ancho', () => {
    const lines = wrapText('uno dos tres cuatro cinco seis siete ocho nueve diez', 200, font, measure, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith(ELLIPSIS)).toBe(true);
    for (const l of lines) expect(measure(l, font)).toBeLessThanOrEqual(200);
  });

  it('texto vacio = sin lineas', () => {
    expect(wrapText('   ', 200, font, measure)).toEqual([]);
  });

  it('fitText baja la fuente antes de recortar', () => {
    const fit = fitText('Ajiaco santafereño', 500, [100, 80, 45], 800, 1, measure);
    expect(fit.complete).toBe(true);
    expect(fit.font.size).toBeLessThan(100);
    expect(fit.lines).toEqual(['Ajiaco santafereño']);
    const tooLong = fitText('palabra '.repeat(40), 500, [100, 80], 800, 2, measure);
    expect(tooLong.complete).toBe(false);
    expect(tooLong.lines).toHaveLength(2);
    expect(tooLong.lines[1].endsWith(ELLIPSIS)).toBe(true);
  });
});

describe('wrapUrl / fitLink', () => {
  const font = { size: 40, weight: 700 }; // 24 px por caracter

  it('nunca corta "menu" por la mitad: parte despues de "/", "-" o "."', () => {
    const url = 'fize.swal.network/dona-rosa/menu'; // 32 caracteres = 768 px
    const lines = wrapUrl(url, 600, font, measure);
    expect(lines.join('')).toBe(url);
    expect(lines).toEqual(['fize.swal.network/dona-', 'rosa/menu']);
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/[/.-]$/);
    for (const l of lines) expect(measure(l, font)).toBeLessThanOrEqual(600);
  });

  it('un tramo que solo no cabe se corta por letras sin perder nada', () => {
    const url = 'fize.swal.network/supercalifragilisticoespialidoso/menu';
    const lines = wrapUrl(url, 300, font, measure);
    expect(lines.join('')).toBe(url);
    for (const l of lines) expect(measure(l, font)).toBeLessThanOrEqual(300);
  });

  it('fitLink prefiere una sola linea y luego parte por tramos', () => {
    expect(fitLink('fize.swal.network/dona-rosa/menu', 912, [42, 38], 700, 2, measure).lines).toHaveLength(1);
    const two = fitLink('fize.swal.network/restaurante-y-asadero-tipico-la-casona/menu', 912, [42, 38], 700, 2, measure);
    expect(two.complete).toBe(true);
    expect(two.lines).toHaveLength(2);
    expect(two.lines.join('')).toBe('fize.swal.network/restaurante-y-asadero-tipico-la-casona/menu');
    const tooLong = fitLink(`fize.swal.network/${'a-'.repeat(200)}/menu`, 912, [42], 700, 2, measure);
    expect(tooLong.complete).toBe(false);
    expect(tooLong.lines[1].endsWith(ELLIPSIS)).toBe(true);
  });
});

describe('paginateDishes', () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => i);

  it('hasta 8 platos van en una imagen', () => {
    expect(paginateDishes(n(8))).toHaveLength(1);
    expect(paginateDishes(n(3))).toEqual([[0, 1, 2]]);
    expect(paginateDishes([])).toEqual([]);
  });

  it('mas de 8 se reparten parejo (9 = 5 + 4, 17 = 6 + 6 + 5)', () => {
    expect(paginateDishes(n(9)).map((p) => p.length)).toEqual([5, 4]);
    expect(paginateDishes(n(16)).map((p) => p.length)).toEqual([8, 8]);
    expect(paginateDishes(n(17)).map((p) => p.length)).toEqual([6, 6, 5]);
    for (const page of paginateDishes(n(40))) expect(page.length).toBeLessThanOrEqual(MAX_DISHES_PER_IMAGE);
    expect(paginateDishes(n(40)).flat()).toEqual(n(40));
  });
});

describe('layoutMenuList', () => {
  const box = { w: 912, h: 900 };

  it('3 platos cortos: fuente grande, filas dentro de la caja', () => {
    const l = layoutMenuList(
      [
        { name: 'Ajiaco', price: 18000 },
        { name: 'Sancocho', price: 16000 },
        { name: 'Bandeja paisa', price: 28000 },
      ],
      box,
      measure,
    );
    expect(l.nameFont.size).toBe(56);
    expect(l.truncated).toBe(false);
    expect(l.height).toBeLessThanOrEqual(box.h);
    expect(l.rows.map((r) => r.price.replace(/\s/g, ' '))).toEqual(['$ 18.000', '$ 16.000', '$ 28.000']);
  });

  it('8 platos con nombres largos caben sin recortar bajando la fuente', () => {
    const dishes = Array.from({ length: 8 }, (_, i) => ({ name: `Bandeja paisa completa con chicharrón número ${i + 1}`, price: 28000 + i * 1000 }));
    const l = layoutMenuList(dishes, box, measure);
    expect(l.height).toBeLessThanOrEqual(box.h);
    expect(l.truncated).toBe(false);
    for (const r of l.rows) {
      expect(r.lines.length).toBeLessThanOrEqual(2);
      const priceW = measure(r.price, l.priceFont);
      for (const line of r.lines) expect(measure(line, l.nameFont) + priceW).toBeLessThanOrEqual(box.w);
    }
  });

  it('nombres imposibles: nunca se sale de la caja; "…" como ultimo recurso', () => {
    const dishes = Array.from({ length: 8 }, () => ({ name: 'Supercalifragilístico '.repeat(12), price: 1250000 }));
    const l = layoutMenuList(dishes, box, measure);
    expect(l.height).toBeLessThanOrEqual(box.h);
    expect(l.truncated).toBe(true);
    for (const r of l.rows) {
      const priceW = measure(r.price, l.priceFont);
      for (const line of r.lines) expect(measure(line, l.nameFont) + priceW).toBeLessThanOrEqual(box.w);
    }
  });

  it('nombres que piden 3 lineas: 3 lineas con fuente chica antes que "…"', () => {
    const dishes = [
      { name: 'Sobrebarriga gratinada a la criolla con papa salada y ensalada fresca de la casa', price: 36000 },
      { name: 'Changua', price: 12000 },
    ];
    const l = layoutMenuList(dishes, { w: 912, h: 600 }, measure);
    expect(l.truncated).toBe(false);
    expect(l.rows[0].lines.length).toBe(3);
    expect(l.rows[0].lines.join(' ')).toBe(dishes[0].name);
    expect(l.height).toBeLessThanOrEqual(600);
  });

  it('las filas son contiguas', () => {
    const l = layoutMenuList([{ name: 'A', price: 1 }, { name: 'B', price: 2 }], box, measure);
    expect(l.rows[0].y).toBe(0);
    expect(l.rows[1].y).toBe(l.rows[0].height);
  });
});

describe('color y contraste', () => {
  it('lee hex y rgb/rgba', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#FF6A13')).toEqual({ r: 255, g: 106, b: 19, a: 1 });
    expect(parseColor('rgba(245, 245, 244, 0.74)')).toEqual({ r: 245, g: 245, b: 244, a: 0.74 });
    expect(parseColor('rgb(245 245 244 / 0.5)')).toEqual({ r: 245, g: 245, b: 244, a: 0.5 });
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull();
  });

  it('contraste WCAG: valores conocidos del tema Bone', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
    // Anotados en theme.css: texto 17.18:1, secundario 9.65:1 sobre #121211.
    expect(contrastRatio('#f5f5f4', '#121211')).toBeCloseTo(17.18, 1);
    expect(contrastRatio('rgba(245, 245, 244, 0.74)', '#121211')).toBeCloseTo(9.65, 1);
    expect(contrastRatio(TALLER_ORANGE, '#121211')).toBeGreaterThan(6);
  });

  it.each(STORY_STYLE_IDS)('estilo %s: todo texto pasa 4,5:1 (tambien sobre foto)', (id) => {
    const p = FALLBACK_PALETTES[id];
    expect(paletteFailures(p)).toEqual([]);
    for (const pair of contrastPairs(p)) expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe('buildPalettes', () => {
  // Valores del tema de @swal/ui (src/tokens/theme.css del paquete de npm), leidos del archivo: si el tema
  // cambia, el respaldo debe seguirlo.
  const css = readFileSync(path.resolve(import.meta.dirname, '../../../node_modules/@swal/ui/src/tokens/theme.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf('}', start));
  };
  const token = (src: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(src)?.[1].trim() ?? null;
  const tokensOf = (src: string): BoneTokens => ({
    bg: token(src, 'swal-bg'),
    text: token(src, 'swal-text'),
    textSecondary: token(src, 'swal-text-secondary'),
    accent: token(src, 'swal-accent'),
    onAccent: token(src, 'swal-on-accent'),
  });
  const dark = tokensOf(block("[data-theme='dark'] {"));
  const light = tokensOf(block("[data-theme='light'] {"));

  it('los respaldos de Bone coinciden con theme.css', () => {
    for (const [tokens, p] of [
      [light, FALLBACK_PALETTES['bone-claro']],
      [dark, FALLBACK_PALETTES['bone-oscuro']],
    ] as const) {
      expect(tokens.bg).toBe(p.bg);
      expect(tokens.text).toBe(p.text);
      expect(tokens.textSecondary).toBe(p.textSecondary);
      expect(tokens.accent).toBe(p.accent);
      expect(tokens.onAccent).toBe(p.onAccent);
    }
  });

  it('usa los tokens del tema y la fuente de la app', () => {
    const pals = buildPalettes(light, dark, "'Inter', ui-sans-serif,\n    system-ui");
    expect(pals['bone-claro'].bg).toBe('#faf9f5');
    expect(pals['bone-oscuro'].text).toBe('#f5f5f4');
    expect(pals.taller.accent).toBe(TALLER_ORANGE);
    expect(pals.taller.onAccent).toBe('#121211');
    expect(pals.cocina.font).toBe("'Inter', ui-sans-serif, system-ui");
    for (const id of STORY_STYLE_IDS) expect(paletteFailures(pals[id])).toEqual([]);
  });

  it('un token ausente, ilegible o sin contraste cae al respaldo', () => {
    const empty: BoneTokens = { bg: null, text: null, textSecondary: null, accent: null, onAccent: null };
    const pals = buildPalettes(empty, { ...dark, text: '#222222' }, null);
    expect(pals['bone-claro']).toMatchObject({ bg: '#faf9f5', text: '#1c1917' });
    // Texto #222 sobre #121211 no pasa: se usa la paleta de respaldo completa.
    expect(pals['bone-oscuro'].text).toBe('#f5f5f4');
    const translucentBg = buildPalettes({ ...light, bg: 'rgba(250, 249, 245, 0.5)' }, dark, null);
    expect(translucentBg['bone-claro'].bg).toBe('#faf9f5');
  });
});
