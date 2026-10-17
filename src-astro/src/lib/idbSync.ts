// idbSync.ts — motor de sincronización IDB → Cloudflare (offline-first)
// Outbox de mutaciones en IndexedDB ('fize-outbox'); al volver online se drena
// hacia el adapter remoto con reintentos exponenciales. Sin IDB (SSR/tests sin
// fake-indexeddb) cae a outbox en memoria.

import type { IDBPDatabase } from 'idb';
import type { StorageAdapter, DomainRecord } from './domain';
import { getActiveDek, getLockState, LockedError } from './local/deviceLock';
import { decryptRow, encryptRow, isEncryptedBlob } from './local/rowCrypto';
import { isTransitionPending } from './local/lockMigration';
import { OUTBOX_STORE, outboxDb as openOutboxDb, resetLocalStoresForTests } from './local/localStores';
import { withStorageGate } from './local/storageGate';

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

export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 500;

let memoryOutbox: OutboxEntry[] = [];
let onlineOverride: boolean | null = null;

let idCounter = 0;

function genId(): string {
  idCounter += 1;
  return `obx-${Date.now().toString(36)}-${String(idCounter).padStart(6, '0')}`;
}

export function resetSyncForTests(): void {
  resetLocalStoresForTests();
  memoryOutbox = [];
  onlineOverride = null;
}

// Vacía el outbox persistido (aislamiento entre tests)
export async function clearOutbox(): Promise<void> {
  memoryOutbox = [];
  if (typeof indexedDB === 'undefined') return;
  await withStorageGate(async () => {
    const database = await outboxDb();
    if (database) await database.clear(OUTBOX_STORE);
  });
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
  return openOutboxDb();
}

/** El `record` del outbox se guarda cifrado cuando la proteccion esta activa (es lo que se sube). */
async function encodeEntry(entry: OutboxEntry): Promise<OutboxEntry> {
  const state = await getLockState();
  if (state === 'locked') throw new LockedError();
  if (state !== 'unlocked') return entry;
  const dek = getActiveDek();
  if (!dek) throw new LockedError();
  return { ...entry, record: await encryptRow(entry.entity, entry.record, dek) };
}

async function decodeEntry(entry: OutboxEntry): Promise<OutboxEntry> {
  const state = await getLockState();
  if (state !== 'unlocked') return entry;
  if (!isEncryptedBlob(entry.record) && isTransitionPending()) return entry;
  const dek = getActiveDek();
  if (!dek) throw new LockedError();
  return { ...entry, record: await decryptRow(entry.entity, entry.record, dek) };
}

async function putEntry(entry: OutboxEntry): Promise<void> {
  const stored = await encodeEntry(entry);
  await withStorageGate(async () => {
    const database = await outboxDb();
    if (database) await database.put(OUTBOX_STORE, stored);
    else memoryOutbox = [...memoryOutbox.filter((e) => e.id !== stored.id), stored];
  });
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
  await putEntry(entry);
  return entry;
}

/**
 * Mutaciones pendientes, con los `record` ya descifrados (es lo que se sube). Con el equipo bloqueado
 * devuelve lista vacia en vez de lanzar: la pantalla que solo cuenta pendientes no puede reventar por
 * estar bloqueada, y sin DEK no hay nada que drenar.
 */
export async function pendingMutations(): Promise<OutboxEntry[]> {
  const state = await getLockState();
  if (state === 'locked') return [];
  const database = await outboxDb();
  const all = database ? ((await database.getAll(OUTBOX_STORE)) as OutboxEntry[]) : [...memoryOutbox];
  const entries = state === 'unlocked' ? await Promise.all(all.map((entry) => decodeEntry(entry))) : all;
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

async function removeEntry(id: string): Promise<void> {
  await withStorageGate(async () => {
    const database = await outboxDb();
    if (database) {
      await database.delete(OUTBOX_STORE, id);
    } else {
      memoryOutbox = memoryOutbox.filter((e) => e.id !== id);
    }
  });
}

async function bumpAttempts(entry: OutboxEntry): Promise<void> {
  await putEntry({ ...entry, attempts: entry.attempts + 1 });
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
