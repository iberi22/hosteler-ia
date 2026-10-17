// idbAdapter.ts — StorageAdapter sobre IndexedDB (PWA offline-first)
// Un object store por entidad (keyPath 'id') + índice 'by-instance' en instance_id.
// Lazy init en browser; misma semántica que MemoryAdapter (del = hard delete,
// los soft deletes se hacen vía update({ deleted_at })).

import type { StorageAdapter, DomainRecord } from './domain';
import { ensurePersistentStorage, reportIfQuotaExceeded } from './storageDurability';

import { getLockState, getActiveDek, LockedError, withLockedWrite } from './local/deviceLock';
import { isTransitionPending } from './local/lockMigration';
import { encryptRow, decryptRow, encryptionOrphanMessage, isEncryptedBlob } from './local/rowCrypto';
import { entityDb, INSTANCE_INDEX, resetLocalStoresForTests } from './local/localStores';
import { withStorageGate } from './local/storageGate';

export function resetIdbForTests(): void {
  resetLocalStoresForTests();
}

/** Una lectura con la proteccion activa necesita la DEK; sin ella no se lee nada (ni en claro). */
async function unlockedDek(): Promise<CryptoKey> {
  const dek = getActiveDek();
  if (!dek) throw new LockedError();
  return dek;
}

/**
 * Descifra una fila guardada. Estricto: sin `__enc` lanza (texto plano inyectado). La unica excepcion es la
 * transicion de desactivacion a medias, donde parte de las filas ya estan descifradas y la DEK sigue viva.
 */
async function readStored(entity: string, record: DomainRecord, dek: CryptoKey): Promise<DomainRecord> {
  if (!isEncryptedBlob(record) && isTransitionPending()) return record;
  return decryptRow(entity, record, dek);
}

/**
 * Con la proteccion DESACTIVADA una fila que sigue con `{__enc}` no es una fila: es un dato que se quedo sin
 * llave (el sobre se borro sin descifrarlo). Devolverla dejaba el sobre cifrado en la pantalla como si
 * fuera negocio. `localDb` y los shares ya lo rechazaban; el adapter tiene que hacer lo mismo.
 */
function assertNotEncrypted(entity: string, record: DomainRecord): void {
  if (isEncryptedBlob(record)) {
    throw new Error(encryptionOrphanMessage(`${entity}/${String((record as { id?: unknown }).id)}`));
  }
}

/** Escritura con persist() en la primera vez y aviso visible si se agota la cuota. */
async function write(entity: string, record: DomainRecord): Promise<void> {
  void ensurePersistentStorage();
  try {
    // Estado, cifrado y `put` bajo el MISMO turno del candado: cifrar antes dejaba un `{__enc}` huerfano
    // si desactivar la proteccion se colaba en medio (la llave nueva no abre lo que cifro la vieja).
    await withLockedWrite(async (ctx) => {
      const finalRecord = ctx.state === 'unlocked' ? await encryptRow(entity, record, ctx.dek) : record;
      const database = await entityDb();
      await database.put(entity, finalRecord);
    });
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
   *
   * Con la proteccion activa: se RECHAZA si el equipo esta bloqueado y, si esta desbloqueado, las filas se
   * cifran DENTRO del candado: un `await` de WebCrypto no puede quedar fuera, o una desactivacion que gane
   * el turno borraria el sobre y dejaria las filas cifradas con una llave que ya no existe.
   */
  async replaceInstanceRows(instanceId: string, rowsByEntity: Record<string, DomainRecord[]>): Promise<void> {
    const names = Object.keys(rowsByEntity);
    if (names.length === 0) return;
    void ensurePersistentStorage();

    await withLockedWrite(async (ctx) => {
      const prepared: Record<string, DomainRecord[]> = {};
      for (const entity of names) {
        const rows = rowsByEntity[entity];
        prepared[entity] =
          ctx.state === 'unlocked'
            ? await Promise.all(rows.map((record) => encryptRow(entity, record, ctx.dek)))
            : rows;
      }

      const database = await entityDb();
      const tx = database.transaction(names, 'readwrite');
      const done = tx.done;
      done.catch(() => {
        /* el error se maneja abajo */
      });
      try {
        for (const entity of names) {
          const store = tx.objectStore(entity);
          const incoming = prepared[entity];
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
    });
  }

  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    await write(entity, record);
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {

    const state = await getLockState();
    if (state === 'locked') throw new LockedError();
    const database = await entityDb();
    const index = database.transaction(entity).store.index(INSTANCE_INDEX);
    const records = (await index.getAll(instanceId)) as DomainRecord[];

    if (state === 'unlocked') {
       const dek = await unlockedDek();
       return Promise.all(records.map(r => readStored(entity, r, dek)));
    }
    for (const record of records) assertNotEncrypted(entity, record);
    return records;

  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {

    const state = await getLockState();
    if (state === 'locked') throw new LockedError();
    const database = await entityDb();
    const record = (await database.get(entity, id)) as DomainRecord | undefined;
    if (!record || record.instance_id !== instanceId) return null;

    if (state === 'unlocked') {
       const dek = await unlockedDek();
       return await readStored(entity, record, dek);
    }
    assertNotEncrypted(entity, record);
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
    await withStorageGate(async () => {
      const database = await entityDb();
      await database.delete(entity, id);
    });
    return true;
  }
}

let shared: IndexedDBAdapter | null = null;

export function getIdbAdapter(): IndexedDBAdapter {
  if (!shared) shared = new IndexedDBAdapter();
  return shared;
}
