// storeSync.ts — mappers puros StorageAdapter → shapes de stores Svelte.
// Los .svelte.ts usan runes ($state) y no son importables en vitest;
// esta capa pura SÍ es testeable y los stores la consumen como glue fino.

import type { DomainRecord } from './domain';
import { domainConfig } from './domain.config';

type Rec = Record<string, unknown>;

export interface StoreInventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  gosIngredientId?: string | null;
  gramsPerUnit?: number | null;
}

export function mapInventoryItem(r: DomainRecord): StoreInventoryItem {
  const v = r as unknown as Rec;
  return {
    id: r.id,
    sku: String(v.sku ?? r.id),
    name: String(v.name ?? ''),
    unit: String(v.unit ?? 'ud'),
    stock: Number(v.stock ?? 0),
    minStock: Number(v.minStock ?? 0),
    costPerUnit: Number(v.costPerUnit ?? 0),
    ...(typeof v.gosIngredientId === 'string' ? { gosIngredientId: v.gosIngredientId } : {}),
    ...(typeof v.gramsPerUnit === 'number' ? { gramsPerUnit: v.gramsPerUnit } : {}),
  };
}

export interface StoreMenuCategory {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export function mapCategory(r: DomainRecord, index = 0): StoreMenuCategory {
  const v = r as unknown as Rec;
  return {
    id: r.id,
    name: String(v.name ?? ''),
    description: v.description === null ? undefined : (v.description as string | undefined),
    sortOrder: Number(v.sortOrder ?? index + 1),
    isActive: v.isActive === undefined ? true : Boolean(v.isActive),
  };
}

export interface StoreMenuItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  price: number;
  categoryId: string;
  isAvailable: boolean;
  tags: string[];
}

export function mapMenuItem(r: DomainRecord): StoreMenuItem {
  const v = r as unknown as Rec;
  return {
    id: r.id,
    sku: String(v.sku ?? r.id),
    name: String(v.name ?? ''),
    description: (v.description as string | undefined) ?? undefined,
    price: Number(v.price ?? 0),
    categoryId: String(v.categoryId ?? ''),
    isAvailable: v.isAvailable === undefined ? true : Boolean(v.isAvailable),
    tags: Array.isArray(v.tags) ? (v.tags as string[]) : [],
  };
}

export interface StoreOrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface StoreOrder {
  id: string;
  tableId: string | null;
  items: StoreOrderItem[];
  totalPrice: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

export function mapOrder(r: DomainRecord): StoreOrder {
  const v = r as unknown as Rec;
  const rawItems = Array.isArray(v.items) ? (v.items as Rec[]) : [];
  const items: StoreOrderItem[] = rawItems.map((it) => ({
    menuItemId: String(it.menuItemId ?? it.id ?? ''),
    name: String(it.name ?? ''),
    quantity: Number(it.qty ?? it.quantity ?? 1),
    unitPrice: Number(it.unitPrice ?? it.price ?? 0),
  }));
  return {
    id: r.id,
    tableId: (v.tableId as string | null) ?? null,
    items,
    totalPrice: items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0),
    status: String(v.status ?? 'pending'),
    createdAt: Date.parse(String(r.created_at)) || Date.now(),
    updatedAt: Date.parse(String(r.updated_at)) || Date.now(),
    notes: (v.note as string | undefined) ?? (v.notes as string | undefined),
  };
}

export interface StoreSession {
  user: { id: string; email: string; name?: string } | null;
  profile: { id: string; restaurant_id: string; role: string; restaurant: { id: string; name: string } } | null;
}

export function mapSession(me: Rec | null): StoreSession {
  if (!me) return { user: null, profile: null };
  return {
    user: me.user ? (me.user as StoreSession['user']) : null,
    profile: me.profile ? (me.profile as StoreSession['profile']) : null,
  };
}

// GET /api/<path>?instance_id= — helper browser para refresh desde API.
export async function fetchCollection(
  fetchFn: typeof fetch,
  path: string,
  instanceId = domainConfig.instanceId,
): Promise<DomainRecord[]> {
  const res = await fetchFn(`/api/${path}?instance_id=${encodeURIComponent(instanceId)}`);
  if (!res.ok) throw new Error(`GET /api/${path} → ${res.status}`);
  return (await res.json()) as DomainRecord[];
}
