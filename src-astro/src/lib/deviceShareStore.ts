// deviceShareStore.ts — almacen LOCAL de los shares E2EE (x=1 dispositivo, x=2 recuperacion).
// Estos shares NUNCA salen del dispositivo (la nube solo tiene x=3) y NUNCA se registran en logs.
// Persistente en IndexedDB (browser). El almacen en memoria existe solo para tests.

import { openDB, type IDBPDatabase } from 'idb';

export interface DeviceShares {
  device: any;
  recovery: any;
}

export interface DeviceShareStore {
  save(id: string, s: DeviceShares): void | Promise<void>;
  load(id: string): DeviceShares | null | Promise<DeviceShares | null>;
}

const DB_NAME = 'fize-device-shares';
const DB_VERSION = 1;
const STORE = 'shares';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function resetDeviceShareDbForTests(): void {
  dbPromise = null;
}

async function db(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable: device shares cannot be persisted');
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/** Almacen persistente (IndexedDB). Sobrevive a recargas. Los errores se propagan (sin log del contenido). */
export function createIdbDeviceShareStore(): DeviceShareStore {
  return {
    async save(id, s) {
      const database = await db();
      await database.put(STORE, { device: s.device, recovery: s.recovery }, id);
    },
    async load(id) {
      const database = await db();
      return ((await database.get(STORE, id)) as DeviceShares | undefined) ?? null;
    },
  };
}

/** SOLO PARA TESTS: se pierde al recargar, por lo que no debe usarse en produccion. */
export function createMemoryDeviceShareStoreForTests(): DeviceShareStore {
  const m = new Map<string, DeviceShares>();
  return {
    save: (id, s) => void m.set(id, s),
    load: (id) => m.get(id) ?? null,
  };
}
