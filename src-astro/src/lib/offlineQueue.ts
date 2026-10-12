// offlineQueue.ts — IndexedDB offline order buffer + Background Sync
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { domainConfig } from './domain.config';

export interface PendingOrder {
  id: string;
  tableId: string;
  items: unknown[];
  status: string;
  createdAt: number;
  instanceId?: string;
}

interface HostelerDB extends DBSchema {
  pendingOrders: {
    key: string;
    value: PendingOrder;
    indexes: { 'by-createdAt': number };
  };
}

const DB_NAME = 'swal-hosteler-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<HostelerDB>> | null = null;
let memoryOrders: PendingOrder[] = [];

function getDB(): Promise<IDBPDatabase<HostelerDB>> | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB<HostelerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pendingOrders')) {
          const store = db.createObjectStore('pendingOrders', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueOrder(
  order: Omit<PendingOrder, 'id' | 'createdAt'> & { id?: string }
): Promise<PendingOrder> {
  const pending: PendingOrder = {
    id: order.id ?? `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    tableId: order.tableId,
    items: order.items,
    status: order.status || 'pending',
    createdAt: Date.now(),
    instanceId: order.instanceId || domainConfig.instanceId,
  };

  const db = await getDB();
  if (db) {
    await db.put('pendingOrders', pending);
    await registerBackgroundSync();
  } else {
    memoryOrders.push(pending);
  }

  return pending;
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  const db = await getDB();
  if (!db) return memoryOrders;
  return await db.getAllFromIndex('pendingOrders', 'by-createdAt');
}

export async function removePendingOrder(id: string): Promise<void> {
  const db = await getDB();
  if (db) {
    await db.delete('pendingOrders', id);
  } else {
    memoryOrders = memoryOrders.filter((o) => o.id !== id);
  }
}

export async function clearPendingOrders(): Promise<void> {
  memoryOrders = [];
  const db = await getDB();
  if (db) {
    await db.clear('pendingOrders');
  }
}

/** Cuerpo de `POST /api/orders`: el mismo que arma el carrito en linea. */
export interface OrderRequest {
  tableId: string;
  items: Array<{ menuItemId: string; qty: number }>;
}

/** Envio de un pedido a la cocina. Lo usan el camino en linea y la cola. */
export function postOrder(payload: OrderRequest): Promise<Response> {
  return fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Pedidos encolados por versiones anteriores guardaron `{ id, qty }`.
function toOrderRequest(order: PendingOrder): OrderRequest {
  const items = order.items.flatMap((raw) => {
    const r = raw as { menuItemId?: unknown; id?: unknown; qty?: unknown };
    const menuItemId = typeof r.menuItemId === 'string' ? r.menuItemId : r.id;
    if (typeof menuItemId !== 'string' || typeof r.qty !== 'number') return [];
    return [{ menuItemId, qty: r.qty }];
  });
  return { tableId: order.tableId, items };
}

/**
 * Reenvia la cola a la API. Un pedido sale de la cola SOLO si el servidor
 * responde 2xx; con cualquier otra respuesta o sin red se conserva.
 */
export function syncOrders(): Promise<SyncResult> {
  // Una sola pasada a la vez: varios listeners de `online` no deben duplicar pedidos.
  inflightSync ??= runSync().finally(() => {
    inflightSync = null;
  });
  return inflightSync;
}

type SyncResult = { synced: number; failed: number };
let inflightSync: Promise<SyncResult> | null = null;

async function runSync(): Promise<SyncResult> {
  const pending = await getPendingOrders();
  let synced = 0;
  let failed = 0;

  for (const order of pending) {
    try {
      const res = await postOrder(toOrderRequest(order));
      if (!res.ok) {
        console.warn('[offlineQueue] order rejected:', order.id, res.status);
        failed++;
        continue;
      }
      await removePendingOrder(order.id);
      synced++;
    } catch (err) {
      console.warn('[offlineQueue] failed to sync order:', order.id, err);
      failed++;
    }
  }

  return { synced, failed };
}

export async function registerBackgroundSync(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await (registration as unknown as { sync: { register(tag: string): Promise<void> } }).sync.register('sync-orders');
      return true;
    }
  } catch (err) {
    console.warn('[offlineQueue] Background sync registration failed:', err);
  }

  return false;
}
