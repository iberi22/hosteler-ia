export const GOS_VAULT_FORMAT = 'gos-recipe-vault';
export const GOS_VAULT_VERSION = 1;
export const FIZE_RECETARIO_PATH = '/local/recetas/';
export const GOS_LINK_PARAM = 'gos';
export const GOS_LINK_MAX_CHARS = 2000;

export interface GosRecipeDraft {
  title: string;
  main_ingredients: string[];
  instructions: string[];
  servings?: string;
  prep_time?: string;
  cook_time?: string;
}

export function parseGosVaultExport(raw: unknown): { ok: boolean; recipes: GosRecipeDraft[]; error?: string } {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') {
      return { ok: false, recipes: [], error: 'El formato no es un objeto JSON' };
    }

    const { format, version, recipes } = data as any;

    if (format !== GOS_VAULT_FORMAT) {
      return { ok: false, recipes: [], error: 'El formato no es un recetario de GOS' };
    }

    if (version !== GOS_VAULT_VERSION) {
      return { ok: false, recipes: [], error: 'La version del recetario no es compatible' };
    }

    if (!Array.isArray(recipes)) {
      return { ok: false, recipes: [], error: 'El recetario no contiene una lista de recetas' };
    }

    const parsedRecipes: GosRecipeDraft[] = [];
    for (const r of recipes) {
      if (!r) continue;
      // accepts bare record or {recipe: ...}
      const item = r.recipe && typeof r.recipe === 'object' ? r.recipe : r;
      if (typeof item !== 'object') continue;

      parsedRecipes.push({
        title: typeof item.title === 'string' ? item.title : 'Sin título',
        main_ingredients: Array.isArray(item.main_ingredients) ? item.main_ingredients.filter((i: any) => typeof i === 'string') : [],
        instructions: Array.isArray(item.instructions) ? item.instructions.filter((i: any) => typeof i === 'string' && i.trim() !== '') : [],
        servings: typeof item.servings === 'string' ? item.servings : undefined,
        prep_time: typeof item.prep_time === 'string' ? item.prep_time : undefined,
        cook_time: typeof item.cook_time === 'string' ? item.cook_time : undefined,
      });
    }

    return { ok: true, recipes: parsedRecipes };
  } catch (error: any) {
    return { ok: false, recipes: [], error: 'JSON inválido' };
  }
}

export function normalizeIngredientName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface InventoryMatch {
  id: string; // Fize uses 'id' usually but let's see. Fize components use id, api uses inventoryItemId in lines.
  name: string;
  unit: string;
  unitCost: number;
}

export function matchIngredient(name: string, inventory: InventoryMatch[]): InventoryMatch | null {
  const normalizedName = normalizeIngredientName(name);
  for (const item of inventory) {
    if (normalizeIngredientName(item.name) === normalizedName) {
      return item;
    }
  }
  return null;
}

export function gosRecipeToFizeLines(
  recipe: GosRecipeDraft,
  inventory: InventoryMatch[],
  qty = 1
): { lines: Array<{inventoryItemId: string; name: string; qty: number; unit: string; unitCost: number}>; unmatched: string[] } {
  const lines: Array<{inventoryItemId: string; name: string; qty: number; unit: string; unitCost: number}> = [];
  const unmatched: string[] = [];

  for (const ingName of recipe.main_ingredients) {
    const match = matchIngredient(ingName, inventory);
    if (match) {
      const cost = Number(match.unitCost);
      lines.push({
        inventoryItemId: match.id,
        name: match.name,
        qty,
        unit: match.unit,
        unitCost: Number.isNaN(cost) ? 0 : (cost ?? 0),
      });
    } else {
      unmatched.push(ingName);
    }
  }

  return { lines, unmatched };
}

export function parseServings(raw: unknown): number {
  if (typeof raw === 'number') return Math.max(1, Math.floor(raw));
  if (typeof raw === 'string') {
    const match = raw.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed > 0) return parsed;
    }
  }
  return 1;
}

