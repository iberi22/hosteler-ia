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
  if (!isLocalPage()) return;
  try {
    localStorage.setItem(
      inventoryCacheKey(cacheInstanceId),
      JSON.stringify({ items: inventory.items, lastUpdated: inventory.lastUpdated }),
    );
  } catch {
    /* ignore quota */
  }
}

// La cache se guarda por local (instanceId): nunca mostrar el inventario de otro restaurante.
export const inventoryCacheKey = (instanceId: string) => `fize:inventory:${instanceId}`;

// Instancia efectiva (identidad local) con la que se guarda la cache; la fija refreshInventoryFromApi.
let cacheInstanceId: string = domainConfig.instanceId ?? 'default';

// Solo en el modo local: el dashboard remoto comparte la store y no debe usar la cache local.
const isLocalPage = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/local/');

export function hydrateInventory(instanceId: string = cacheInstanceId) {
  if (!isLocalPage()) return;
  try {
    const raw = localStorage.getItem(inventoryCacheKey(instanceId ?? 'default'));
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
import { loadIdentity } from '../lib/local/identity';
import { apiFetch } from '../lib/api-client';

export function applyInventoryRecords(records: DomainRecord[]) {
  setItems(records.map(mapInventoryItem));
}

export async function refreshInventoryFromApi(fetchFn: typeof fetch = apiFetch as unknown as typeof fetch, instanceId = domainConfig.instanceId) {
  setLoading(true);
  // La cache va por la identidad local real: el router local fija ese instance_id en cada peticion.
  const ident = await loadIdentity().catch(() => null);
  cacheInstanceId = ident?.instanceId ?? instanceId ?? 'default';
  try {
    const records = await fetchCollection(fetchFn, 'inventory', instanceId);
    applyInventoryRecords(records);
    return true;
  } catch {
    if (inventory.items.length === 0) hydrateInventory(cacheInstanceId);
    return false;
  } finally {
    setLoading(false);
  }
}
