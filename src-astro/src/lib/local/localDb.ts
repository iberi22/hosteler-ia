// localDb.ts — almacen clave/valor del nodo local (IndexedDB `fize-local`).
//
// Va aparte de `fize-db` (datos del negocio, un store por entidad, ver idbAdapter.ts) para no subir la
// version de esa base: aqui viven la llave del restaurante, el avance del onboarding, los ajustes locales
// y el codigo de recuperacion. Todo sigue siendo del mismo origen y se borra con "borrar datos del sitio".
import { openDB, type IDBPDatabase } from 'idb';

import { getLockState, getActiveDek, LockedError } from './deviceLock';
import { encryptRow, decryptRow } from './rowCrypto';


const DB_NAME = 'fize-local';
const DB_VERSION = 1;
const STORE = 'kv';

/**
 * Claves conocidas. `recoveryCode` NUNCA entra en la copia (la copia se cifra con el) y es el codigo del local
 * ACTUAL (`identity`). `archivedLocals` guarda, por instancia, los locales que este equipo tuvo antes de
 * restaurar la copia de otro local (llave, ajustes y SU codigo). `restorePending` es la marca de una
 * restauracion a medias (ver restoreTx.ts).
 */
export type LocalKey = 'identity' | 'onboarding' | 'settings' | 'recoveryCode' | 'archivedLocals' | 'restorePending' | 'lockEnvelope';

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
  const raw = (await (await db()).get(STORE, key)) as T | undefined;
  if (!raw || key === 'lockEnvelope') return raw;
  const state = await getLockState();
  if (state === 'locked') throw new LockedError();
  if (state === 'unlocked') {
     const dek = getActiveDek();
     if (!dek) throw new LockedError();
     const encRow = { id: key, instance_id: 'local', ...raw };
     const decRow = await decryptRow('localKV', encRow as any, dek);
     const { id, instance_id, __enc, ...businessFields } = decRow as any;
     return businessFields as unknown as T;
  }
  return raw;
}



export async function setLocal<T>(key: LocalKey, value: T): Promise<void> {
  let finalValue = value;
  if (key !== 'lockEnvelope') {
      const state = await getLockState();
      if (state === 'locked') throw new LockedError();
      if (state === 'unlocked') {
         const dek = getActiveDek();
         if (!dek) throw new LockedError();
         const row = { id: key, instance_id: 'local', ...(value as any) };
         const encRow = await encryptRow('localKV', row, dek);
         const { id, instance_id, ...businessFields } = encRow as any;
         finalValue = businessFields as unknown as T;
      }
  }
  await (await db()).put(STORE, finalValue, key);
}


export async function deleteLocal(key: LocalKey): Promise<void> {
  await (await db()).delete(STORE, key);
}

/** Operaciones dentro de una transaccion de `fize-local` (ver `updateLocalAtomically`). */
export interface LocalTx {
  get<T>(key: LocalKey): Promise<T | undefined>;
  put(key: LocalKey, value: unknown): Promise<void> | void;
  del(key: LocalKey): void;
}

/**
 * Lee y escribe varias claves en UNA transaccion: o queda todo o no queda nada (cambiar de local no puede
 * dejar la llave de un local con los ajustes o el codigo de otro). `fn` solo puede esperar lecturas de `tx`.
 */

export async function updateLocalAtomically(fn: (tx: LocalTx) => Promise<void>): Promise<void> {
  const state = await getLockState();
  if (state === 'locked') throw new LockedError();
  const dek = state === 'unlocked' ? getActiveDek() : null;
  if (state === 'unlocked' && !dek) throw new LockedError();

  const gets = async <T>(key: LocalKey): Promise<T | undefined> => {
     const database = await db();
     const raw = (await database.get(STORE, key)) as T | undefined;
     if (!raw || key === 'lockEnvelope') return raw;
     if (state === 'unlocked') {
        const encRow = { id: key, instance_id: 'local', ...raw };
        const decRow = await decryptRow('localKV', encRow as any, dek!);
        const { id, instance_id, __enc, ...businessFields } = decRow as any;
        return businessFields as unknown as T;
     }
     return raw;
  };

  const buffer: { op: 'put' | 'del', key: LocalKey, value?: any }[] = [];

  await fn({
      get: gets,
      put: (key, value) => { buffer.push({ op: 'put', key, value }); },
      del: (key) => { buffer.push({ op: 'del', key }); }
  });

  // Encrypt
  const prepared: { op: 'put' | 'del', key: LocalKey, value?: any }[] = [];
  for (const b of buffer) {
     if (b.op === 'put') {
        let finalValue = b.value;
        if (b.key !== 'lockEnvelope' && state === 'unlocked') {
           const row = { id: b.key, instance_id: 'local', ...(b.value as any) };
           const encRow = await encryptRow('localKV', row, dek!);
           const { id, instance_id, ...businessFields } = encRow as any;
           finalValue = businessFields;
        }
        prepared.push({ op: 'put', key: b.key, value: finalValue });
     } else {
        prepared.push(b);
     }
  }

  // Execute tx
  const database = await db();
  const tx = database.transaction(STORE, 'readwrite');
  const ops: Promise<unknown>[] = [];
  try {
     for (const p of prepared) {
        if (p.op === 'put') ops.push(tx.store.put(p.value, p.key));
        else ops.push(tx.store.delete(p.key));
     }
     await Promise.all([...ops, tx.done]);
  } catch (err) {
     try { tx.abort(); } catch {}
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
