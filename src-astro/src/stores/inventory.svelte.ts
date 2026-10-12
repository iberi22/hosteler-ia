// inventory.svelte.ts — Svelte 5 runes (inventory store) H1.08
// Canon: estados de stock, alertas, ajuste. Sin deps, persist via localStorage guard.
export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  unit: string; // kg, l, pza
  stock: number;
  minStock: number;
  costPerUnit: number;
  gosIngredientId?: string | null;
  gramsPerUnit?: number | null;
  category?: string;
};

export const inventory = $state<{
  items: InventoryItem[];
  isLoading: boolean;
  lastUpdated: number | null;
}>({
  items: [],
  isLoading: false,
  lastUpdated: null,
});

export function setItems(items: InventoryItem[]) {
  inventory.items = items;
  inventory.lastUpdated = Date.now();
  persist();
}

export function addInventoryItem(item: InventoryItem) {
  inventory.items.push(item);
  inventory.lastUpdated = Date.now();
  persist();
}

export function adjustStock(id: string, delta: number) {
  const it = inventory.items.find((i) => i.id === id);
  if (!it) return;
  it.stock = Math.max(0, it.stock + delta);
  inventory.lastUpdated = Date.now();
  persist();
}

export function getLowStock(): InventoryItem[] {
  return inventory.items.filter((i) => i.stock <= i.minStock);
}

export function getTotalValue(): number {
  return inventory.items.reduce((acc, i) => acc + i.stock * i.costPerUnit, 0);
}

export function setLoading(v: boolean) {
  inventory.isLoading = v;
}

export function clearInventory() {
  inventory.items = [];
  inventory.lastUpdated = Date.now();
  persist();
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      'fize:inventory',
      JSON.stringify({ items: inventory.items, lastUpdated: inventory.lastUpdated }),
    );
  } catch {
    /* ignore quota */
  }
}

export function hydrateInventory() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('fize:inventory');
    if (!raw) return;
    const d = JSON.parse(raw);
    inventory.items = d.items ?? [];
    inventory.lastUpdated = d.lastUpdated ?? null;
  } catch {
    /* ignore parse */
  }
}

// --- Wave-H2.09: wire a StorageAdapter/API (sin romper mocks locales) ---
import type { DomainRecord } from '../lib/domain';
import { mapInventoryItem, fetchCollection } from '../lib/storeSync';
import { domainConfig } from '../lib/domain.config';

export function applyInventoryRecords(records: DomainRecord[]) {
  setItems(records.map(mapInventoryItem));
}

export async function refreshInventoryFromApi(fetchFn: typeof fetch = fetch, instanceId = domainConfig.instanceId) {
  setLoading(true);
  try {
    const records = await fetchCollection(fetchFn, 'inventory', instanceId);
    applyInventoryRecords(records);
    return true;
  } catch {
    if (inventory.items.length === 0) hydrateInventory();
    return false;
  } finally {
    setLoading(false);
  }
}
