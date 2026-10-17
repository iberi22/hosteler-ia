// localStores.ts — un solo sitio con los nombres/versiones de los cuatro almacenes locales y sus conexiones.
//
// Antes cada modulo abria la suya (`fize-db` en idbAdapter, `fize-local` en localDb, `fize-outbox` en
// idbSync, `fize-device-shares` en deviceShareStore). La transicion de cifrado (lockMigration) tiene que
// recorrer los cuatro y no puede depender de esos modulos (deviceLock <- lockMigration <- localDb seria un
// ciclo), asi que las conexiones crudas viven aqui y los modulos las reutilizan: una sola definicion de
// cada `upgrade`, imposible que dos copias se desincronicen.
import { openDB, type IDBPDatabase } from 'idb';

import { domainConfig } from '../domain.config';

export const ENTITY_DB = 'fize-db';
export const ENTITY_DB_VERSION = 1;
export const INSTANCE_INDEX = 'by-instance';

export const KV_DB = 'fize-local';
export const KV_DB_VERSION = 1;
export const KV_STORE = 'kv';

export const OUTBOX_DB = 'fize-outbox';
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE = 'outbox';

export const SHARES_DB = 'fize-device-shares';
export const SHARES_DB_VERSION = 1;
export const SHARES_STORE = 'shares';

export function entityNames(): string[] {
  return domainConfig.entities.map((e) => e.name);
}

let entityDbPromise: Promise<IDBPDatabase> | null = null;
let kvDbPromise: Promise<IDBPDatabase> | null = null;
let outboxDbPromise: Promise<IDBPDatabase> | null = null;
let sharesDbPromise: Promise<IDBPDatabase> | null = null;

/** `fize-db`: un store por entidad del dominio, keyPath 'id' e indice por `instance_id`. */
export function entityDb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable in this environment');
  }
  if (!entityDbPromise) {
    entityDbPromise = openDB(ENTITY_DB, ENTITY_DB_VERSION, {
      upgrade(database) {
        for (const store of entityNames()) {
          if (!database.objectStoreNames.contains(store)) {
            const objectStore = database.createObjectStore(store, { keyPath: 'id' });
            objectStore.createIndex(INSTANCE_INDEX, 'instance_id', { unique: false });
          }
        }
      },
    });
  }
  return entityDbPromise;
}

/** `fize-local`: clave/valor (llave del restaurante, ajustes, codigo, sobre de bloqueo). */
export function kvDb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('Este navegador no permite guardar datos en el equipo (IndexedDB no disponible).'),
    );
  }
  if (!kvDbPromise) {
    kvDbPromise = openDB(KV_DB, KV_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(KV_STORE)) database.createObjectStore(KV_STORE);
      },
    });
  }
  return kvDbPromise;
}

/** `fize-outbox`: mutaciones pendientes de subir (idbSync). */
export function outboxDb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable: outbox cannot be persisted'));
  }
  if (!outboxDbPromise) {
    outboxDbPromise = openDB(OUTBOX_DB, OUTBOX_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          database.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return outboxDbPromise;
}

/** `fize-device-shares`: shares E2EE del dispositivo (nunca salen de aqui). */
export function sharesDb(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable: device shares cannot be persisted'));
  }
  if (!sharesDbPromise) {
    sharesDbPromise = openDB(SHARES_DB, SHARES_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(SHARES_STORE)) database.createObjectStore(SHARES_STORE);
      },
    });
  }
  return sharesDbPromise;
}

/** Cierra/olvida las conexiones (tests y "borrar datos del sitio"). */
export function resetLocalStoresForTests(): void {
  entityDbPromise = null;
  kvDbPromise = null;
  outboxDbPromise = null;
  sharesDbPromise = null;
}
