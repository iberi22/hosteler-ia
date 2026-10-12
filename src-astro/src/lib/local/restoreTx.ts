// restoreTx.ts — restaurar una copia sin poder quedar a medias (auditoria local-node B1/B2).
//
// Orden de una restauracion:
//   1. Marca `restorePending` en `fize-local` con lo que hace falta para terminar (llave, ajustes, codigo) y
//      la huella (SHA-256) de las filas que van a quedar.
//   2. Datos: UNA transaccion de IndexedDB sobre todos los stores de `fize-db` (idbAdapter.replaceInstanceRows):
//      escribe las filas de la instancia de la copia y borra las que sobran DE ESA instancia. Atomica: o
//      quedan todas o ninguna. Las filas de otras instancias (el local que habia) no se tocan.
//   3. Verifica que lo guardado tiene la huella esperada.
//   4. Cambio de local: UNA transaccion de `fize-local` que archiva el local anterior (llave, ajustes, SU
//      codigo), pone la llave, los ajustes y el codigo de la copia y borra la marca.
// Si la pestaña muere entre 2 y 4, al abrir de nuevo `settlePendingRestore` (lo llama loadIdentity) mira la
// huella: si los datos ya quedaron, termina el paso 4; si no, la transaccion de datos no se aplico y solo
// borra la marca. En ningun caso queda un local sin datos o con la llave de otro.
import type { DomainRecord } from '../domain';
import { domainConfig } from '../domain.config';
import { getIdbAdapter } from '../idbAdapter';
import { getLocal, deleteLocal, updateLocalAtomically } from './localDb';
import type { LocalSettings } from './localDb';
import type { LocalIdentity } from './identity';

/** Un local que este equipo tuvo antes de restaurar la copia de otro. Nada se pierde al cambiar de local. */
export interface ArchivedLocal {
  identity: LocalIdentity;
  settings: LocalSettings;
  onboarding: unknown;
  /** El codigo de ESE local: el de la copia nueva nunca lo reemplaza. */
  recoveryCode: string | null;
  archivedAt: string;
}

export type ArchivedLocals = Record<string, ArchivedLocal>;

export interface PendingRestore {
  v: 1;
  instanceId: string;
  previousInstanceId: string | null;
  startedAt: string;
  /** SHA-256 de las filas que deben quedar para `instanceId` (ver `digestRows`). */
  digest: string;
  local: {
    identity: LocalIdentity;
    onboarding: unknown;
    settings: LocalSettings;
    recoveryCode: string;
  };
}

export function entityNames(): string[] {
  return domainConfig.entities.map((e) => e.name);
}