export function parseMinutes(raw: unknown): number {
  if (typeof raw === 'number') return Math.min(1440, Math.max(0, Math.floor(raw)));
  if (typeof raw === 'string') {
    let str = raw.slice(0, 256).normalize('NFC');
    const hasDigitsOutside = /\d/.test(str.replace(/\([^()]*\)/g, ''));
    if (hasDigitsOutside) {
      // The field is the active prep or cook time, notes in parentheses are passive.
      str = str.replace(/\([^()]*\)/g, '');
    }

    const unitMap: Record<string, number> = {
      d: 1440, 'día': 1440, 'días': 1440, dia: 1440, dias: 1440, day: 1440, days: 1440,
      h: 60, hr: 60, hrs: 60, hs: 60, hora: 60, horas: 60, hour: 60, hours: 60,
      m: 1, min: 1, mins: 1, minuto: 1, minutos: 1, minute: 1, minutes: 1,
      s: 1/60, seg: 1/60, segs: 1/60, segundo: 1/60, segundos: 1/60, sec: 1/60, secs: 1/60, second: 1/60, seconds: 1/60
    };

    const regex = /(?<!\d)((?:\d+(?:[.,]\d+)?))\s*([a-záéíóúüñ]+)(?![a-záéíóúüñ])/gi;
    let total = 0;
    let totalSeconds = 0;
    let hasMatch = false;

    let match;
    while ((match = regex.exec(str)) !== null) {
      const val = parseFloat(match[1].replace(',', '.'));
      const unit = match[2].toLowerCase();

      if (Object.prototype.hasOwnProperty.call(unitMap, unit)) {
        hasMatch = true;
        const multiplier = unitMap[unit];

        if (multiplier < 1) {
          totalSeconds += val;
        } else {
          total += val * multiplier;
        }

        if (multiplier === 60) {
          const rest = str.slice(regex.lastIndex);
          const shorthandMatch = rest.match(/^\s*(\d{1,2})(?![\d.,])(?!\s*[a-záéíóúüñ])/i);
          if (shorthandMatch) {
            const mins = parseInt(shorthandMatch[1], 10);
            if (mins < 60) {
              total += mins;
              regex.lastIndex += shorthandMatch[0].length;
            }
          }
        }
      }
    }

    if (totalSeconds > 0) {
      total += Math.ceil(totalSeconds / 60);
    }

    if (hasMatch) {
      return Math.min(1440, Math.max(0, Math.round(total)));
    }

    const fallback = str.match(/\d+/);
    if (fallback) {
      return Math.min(1440, Math.max(0, parseInt(fallback[0], 10)));
    }
  }
  return 0;
}

export class GosLinkTooLongError extends Error {
  constructor(public length: number, public max: number) {
    super(`El enlace mide ${length} caracteres y el maximo es ${max}: exporta menos recetas o usa el archivo JSON.`);
    this.name = 'GosLinkTooLongError';
  }
}

export function encodeGosLink(recipes: Array<Record<string, unknown>>): string {
  const draftRecipes = [];
  for (const item of recipes) {
    if (!item || typeof item !== 'object') continue;
    draftRecipes.push({
      title: typeof item.title === 'string' ? item.title : 'Sin título',
      main_ingredients: Array.isArray(item.main_ingredients) ? item.main_ingredients.filter(i => typeof i === 'string') : [],
      instructions: Array.isArray(item.instructions) ? item.instructions.filter(i => typeof i === 'string' && i.trim() !== '') : [],
      ...(typeof item.servings === 'string' ? { servings: item.servings } : {}),
      ...(typeof item.prep_time === 'string' ? { prep_time: item.prep_time } : {}),
      ...(typeof item.cook_time === 'string' ? { cook_time: item.cook_time } : {}),
    });
  }

  const payload = {
    format: GOS_VAULT_FORMAT,
    version: GOS_VAULT_VERSION,
    recipes: draftRecipes,
  };

  const jsonStr = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonStr);
  const binStr = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  let b64 = btoa(binStr);
  b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  if (b64.length > GOS_LINK_MAX_CHARS) {
    throw new GosLinkTooLongError(b64.length, GOS_LINK_MAX_CHARS);
  }

  return b64;
}

export function decodeGosLink(search: string): { ok: boolean; recipes: GosRecipeDraft[]; error?: string } {
  try {
    const params = new URLSearchParams(search);
    const paramVal = params.get(GOS_LINK_PARAM);
    if (!paramVal) return { ok: false, recipes: [], error: 'Parametro faltante' };

    if (paramVal.length > GOS_LINK_MAX_CHARS) {
      return { ok: false, recipes: [], error: 'Payload demasiado largo' };
    }

    let b64 = paramVal.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) {
      b64 += '=';
    }

    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const jsonStr = new TextDecoder().decode(bytes);

    return parseGosVaultExport(jsonStr);
  } catch (err: any) {
    return { ok: false, recipes: [], error: 'Base64 inválido o corrupto' };
  }
}
