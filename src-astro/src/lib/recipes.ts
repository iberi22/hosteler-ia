// recipes.ts — receta de menuItem: líneas {inventoryId, qty} que se descuentan al servir.
// El descuento usa el ledger inmutable (appendTx 'use'); stock = SUM(transactions).

import type { StorageAdapter } from './domain';
import { appendTx } from './inventoryLedger';

export interface RecipeLine {
  inventoryId: string;
  qty: number;
}

export function isRecipeLine(value: unknown): value is RecipeLine {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.inventoryId === 'string' &&
    v.inventoryId.length > 0 &&
    typeof v.qty === 'number' &&
    Number.isFinite(v.qty) &&
    v.qty > 0
  );
}

export function recipeOf(menuItem: Record<string, unknown>): RecipeLine[] {
  const raw = menuItem.recipe;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecipeLine);
}

export async function assertValidRecipe(
  recipe: unknown,
  adapter: StorageAdapter,
  instanceId: string,
): Promise<RecipeLine[]> {
  if (!Array.isArray(recipe)) {
    throw new Error('Recipe must be an array of {inventoryId, qty} lines');
  }
  const lines: RecipeLine[] = [];
  for (const raw of recipe) {
    if (!isRecipeLine(raw)) {
      throw new Error('Invalid recipe line: expected {inventoryId: non-empty string, qty: positive number}');
    }
    const item = await adapter.get('inventoryItem', raw.inventoryId, instanceId);
    if (!item || (item as Record<string, unknown>).deleted_at) {
      throw new Error(`Recipe references unknown inventory item: ${raw.inventoryId}`);
    }
    lines.push(raw);
  }
  return lines;
}

export async function deductRecipe(
  adapter: StorageAdapter,
  instanceId: string,
  menuItem: Record<string, unknown>,
  times: number,
  orderId: string,
): Promise<number> {
  const lines = recipeOf(menuItem);
  if (lines.length === 0) return 0;
  let movements = 0;
  for (const line of lines) {
    await appendTx(adapter, instanceId, line.inventoryId, 'use', line.qty * times, `order:${orderId}`);
    movements += 1;
  }
  return movements;
}
