import type { StorageAdapter } from './domain';
import { gramsFor, nutritionPerServing, type GosInventoryLink, type NutritionLine, type ServingNutrition } from './gosNutrition';
import { gos, type createAppGosClient } from './gos';

export type PublicNutrition = Record<string, ServingNutrition>;

/** Only derived totals cross the public boundary; recipe details stay in the adapter. */
export async function loadPublicNutrition(
  adapter: StorageAdapter, instanceId: string, publicIds: string[],
  source: ReturnType<typeof createAppGosClient> = gos,
): Promise<PublicNutrition> {
  const [items, recipes, stock] = await Promise.all([
    adapter.list('menuItem', instanceId), adapter.list('recipe', instanceId),
    adapter.list('inventoryItem', instanceId),
  ]);
  const inventory: GosInventoryLink[] = stock.filter(i => !i.deleted_at).map(i => ({
    id: i.id,
    gosIngredientId: typeof i.gosIngredientId === 'string' ? i.gosIngredientId : undefined,
    gramsPerUnit: typeof i.gramsPerUnit === 'number' ? i.gramsPerUnit : undefined,
  }));
  const allowed = new Set(publicIds);
  const plans = items.filter(i => allowed.has(i.id) && !i.deleted_at && i.isPublic !== false).flatMap(item => {
    const recipe = recipes.filter(r => r.menuItemId === item.id && !r.deleted_at)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const raw = recipe ? recipe.lines : item.recipe;
    if (!Array.isArray(raw)) return [];
    const lines: NutritionLine[] = raw.map((line: Record<string, unknown>) => ({
      inventoryId: String(recipe ? line.inventoryItemId ?? '' : line.inventoryId ?? ''),
      qty: Number(line.qty),
    }));
    return [{ id: item.id, lines, servings: recipe ? Number(recipe.yield) : 1 }];
  });
  const needsGos = plans.some(plan => plan.lines.some(line => inventory.some(i =>
    i.id === line.inventoryId && i.gosIngredientId && gramsFor(line.qty, i.gramsPerUnit) !== undefined,
  )));
  if (!needsGos) return {};
  const snapshot = await source.snapshot();
  if (!snapshot) throw new Error('GOS unavailable');
  const pinned = { ...source, snapshot: async () => snapshot };
  const out: PublicNutrition = {};
  await Promise.all(plans.map(async plan => {
    const totals = await nutritionPerServing(plan.lines, inventory, plan.servings, pinned);
    if (totals) out[plan.id] = totals;
  }));
  return out;
}
