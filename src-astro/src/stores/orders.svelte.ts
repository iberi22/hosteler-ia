// orders.svelte.ts — Svelte 5 runes (orders store) H1.08
// Canon: estados de pedido, transiciones, sync con backend via api-client.
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';

export type Order = {
  id: string;
  tableId: string | null;
  items: { menuItemId: string; name: string; quantity: number; unitPrice: number }[];
  totalPrice: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  notes?: string;
};

export const orders = $state<{
  list: Order[];
  isLoading: boolean;
  activeOrderId: string | null;
}>({
  list: [],
  isLoading: false,
  activeOrderId: null,
});

export function createOrder(input: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Order {
  const order: Order = {
    ...input,
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  orders.list.push(order);
  orders.activeOrderId = order.id;
  persist();
  return order;
}

export function setStatus(id: string, status: OrderStatus) {
  const o = orders.list.find((x) => x.id === id);
  if (!o) return;
  o.status = status;
  o.updatedAt = Date.now();
  persist();
}

export function getActiveOrder(): Order | null {
  return orders.list.find((o) => o.id === orders.activeOrderId) ?? null;
}

export function getByStatus(status: OrderStatus): Order[] {
  return orders.list.filter((o) => o.status === status);
}

export function clearOrders() {
  orders.list = [];
  orders.activeOrderId = null;
  persist();
}

export function setLoading(v: boolean) {
  orders.isLoading = v;
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      'fize:orders',
      JSON.stringify({ list: orders.list, activeOrderId: orders.activeOrderId }),
    );
  } catch {
    /* ignore quota */
  }
}

export function hydrateOrders() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('fize:orders');
    if (!raw) return;
    const d = JSON.parse(raw);
    orders.list = d.list ?? [];
    orders.activeOrderId = d.activeOrderId ?? null;
  } catch {
    /* ignore parse */
  }
}

// --- Wave-H2.11: wire a StorageAdapter/API con state machine del server ---
import type { DomainRecord } from '../lib/domain';
import { mapOrder, fetchCollection } from '../lib/storeSync';
import type { StoreOrder } from '../lib/storeSync';
import { domainConfig } from '../lib/domain.config';

export function applyOrderRecords(records: DomainRecord[]) {
  orders.list = records.map((r) => mapOrder(r) as unknown as Order);
  persist();
}

export async function refreshOrdersFromApi(fetchFn: typeof fetch = fetch, instanceId = domainConfig.instanceId) {
  orders.isLoading = true;
  try {
    const records = await fetchCollection(fetchFn, 'orders', instanceId);
    applyOrderRecords(records);
  } finally {
    orders.isLoading = false;
  }
}

export type { StoreOrder };