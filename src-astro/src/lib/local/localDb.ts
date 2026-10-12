// localDb.ts — almacen clave/valor del nodo local (IndexedDB `fize-local`).
//
// Va aparte de `fize-db` (datos del negocio, un store por entidad, ver idbAdapter.ts) para no subir la
// version de esa base: aqui viven la llave del restaurante, el avance del onboarding, los ajustes locales
// y el codigo de recuperacion. Todo sigue siendo del mismo origen y se borra con "borrar datos del sitio".
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'fize-local';
const DB_VERSION = 1;
const STORE = 'kv';

/**
 * Claves conocidas. `recoveryCode` NUNCA entra en la copia (la copia se cifra con el) y es el codigo del local
 * ACTUAL (`identity`). `archivedLocals` guarda, por instancia, los locales que este equipo tuvo antes de
 * restaurar la copia de otro local (llave, ajustes y SU codigo). `restorePending` es la marca de una
 * restauracion a medias (ver restoreTx.ts).
 */
export type LocalKey = 'identity' | 'onboarding' | 'settings' | 'recoveryCode' | 'archivedLocals' | 'restorePending';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function resetLocalDbForTests(): void {
  dbPromise = null;
}

function db(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Este navegador no permite guardar datos en el equipo (IndexedDB no disponible).'));
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

export async function getLocal<T>(key: LocalKey): Promise<T | undefined> {
  return (await (await db()).get(STORE, key)) as T | undefined;
}

export async function setLocal<T>(key: LocalKey, value: T): Promise<void> {
  await (await db()).put(STORE, value, key);
}

export async function deleteLocal(key: LocalKey): Promise<void> {
  await (await db()).delete(STORE, key);
}

/** Operaciones dentro de una transaccion de `fize-local` (ver `updateLocalAtomically`). */
export interface LocalTx {
  get<T>(key: LocalKey): Promise<T | undefined>;
  put(key: LocalKey, value: unknown): void;
  del(key: LocalKey): void;
}

/**
 * Lee y escribe varias claves en UNA transaccion: o queda todo o no queda nada (cambiar de local no puede
 * dejar la llave de un local con los ajustes o el codigo de otro). `fn` solo puede esperar lecturas de `tx`.
 */
export async function updateLocalAtomically(fn: (tx: LocalTx) => Promise<void>): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const ops: Promise<unknown>[] = [];
  try {
    await fn({
      get: async <T>(key: LocalKey) => (await tx.store.get(key)) as T | undefined,
      put: (key, value) => {
        ops.push(tx.store.put(value, key));
      },
      del: (key) => {
        ops.push(tx.store.delete(key));
      },
    });
    await Promise.all([...ops, tx.done]);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* ya abortada o terminada */
    }
    await Promise.allSettled([...ops, tx.done]);
    throw err;
  }
}

/** Ajustes locales que no son entidades del dominio (van en la copia cifrada). */
export interface LocalSettings {
  lastBackupAt?: string;
  lastPublishedAt?: string;
  publishedSlug?: string;
  tableCount?: number;
}

export async function getSettings(): Promise<LocalSettings> {
  return (await getLocal<LocalSettings>('settings')) ?? {};
}

export async function patchSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
  const next = { ...(await getSettings()), ...patch };
  await setLocal('settings', next);
  return next;
}
