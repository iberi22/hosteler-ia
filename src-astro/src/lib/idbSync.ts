// idbSync.ts — motor de sincronización IDB → Cloudflare (offline-first)
// Outbox de mutaciones en IndexedDB ('fize-outbox'); al volver online se drena
// hacia el adapter remoto con reintentos exponenciales. Sin IDB (SSR/tests sin
// fake-indexeddb) cae a outbox en memoria.

import { openDB, type IDBPDatabase } from 'idb';
import type { StorageAdapter, DomainRecord } from './domain';

export type MutationOp = 'create' | 'update' | 'del';

export interface OutboxEntry {
  id: string;
  entity: string;
  op: MutationOp;
  record: DomainRecord;
  instanceId: string;
  attempts: number;
  createdAt: number;
}

const DB_NAME = 'fize-outbox';
const DB_VERSION = 1;
export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 500;

let dbPromise: Promise<IDBPDatabase> | null = null;
let memoryOutbox: OutboxEntry[] = [];
let onlineOverride: boolean | null = null;

let idCounter = 0;

function genId(): string {
  idCounter += 1;
  return `obx-${Date.now().toString(36)}-${String(idCounter).padStart(6, '0')}`;
}

export function resetSyncForTests(): void {
  dbPromise = null;
  memoryOutbox = [];
  onlineOverride = null;
}

// Vacía el outbox persistido (aislamiento entre tests)
export async function clearOutbox(): Promise<void> {
  memoryOutbox = [];
  if (typeof indexedDB === 'undefined') {
    dbPromise = null;
    return;
  }
  const database = await outboxDb();
  if (database) {
    await database.clear('outbox');
  }
}

// Solo tests: fuerza el estado online/offline (jsdom no permite navigator.onLine)
export function setOnlineOverride(value: boolean | null): void {
  onlineOverride = value;
}

export function isOnline(): boolean {
  if (onlineOverride !== null) return onlineOverride;
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

async function outboxDb(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('outbox')) {
          database.createObjectStore('outbox', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueMutation(
  entity: string,
  op: MutationOp,
  record: DomainRecord,
  instanceId: string,
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: genId(),
    entity,
    op,
    record,
    instanceId,
    attempts: 0,
    createdAt: Date.now(),
  };
  const database = await outboxDb();
  if (database) {
    await database.put('outbox', entry);
  } else {
    memoryOutbox.push(entry);
  }
  return entry;
}

export async function pendingMutations(): Promise<OutboxEntry[]> {
  const database = await outboxDb();
  if (database) {
    const all = (await database.getAll('outbox')) as OutboxEntry[];
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }
  return [...memoryOutbox].sort((a, b) => a.createdAt - b.createdAt);
}

async function removeEntry(id: string): Promise<void> {
  const database = await outboxDb();
  if (database) {
    await database.delete('outbox', id);
  } else {
    memoryOutbox = memoryOutbox.filter((e) => e.id !== id);
  }
}

async function bumpAttempts(entry: OutboxEntry): Promise<void> {
  const database = await outboxDb();
  const next = { ...entry, attempts: entry.attempts + 1 };
  if (database) {
    await database.put('outbox', next);
  } else {
    memoryOutbox = memoryOutbox.map((e) => (e.id === entry.id ? next : e));
  }
}

export function backoffDelayMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** attempts;
}

async function applyMutation(remote: StorageAdapter, entry: OutboxEntry): Promise<void> {
  if (entry.op === 'create') {
    await remote.create(entry.entity, entry.record);
  } else if (entry.op === 'update') {
    await remote.update(entry.entity, entry.record.id, entry.record as unknown as Record<string, unknown>, entry.instanceId);
  } else {
    await remote.del(entry.entity, entry.record.id, entry.instanceId);
  }
}

export interface DrainResult {
  synced: number;
  failed: number;
  skipped: number;
}

// Drena el outbox hacia el remoto. Solo corre online; respeta backoff por entry.
export async function drainOutbox(remote: StorageAdapter): Promise<DrainResult> {
  const result: DrainResult = { synced: 0, failed: 0, skipped: 0 };
  if (!isOnline()) {
    result.skipped = (await pendingMutations()).length;
    return result;
  }

  for (const entry of await pendingMutations()) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      result.failed += 1;
      continue;
    }
    try {
      await applyMutation(remote, entry);
      await removeEntry(entry.id);
      result.synced += 1;
    } catch {
      await bumpAttempts(entry);
      result.failed += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return result;
}

// Escucha online/offline del browser y drena automáticamente al reconectar.
// Retorna función para desuscribir (útil en tests y cleanup Svelte).
export function watchConnectivity(getRemote: () => StorageAdapter): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    void drainOutbox(getRemote());
  };
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}
