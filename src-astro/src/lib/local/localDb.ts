// localDb.ts — almacen clave/valor del nodo local (IndexedDB `fize-local`).
//
// Va aparte de `fize-db` (datos del negocio, un store por entidad, ver idbAdapter.ts) para no subir la
// version de esa base: aqui viven la llave del restaurante, el avance del onboarding, los ajustes locales
// y el codigo de recuperacion. Todo sigue siendo del mismo origen y se borra con "borrar datos del sitio".
//
// El valor guardado conserva SU TIPO: `recoveryCode` es un string, `archivedLocals` un objeto, `settings`
// un objeto. Con la proteccion activa se guarda dentro del sobre `{__enc}` (rowCrypto.encryptValue), no
// expandido con `...` en un objeto generico: `{...'ABCD'}` son los indices del string, no el string, y
// `toUpperCase` sobre eso reventaba la copia de seguridad.
import type { IDBPDatabase } from 'idb';

import { getLockState, getActiveDek, LockedError, withLockedWrite, type WriteContext } from './deviceLock';
import { isPlaintextLocalKey, isTransitionPending } from './lockMigration';
import { KV_STORE, kvDb, resetLocalStoresForTests } from './localStores';
import { decryptValue, encryptValue, encryptionOrphanMessage, isEncryptedBlob, PlaintextDataError } from './rowCrypto';
import { withStorageGate } from './storageGate';

export const DB_NAME = 'fize-local';
export const DB_VERSION = 1;
export const STORE = KV_STORE;

/**
 * Claves conocidas. `recoveryCode` NUNCA entra en la copia (la copia se cifra con el) y es el codigo del local
 * ACTUAL (`identity`). `archivedLocals` guarda, por instancia, los locales que este equipo tuvo antes de
 * restaurar la copia de otro local (llave, ajustes y SU codigo). `restorePending` es la marca de una
 * restauracion a medias (ver restoreTx.ts). `lockEnvelope` (sobre del bloqueo), `lockThrottle` (intentos
 * fallidos) y `lockTransition` (marcador de la migracion) van SIEMPRE en claro: hacen falta antes de tener
 * la llave.
 */
export type LocalKey =
  | 'identity'
  | 'onboarding'
  | 'settings'
  | 'recoveryCode'
  | 'archivedLocals'
  | 'restorePending'
  | 'lockEnvelope'
  | 'lockThrottle'
  | 'lockTransition';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function resetLocalDbForTests(): void {
  dbPromise = null;
  resetLocalStoresForTests();
}

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) dbPromise = kvDb();
  return dbPromise;
}

function requireDek(): CryptoKey {
  const dek = getActiveDek();
  if (!dek) throw new LockedError();
  return dek;
}

/**
 * Un valor cifrado con el sobre borrado no se devuelve nunca como si fuera dato (seria basura). Y, al
 * reves: con la proteccion activa, un valor EN CLARO solo se acepta si ESTA pestaña tiene una transicion de
 * desactivacion a medias (a mitad de desactivar parte de los datos ya esta descifrada y la DEK todavia
 * existe).
 */
function assertReadable(key: LocalKey, value: unknown): void {
  if (isEncryptedBlob(value)) throw new Error(encryptionOrphanMessage(`"${key}"`));
}

function readUnlocked<T>(key: LocalKey, value: unknown, dek: CryptoKey): Promise<T> {
  if (isEncryptedBlob(value)) return decryptValue<T>(key, value, dek);
  if (isTransitionPending()) return Promise.resolve(value as T);
  return Promise.reject(new PlaintextDataError(`el valor "${key}"`));
}

export async function getLocal<T>(key: LocalKey): Promise<T | undefined> {
  const raw = (await (await db()).get(STORE, key)) as T | unknown;
  if (raw === undefined || isPlaintextLocalKey(key)) return raw as T | undefined;
  const state = await getLockState();
  if (state === 'locked') throw new LockedError();
  if (state === 'unlocked') return readUnlocked<T>(key, raw, requireDek());
  assertReadable(key, raw);
  return raw as T;
}

/** Lee la llave de un valor tal como quedo guardado (para la migracion y las comprobaciones). */
export async function getStoredLocal(key: LocalKey): Promise<unknown> {
  return (await (await db()).get(STORE, key)) as unknown;
}

export async function setLocal<T>(key: LocalKey, value: T): Promise<void> {
  // El cifrado va DENTRO del candado y con el estado releido: si desactivar la proteccion gana el turno,
  // este valor se guarda en claro (estado nuevo) en vez de quedar cifrado con una llave que ya no existe.
  await withLockedWrite(async (ctx) => {
    const stored = await prepareStoredValue(key, value, ctx);
    await (await db()).put(STORE, stored, key);
  });
}

async function prepareStoredValue(
  key: LocalKey,
  value: unknown,
  ctx: WriteContext,
): Promise<unknown> {
  if (isPlaintextLocalKey(key)) return value;
  return ctx.state === 'unlocked' ? encryptValue(key, value, ctx.dek) : value;
}

export async function deleteLocal(key: LocalKey): Promise<void> {
  await withStorageGate(async () => {
    await (await db()).delete(STORE, key);
  });
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
  // Todo (lecturas, cifrado y la transaccion) ocurre dentro del candado: cifrar fuera dejaba huerfanos si
  // desactivar la proteccion se colaba en medio.
  await withLockedWrite(async (ctx) => {
    const gets = async <T>(key: LocalKey): Promise<T | undefined> => {
       const database = await db();
       const raw = (await database.get(STORE, key)) as T | undefined;
       if (raw === undefined || isPlaintextLocalKey(key)) return raw;
       if (ctx.state === 'unlocked') return readUnlocked<T>(key, raw, ctx.dek);
       assertReadable(key, raw);
       return raw;
    };

    const buffer: { op: 'put' | 'del', key: LocalKey, value?: unknown }[] = [];

    await fn({
        get: gets,
        put: (key, value) => { buffer.push({ op: 'put', key, value }); },
        del: (key) => { buffer.push({ op: 'del', key }); }
    });

    // Se cifra ANTES de abrir la transaccion: una transaccion de IndexedDB se cierra sola en cuanto el
    // control sale a un `await` que no sea una operacion suya.
    const prepared: { op: 'put' | 'del', key: LocalKey, value?: unknown }[] = [];
    for (const b of buffer) {
       if (b.op === 'put') {
          prepared.push({ op: 'put', key: b.key, value: await prepareStoredValue(b.key, b.value, ctx) });
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
  });
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
