import type { Ingredient, Nutrients } from '@swal/gos-client';
import { gos, type createAppGosClient } from './gos';

export interface GosInventoryLink {
  id: string;
  gosIngredientId?: string | null;
  gramsPerUnit?: number | null;
}
export interface NutritionLine { inventoryId: string; qty: number }
export interface ServingNutrition {
  nutrition: Nutrients;
  micronutrients: Nutrients;
  allergens: string[];
  linked: number;
  total: number;
  partial: boolean;
  dataset: string;
}

export function gramsFor(qty: number, gramsPerUnit?: number | null): number | undefined {
  if (!Number.isFinite(qty) || qty <= 0 || typeof gramsPerUnit !== 'number'
    || !Number.isFinite(gramsPerUnit) || gramsPerUnit <= 0) return undefined;
  const grams = qty * gramsPerUnit;
  return Number.isFinite(grams) ? grams : undefined;
}

/** Positive allergen tags only; an empty list does not establish absence. */
export function ingredientAllergens(ingredients: Ingredient[]): string[] {
  return [...new Set(ingredients.flatMap(i => [
    ...i.allergens,
    ...i.tags.filter(tag => tag.startsWith('gos:allergen/')),
  ]))].sort();
}

export async function nutritionPerServing(
  lines: NutritionLine[], inventory: GosInventoryLink[], servings = 1,
  source: ReturnType<typeof createAppGosClient> = gos,
): Promise<ServingNutrition | undefined> {
  if (!lines.length || !Number.isFinite(servings) || servings <= 0) return undefined;
  const byId = new Map(inventory.map(i => [i.id, i]));
  const converted = lines.flatMap(line => {
    const item = byId.get(line.inventoryId);
    const grams = gramsFor(line.qty, item?.gramsPerUnit);
    return item?.gosIngredientId && grams !== undefined
      ? [{ ingredientId: item.gosIngredientId, grams: grams / servings }] : [];
  });
  if (!converted.length) return undefined;
  const snapshot = await source.snapshot();
  if (!snapshot) return undefined;
  const known = new Map(snapshot.ingredients.map(i => [i.id, i]));
  const linked = converted.filter(i => known.has(i.ingredientId));
  if (!linked.length) return undefined;
  const result = await snapshot.client.nutritionFor(converted);
  const allergens = ingredientAllergens(linked.map(i => known.get(i.ingredientId)!));
  if (!Object.keys(result.nutrition).length && !allergens.length) return undefined;
  return {
    nutrition: result.nutrition, micronutrients: result.micronutrients, allergens,
    linked: linked.length, total: lines.length,
    partial: linked.length < lines.length || !result.complete,
    dataset: snapshot.dataset,
  };
}
