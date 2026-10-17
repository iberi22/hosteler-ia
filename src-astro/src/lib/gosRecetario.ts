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

    const parsedRecipes: GosRecipeDraft[] = recipes.map((r: any) => {
      // accepts bare record or {recipe: ...}
      const item = r.recipe && typeof r.recipe === 'object' ? r.recipe : r;

      return {
        title: typeof item.title === 'string' ? item.title : 'Sin título',
        main_ingredients: Array.isArray(item.main_ingredients) ? item.main_ingredients.filter((i: any) => typeof i === 'string') : [],
        instructions: Array.isArray(item.instructions) ? item.instructions.filter((i: any) => typeof i === 'string') : [],
        servings: typeof item.servings === 'string' ? item.servings : undefined,
        prep_time: typeof item.prep_time === 'string' ? item.prep_time : undefined,
        cook_time: typeof item.cook_time === 'string' ? item.cook_time : undefined,
      };
    });

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
      lines.push({
        inventoryItemId: match.id, // we might need to map it appropriately depending on how InventoryMatch is used in components. The issue says: match.id
        name: match.name,
        qty,
        unit: match.unit,
        unitCost: match.unitCost,
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
  if (typeof raw === 'number') return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string') {
    const match = raw.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 0) return parsed;
    }
  }
  return 0;
}

export function encodeGosLink(recipes: Array<Record<string, unknown>>): string {
  const draftRecipes = recipes.map(item => ({
    title: typeof item.title === 'string' ? item.title : 'Sin título',
    main_ingredients: Array.isArray(item.main_ingredients) ? item.main_ingredients.filter(i => typeof i === 'string') : [],
    instructions: Array.isArray(item.instructions) ? item.instructions.filter(i => typeof i === 'string') : [],
    ...(typeof item.servings === 'string' ? { servings: item.servings } : {}),
    ...(typeof item.prep_time === 'string' ? { prep_time: item.prep_time } : {}),
    ...(typeof item.cook_time === 'string' ? { cook_time: item.cook_time } : {}),
  }));

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
