// lockMigration.ts — transicion de cifrado de TODO lo que ya habia en el equipo.
//
// Activar la proteccion con filas ya guardadas no puede limitarse a crear el sobre y la DEK: lo que ya
// estaba escrito seguiria en claro (y `identity.privateJwk`, que es la llave del restaurante, tambien).
// Desactivarla no puede limitarse a borrar el sobre: las filas quedarian con `{__enc: ...}` sin llave para
// abrirlas y volver a activar perderia los datos. Las dos direcciones recorren los mismos cuatro almacenes:
//
//   local (fize-local, clave/valor)  · entidades (fize-db) · outbox (fize-outbox) · shares E2EE
//
// La transicion es REANUDABLE: antes de tocar nada se escribe el marcador `lockTransition` en `fize-local`
// (en claro: hace falta para saber que hay una transicion a medias) con las fases ya terminadas. Si la
// pestaña muere a mitad, al abrir otra vez el estado es 'locked' (hay sobre y no hay DEK) y el primer
// desbloqueo reanuda desde la ultima fase marcada. Cada fase es idempotente: lo que ya tiene `__enc` se
// salta, asi que repetirla no rompe nada.
//
// El candado de escritura (withStorageGate) lo toma quien llama a `runLockTransition` para que la
// migracion no se solape con escrituras de la app (ver storageGate.ts).
import type { IDBPDatabase } from 'idb';

import type { DomainRecord } from '../domain';
import {
  decryptRow,
  decryptValue,
  encryptRow,
  encryptValue,
  isEncryptedBlob,
  openSealedString,
  sealString,
} from './rowCrypto';
import {
  entityDb,
  entityNames,
  KV_STORE,
  kvDb,
  OUTBOX_STORE,
  outboxDb,
  SHARES_STORE,
  sharesDb,
} from './localStores';

export const LOCK_TRANSITION_KEY = 'lockTransition';

/**
 * Claves de `fize-local` que NO se cifran nunca: el sobre y el control de intentos hacen falta para poder
 * desbloquear (cifrarlos seria un candado con la llave dentro) y el marcador de transicion tiene que
 * poder leerse antes de tener la DEK.
 */
export const PLAINTEXT_LOCAL_KEYS = ['lockEnvelope', 'lockThrottle', LOCK_TRANSITION_KEY] as const;

export function isPlaintextLocalKey(key: string): boolean {
  return (PLAINTEXT_LOCAL_KEYS as readonly string[]).includes(key);
}

/** AAD de los shares E2EE (el id es la clave del store, no un campo del valor). */
export function deviceShareValueKey(id: string): string {
  return `device-shares|${id}`;
}

export type LockTransitionPhase = 'locking' | 'unlocking';

export interface LockTransitionRecord {
  v: 1;
  phase: LockTransitionPhase;
  /** Fases ya terminadas (reanudable: se saltan al reanudar). */
  done: string[];
  startedAt: string;
  /** MAC del marcador derivado de la DEK (ver `verifyLockTransition`). */
  mac?: string;
}

export interface MigrationStep {
  id: string;
  run(phase: LockTransitionPhase, dek: CryptoKey): Promise<void>;
}

interface OutboxRow {
  id?: unknown;
  entity?: unknown;
  record?: unknown;
}

