// idbAdapter.ts — StorageAdapter sobre IndexedDB (PWA offline-first)
// Un object store por entidad (keyPath 'id') + índice 'by-instance' en instance_id.
// Lazy init en browser; misma semántica que MemoryAdapter (del = hard delete,
// los soft deletes se hacen vía update({ deleted_at })).

import { openDB, type IDBPDatabase } from 'idb';
import { domainConfig } from './domain.config';
import type { StorageAdapter, DomainRecord } from './domain';
import { ensurePersistentStorage, reportIfQuotaExceeded } from './storageDurability';

const DB_NAME = 'fize-db';
const DB_VERSION = 1;
const INSTANCE_INDEX = 'by-instance';

let dbPromise: Promise<IDBPDatabase> | null = null;

function entityStores(): string[] {
  return domainConfig.entities.map((e) => e.name);
}

export function resetIdbForTests(): void {
  dbPromise = null;
}

async function db(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable in this environment');
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        for (const store of entityStores()) {
          if (!database.objectStoreNames.contains(store)) {
            const objectStore = database.createObjectStore(store, { keyPath: 'id' });
            objectStore.createIndex(INSTANCE_INDEX, 'instance_id', { unique: false });
          }
        }
      },
    });
  }
  return dbPromise;
}

/** Escritura con persist() en la primera vez y aviso visible si se agota la cuota. */
async function write(entity: string, record: DomainRecord): Promise<void> {
  const database = await db();
  void ensurePersistentStorage();
  try {
    await database.put(entity, record);
  } catch (e) {
    // No se traga: se avisa al usuario y se relanza (el cambio no quedó guardado).
    await reportIfQuotaExceeded(e);
    throw e;
  }
}

/** Un registro entrante tiene el mismo `id` que uno de OTRA instancia guardada en este equipo. */
export class RowConflictError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`El registro ${entity}/${id} pertenece a otro local de este equipo.`);
    this.name = 'RowConflictError';
  }
}

export class IndexedDBAdapter implements StorageAdapter {
  /**
   * Deja las filas de `instanceId` exactamente iguales a `rowsByEntity`, en UNA transaccion de IndexedDB
   * sobre todos los stores: primero escribe (upsert) lo que llega y despues borra lo que ya no esta.
   * Si algo falla (cuota llena, registro que choca con otra instancia, pestaña cerrada) la transaccion se
   * aborta y no cambia nada. Las filas de las DEMAS instancias nunca se tocan.
   */
  async replaceInstanceRows(instanceId: string, rowsByEntity: Record<string, DomainRecord[]>): Promise<void> {
    const database = await db();
    const names = Object.keys(rowsByEntity);
    if (names.length === 0) return;
    void ensurePersistentStorage();
    const tx = database.transaction(names, 'readwrite');
    const done = tx.done;
    done.catch(() => {
      /* el error se maneja abajo */
    });
    try {
      for (const entity of names) {
        const store = tx.objectStore(entity);
        const incoming = rowsByEntity[entity];
        const keep = new Set<string>();
        for (const record of incoming) {
          if (record.instance_id !== instanceId) throw new RowConflictError(entity, String(record.id));
          const existing = (await store.get(record.id)) as DomainRecord | undefined;
          if (existing && existing.instance_id !== instanceId) throw new RowConflictError(entity, String(record.id));
          await store.put(record);
          keep.add(String(record.id));
        }
        const keys = await store.index(INSTANCE_INDEX).getAllKeys(instanceId);
        for (const key of keys) if (!keep.has(String(key))) await store.delete(key);
      }
      await done;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* ya abortada */
      }
      await reportIfQuotaExceeded(e);
      throw e;
    }
  }

  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    await write(entity, record);
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    const database = await db();
    const index = database.transaction(entity).store.index(INSTANCE_INDEX);
    return (await index.getAll(instanceId)) as DomainRecord[];
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const database = await db();
    const record = (await database.get(entity, id)) as DomainRecord | undefined;
    if (!record || record.instance_id !== instanceId) return null;
    return record;
  }

  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
  ): Promise<DomainRecord | null> {
    const current = await this.get(entity, id, instanceId);
    if (!current) return null;
    const next = { ...current, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    await write(entity, next);
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const current = await this.get(entity, id, instanceId);
    if (!current) return false;
    const database = await db();
    await database.delete(entity, id);
    return true;
  }
}

let shared: IndexedDBAdapter | null = null;

export function getIdbAdapter(): IndexedDBAdapter {
  if (!shared) shared = new IndexedDBAdapter();
  return shared;
}