/** JSON con las claves ordenadas: la misma fila da el mismo texto aunque IndexedDB la devuelva en otro orden. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Huella de las filas de una instancia: entidades en orden del dominio, filas ordenadas por id. */
export async function digestRows(rowsByEntity: Record<string, DomainRecord[]>): Promise<string> {
  const parts = entityNames().map((entity) => {
    const rows = [...(rowsByEntity[entity] ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return `${entity}:${stableStringify(rows)}`;
  });
  const bytes = new TextEncoder().encode(parts.join('\n'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Huella de lo que hay guardado ahora para `instanceId`. */
export async function digestStoredInstance(instanceId: string): Promise<string> {
  const storage = getIdbAdapter();
  const rows: Record<string, DomainRecord[]> = {};
  for (const entity of entityNames()) rows[entity] = await storage.list(entity, instanceId);
  return digestRows(rows);
}

/**
 * Paso 4: cambia el local de este equipo en UNA transaccion. Si el local actual es otro, lo archiva con su
 * llave, sus ajustes y su codigo. Idempotente: aplicarlo dos veces deja lo mismo.
 */
export async function commitLocalSwitch(pending: PendingRestore): Promise<void> {
  const now = new Date().toISOString();
  await updateLocalAtomically(async (tx) => {
    const current = await tx.get<LocalIdentity>('identity');
    const archive: ArchivedLocals = { ...((await tx.get<ArchivedLocals>('archivedLocals')) ?? {}) };
    const otherLocal = Boolean(current && current.instanceId !== pending.instanceId);
    if (current && otherLocal) {
      archive[current.instanceId] = {
        identity: current,
        settings: (await tx.get<LocalSettings>('settings')) ?? {},
        onboarding: (await tx.get<unknown>('onboarding')) ?? null,
        recoveryCode: (await tx.get<string>('recoveryCode')) ?? null,
        archivedAt: now,
      };
    }
    delete archive[pending.instanceId];

    tx.put('identity', pending.local.identity);
    const onboarding = pending.local.onboarding;
    if (onboarding && typeof onboarding === 'object') tx.put('onboarding', onboarding);
    else if (otherLocal) tx.del('onboarding');
    tx.put('settings', pending.local.settings ?? {});
    tx.put('recoveryCode', pending.local.recoveryCode);
    tx.put('archivedLocals', archive);
    tx.del('restorePending');
  });
}

function isPendingRestore(value: unknown): value is PendingRestore {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<PendingRestore>;
  return (
    p.v === 1 &&
    typeof p.instanceId === 'string' &&
    typeof p.digest === 'string' &&
    !!p.local &&
    typeof p.local.recoveryCode === 'string' &&
    !!p.local.identity &&
    p.local.identity.instanceId === p.instanceId
  );
}

export type SettleResult = 'none' | 'completed' | 'discarded';

/**
 * Candado de restauracion (Web Locks). Una sola restauracion a la vez en TODO el origen.
 *
 * Sin candado, dos pestañas podian escribir la marca y las filas a la vez: la marca es un solo hueco en
 * `fize-local`, asi que la segunda pestaña la pisaba, y la que abria la app a mitad de la restauracion de
 * otra calculaba la huella antes de que el otro terminara de escribir, no coincidia y DESCARTABA la marca
 * de la restauracion en curso. Con la marca perdida, un cierre de pestaña entre los pasos 2 y 4 dejaba el
 * equipo con los datos de una copia y la llave de otra, y ya no habia forma de terminarlo.
 *
 * El candado lo suelta el navegador solo cuando la pestaña muere, asi que `settlePendingRestore` distingue
 * "otra pestaña esta restaurando AHORA" (su marca no se toca) de "esa pestaña se cerro" (se termina o se
 * descarta, como siempre) sin depender de tiempos: una marca "fresca" no se puede descartar por frescura
 * sin romper la recuperacion inmediata tras cerrar la pestaña.
 *
 * Navegadores sin Web Locks (muy viejos) ejecutan sin candado: se pierde la exclusion entre pestañas, no
 * la atomicidad de cada escritura (que ya la da IndexedDB).
 */
export const RESTORE_LOCK = 'fize-restore';

interface RestoreLockLike {
  name: string;
}
interface LocksLike {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: RestoreLockLike | null) => Promise<unknown>,
  ): Promise<unknown>;
}

function locksApi(): LocksLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as unknown as { locks?: LocksLike }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Corre `fn` con el candado. Si otra pestaña lo tiene, devuelve null sin ejecutar nada. */
export async function withRestoreLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = locksApi();
  if (!locks) return fn();
  const result = await locks.request(RESTORE_LOCK, { ifAvailable: true }, async (lock) => (lock ? fn() : null));
  return result as T | null;
}

/**
 * Termina o descarta una restauracion interrumpida. Lo llama `loadIdentity` antes de leer la llave, asi
 * que ninguna pantalla ve un estado intermedio. Si otra pestaña esta restaurando, no se toca su marca.
 */
export async function settlePendingRestore(): Promise<SettleResult> {
  const settled = await withRestoreLock(settleOnce);
  return settled ?? 'none';
}

async function settleOnce(): Promise<SettleResult> {
  const pending = await getLocal<unknown>('restorePending');
  if (pending === undefined) return 'none';
  if (!isPendingRestore(pending)) {
    await deleteLocal('restorePending');
    return 'discarded';
  }
  if ((await digestStoredInstance(pending.instanceId)) === pending.digest) {
    await commitLocalSwitch(pending);
    return 'completed';
  }
  // La transaccion de datos no se aplico (es atomica): el equipo sigue como estaba.
  await deleteLocal('restorePending');
  return 'discarded';
}