function listableEntities(database: IDBPDatabase): string[] {
  return entityNames().filter((name) => database.objectStoreNames.contains(name));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

// ---------------------------------------------------------------------------
// Fases
// ---------------------------------------------------------------------------

/** `fize-local`: el codigo de recuperacion, la llave del restaurante, los ajustes, los locales archivados. */
export async function migrateLocalValues(phase: LockTransitionPhase, dek: CryptoKey): Promise<void> {
  const database = await kvDb();
  const keys = (await database.getAllKeys(KV_STORE)) as string[];
  for (const key of keys) {
    if (isPlaintextLocalKey(key)) continue;
    const value = (await database.get(KV_STORE, key)) as unknown;
    if (value === undefined) continue;
    if (phase === 'locking') {
      if (isEncryptedBlob(value)) continue;
      await database.put(KV_STORE, await encryptValue(key, value, dek), key);
    } else {
      if (!isEncryptedBlob(value)) continue;
      await database.put(KV_STORE, await decryptValue(key, value, dek), key);
    }
  }
}

/** `fize-db`: un store por entidad del dominio. `id` e `instance_id` siguen en claro (indice). */
export async function migrateEntityRows(phase: LockTransitionPhase, dek: CryptoKey): Promise<void> {
  const database = await entityDb();
  for (const entity of listableEntities(database)) {
    const rows = (await database.getAll(entity)) as DomainRecord[];
    for (const row of rows) {
      if (phase === 'locking') {
        if (isEncryptedBlob(row)) continue;
        await database.put(entity, await encryptRow(entity, row, dek));
      } else {
        if (!isEncryptedBlob(row)) continue;
        await database.put(entity, await decryptRow(entity, row, dek));
      }
    }
  }
}

/** `fize-outbox`: lo que falta por subir. Lo sensible es el `record` de cada mutacion. */
export async function migrateOutboxRecords(phase: LockTransitionPhase, dek: CryptoKey): Promise<void> {
  const database = await outboxDb();
  if (!database.objectStoreNames.contains(OUTBOX_STORE)) return;
  const entries = (await database.getAll(OUTBOX_STORE)) as OutboxRow[];
  for (const entry of entries) {
    const record = entry?.record;
    if (!isObject(record)) continue;
    const entity = typeof entry.entity === 'string' ? entry.entity : 'unknown';
    if (phase === 'locking') {
      if (isEncryptedBlob(record)) continue;
      await database.put(OUTBOX_STORE, {
        ...entry,
        record: await encryptRow(entity, record as unknown as DomainRecord, dek),
      });
    } else {
      if (!isEncryptedBlob(record)) continue;
      await database.put(OUTBOX_STORE, {
        ...entry,
        record: await decryptRow(entity, record as unknown as DomainRecord, dek),
      });
    }
  }
}

/** `fize-device-shares`: los shares E2EE del dispositivo (x=1 y x=2), que nunca salen de aqui. */
export async function migrateDeviceShares(phase: LockTransitionPhase, dek: CryptoKey): Promise<void> {
  const database = await sharesDb();
  const keys = await database.getAllKeys(SHARES_STORE);
  for (const key of keys) {
    const value = (await database.get(SHARES_STORE, key)) as unknown;
    if (value === undefined) continue;
    const aadKey = deviceShareValueKey(String(key));
    if (phase === 'locking') {
      if (isEncryptedBlob(value)) continue;
      await database.put(SHARES_STORE, await encryptValue(aadKey, value, dek), key);
    } else {
      if (!isEncryptedBlob(value)) continue;
      await database.put(SHARES_STORE, await decryptValue(aadKey, value, dek), key);
    }
  }
}

export function migrationSteps(): MigrationStep[] {
  return [
    { id: 'local', run: migrateLocalValues },
    { id: 'entities', run: migrateEntityRows },
    { id: 'outbox', run: migrateOutboxRecords },
    { id: 'shares', run: migrateDeviceShares },
  ];
}

// ---------------------------------------------------------------------------
// Marcador reanudable
// ---------------------------------------------------------------------------

export function isLockTransition(value: unknown): value is LockTransitionRecord {
  if (!isObject(value)) return false;
  const rec = value as Partial<LockTransitionRecord>;
  return (
    rec.v === 1 &&
    (rec.phase === 'locking' || rec.phase === 'unlocking') &&
    Array.isArray(rec.done) &&
    rec.done.every((id) => typeof id === 'string') &&
    typeof rec.startedAt === 'string'
  );
}

/**
 * Bandera SINCRONA de "ESTA pestaña tiene una transicion a medias". Desactivar recorre cuatro almacenes y
 * no es atomico: si falla a mitad (una fila dañada, cuota), parte de los datos queda ya descifrada y parte
 * no. Mientras la transicion este pendiente, las lecturas aceptan las dos formas (texto plano y sobre).
 *
 * La bandera es SOLO de la instancia que ejecuta la transicion (`beginLocalTransition`), NUNCA se deduce de
 * leer el marcador de IndexedDB: con el marcador como fuente de verdad, escribir
 * `{phase:'unlocking'}` en `fize-local` (devtools, un perfil restaurado, una copia vieja) hacia que
 * cualquier pestaña aceptase filas en claro —incluida `identity.privateJwk`— como si fueran legitimas.
 */
let localTransitionPhase: LockTransitionPhase | null = null;

/** Marca que ESTA instancia esta ejecutando una transicion (la llama `runLockTransition`). */
export function beginLocalTransition(phase: LockTransitionPhase): void {
  localTransitionPhase = phase;
}

/**
 * Texto plano aceptado mientras ESTA pestaña descifra con la DEK en memoria. Solo la desactivacion (fase
 * `unlocking`) deja filas legitimamente en claro; durante la activacion nada esta descifrado.
 */
export function isTransitionPending(): boolean {
  return localTransitionPhase === 'unlocking';
}

/** Lectura PURA del marcador: leerlo no autoriza nada (ver la bandera de arriba). */
export async function readLockTransition(): Promise<LockTransitionRecord | null> {
  const value = (await (await kvDb()).get(KV_STORE, LOCK_TRANSITION_KEY)) as unknown;
  return isLockTransition(value) ? value : null;
}

// ---------------------------------------------------------------------------
// MAC del marcador
//
// El marcador se escribe en claro (hace falta antes de tener la DEK), pero NO se cree sin mas: se firma
// sellando su contenido con la DEK vigente. Asi una pestaña solo reanuda o termina la transicion de
// OTRA si de verdad tiene la llave del equipo: un marcador plantado no se puede autenticar y se ignora.
// ---------------------------------------------------------------------------

const TRANSITION_MAC_AAD = 'fize-lock-transition-v1';

function transitionPayload(record: Pick<LockTransitionRecord, 'phase' | 'done' | 'startedAt'>): string {
  return JSON.stringify({ phase: record.phase, done: [...record.done], startedAt: record.startedAt });
}

/** Firma (sella) el marcador con la DEK. */
export async function signLockTransition(
  record: Pick<LockTransitionRecord, 'phase' | 'done' | 'startedAt'>,
  dek: CryptoKey,
): Promise<string> {
  return sealString(dek, TRANSITION_MAC_AAD, transitionPayload(record));
}

/** `true` solo si el marcador lo escribio alguien con la DEK de este equipo. */
export async function verifyLockTransition(record: LockTransitionRecord, dek: CryptoKey): Promise<boolean> {
  if (typeof record.mac !== 'string' || record.mac.length === 0) return false;
  try {
    return (await openSealedString(dek, TRANSITION_MAC_AAD, record.mac)) === transitionPayload(record);
  } catch {
    return false;
  }
}

/**
 * Escribe el marcador. Con `dek` queda firmado; sin ella (activacion, antes de tener la DEK) queda sin
 * MAC y solo se puede reanudar hacia la fase `locking`, que es idempotente y no abre ninguna puerta.
 */
export async function writeLockTransition(record: LockTransitionRecord, dek?: CryptoKey): Promise<void> {
  const next = dek ? { ...record, mac: await signLockTransition(record, dek) } : record;
  beginLocalTransition(next.phase);
  await (await kvDb()).put(KV_STORE, next, LOCK_TRANSITION_KEY);
}

export async function clearLockTransition(): Promise<void> {
  localTransitionPhase = null;
  await (await kvDb()).delete(KV_STORE, LOCK_TRANSITION_KEY);
}

/** SOLO PARA TESTS. */
export function resetLockMigrationForTests(): void {
  localTransitionPhase = null;
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

/**
 * Cifra (o descifra) lo que quede pendiente. Reanudable: salta las fases ya hechas en el marcador y va
 * apuntando cada una ANTES de seguir, de modo que un corte no repite trabajo ya terminado.
 */
export async function runLockTransition(phase: LockTransitionPhase, dek: CryptoKey): Promise<LockTransitionRecord> {
  const existing = await readLockTransition();
  if (existing && existing.phase !== phase) {
    throw new Error(`Ya hay una transicion de bloqueo en curso (${existing.phase}).`);
  }
  beginLocalTransition(phase);
  let record: LockTransitionRecord = existing ?? {
    v: 1,
    phase,
    done: [],
    startedAt: new Date().toISOString(),
  };
  // El marcador se escribe ANTES del primer paso (y firmado): si la pestaña muere en medio, la siguiente
  // sabe que hay una transicion a medias, que fase era y desde donde reanudar.
  await writeLockTransition(record, dek);
  for (const step of migrationSteps()) {
    if (record.done.includes(step.id)) continue;
    await step.run(phase, dek);
    record = { ...record, done: [...record.done, step.id] };
    await writeLockTransition(record, dek);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Comprobacion (nada de borrar el sobre sin mirar antes)
// ---------------------------------------------------------------------------

async function scanLocalValues(expect: 'encrypted' | 'plaintext'): Promise<string[]> {
  const out: string[] = [];
  const database = await kvDb();
  const keys = (await database.getAllKeys(KV_STORE)) as string[];
  for (const key of keys) {
    if (isPlaintextLocalKey(key)) continue;
    const value = (await database.get(KV_STORE, key)) as unknown;
    if (value === undefined) continue;
    const encrypted = isEncryptedBlob(value);
    if (expect === 'encrypted' ? !encrypted : encrypted) out.push(`local/${key}`);
  }
  return out;
}

async function scanEntityRows(expect: 'encrypted' | 'plaintext'): Promise<string[]> {
  const out: string[] = [];
  const database = await entityDb();
  for (const entity of listableEntities(database)) {
    const rows = (await database.getAll(entity)) as DomainRecord[];
    for (const row of rows) {
      const encrypted = isEncryptedBlob(row);
      if (expect === 'encrypted' ? !encrypted : encrypted) out.push(`${entity}/${String((row as { id?: unknown }).id)}`);
    }
  }
  return out;
}

async function scanOutboxRecords(expect: 'encrypted' | 'plaintext'): Promise<string[]> {
  const out: string[] = [];
  const database = await outboxDb();
  if (!database.objectStoreNames.contains(OUTBOX_STORE)) return out;
  const entries = (await database.getAll(OUTBOX_STORE)) as OutboxRow[];
  for (const entry of entries) {
    const record = entry?.record;
    if (!isObject(record)) continue;
    const encrypted = isEncryptedBlob(record);
    if (expect === 'encrypted' ? !encrypted : encrypted) out.push(`outbox/${String(entry.id)}`);
  }
  return out;
}

async function scanDeviceShares(expect: 'encrypted' | 'plaintext'): Promise<string[]> {
  const out: string[] = [];
  const database = await sharesDb();
  const keys = await database.getAllKeys(SHARES_STORE);
  for (const key of keys) {
    const value = (await database.get(SHARES_STORE, key)) as unknown;
    if (value === undefined) continue;
    const encrypted = isEncryptedBlob(value);
    if (expect === 'encrypted' ? !encrypted : encrypted) out.push(`shares/${String(key)}`);
  }
  return out;
}

/** Datos que sigue habiendo EN CLARO cuando la proteccion esta activa (la migracion no termino bien). */
export async function findPlaintextLeftovers(): Promise<string[]> {
  return [
    ...(await scanLocalValues('encrypted')),
    ...(await scanEntityRows('encrypted')),
    ...(await scanOutboxRecords('encrypted')),
    ...(await scanDeviceShares('encrypted')),
  ];
}

/** Datos que siguen CIFRADOS cuando la proteccion ya deberia estar desactivada. */
export async function findEncryptedLeftovers(): Promise<string[]> {
  return [
    ...(await scanLocalValues('plaintext')),
    ...(await scanEntityRows('plaintext')),
    ...(await scanOutboxRecords('plaintext')),
    ...(await scanDeviceShares('plaintext')),
  ];
}
