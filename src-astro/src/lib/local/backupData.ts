// backupData.ts — que entra en la copia del nodo local y como se restaura (NODO-LOCAL.md §2.3, nivel N1).
//
// Entra: todos los stores de `fize-db` (una lista por entidad, solo la instancia local), la llave del
// restaurante, el avance del onboarding y los ajustes locales. NO entra el codigo de recuperacion (la copia
// se cifra con el). Restaurar descifra y valida TODO antes de tocar nada: con un codigo errado o un archivo
// alterado, los datos del equipo quedan intactos. La escritura es atomica (restoreTx.ts) y la copia de OTRO
// local solo se restaura con confirmacion explicita: el local actual queda archivado, nunca se borra.
import { domainConfig } from '../domain.config';
import type { DomainRecord, StorageAdapter } from '../domain';
import { RowConflictError, getIdbAdapter } from '../idbAdapter';
import {
  BACKUP_FORMAT,
  BackupError,
  MAX_BACKUP_BYTES,
  decryptBackup,
  encryptBackup,
  normalizeRecoveryCode,
  type EncryptedBackup,
  type PlainBackup,
} from './backupCrypto';
import { adoptIdentity, isConsistentIdentity, loadIdentity, type LocalIdentity } from './identity';
import { deleteLocal, getLocal, getSettings, patchSettings, setLocal, type LocalSettings } from './localDb';
import { commitLocalSwitch, digestRows, digestStoredInstance, withRestoreLock, type PendingRestore } from './restoreTx';

export const BACKUP_EXTENSION = '.fize';

function entities(): string[] {
  return domainConfig.entities.map((e) => e.name);
}

export async function collectBackup(storage: StorageAdapter = getIdbAdapter()): Promise<PlainBackup> {
  const identity = await loadIdentity();
  if (!identity) throw new Error('Este equipo todavía no tiene un local configurado: no hay nada que copiar.');
  const stores: Record<string, unknown[]> = {};
  for (const entity of entities()) stores[entity] = await storage.list(entity, identity.instanceId);
  return {
    format: BACKUP_FORMAT,
    appId: domainConfig.appId,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    stores,
    local: {
      identity,
      onboarding: (await getLocal('onboarding')) ?? null,
      settings: await getSettings(),
    },
  };
}

/** Arma la copia cifrada con el codigo guardado en este equipo. */
export async function createEncryptedBackup(code?: string): Promise<{ envelope: EncryptedBackup; filename: string }> {
  const recovery = code ?? (await getLocal<string>('recoveryCode'));
  if (!recovery) throw new Error('Falta el código de recuperación de este equipo.');
  const plain = await collectBackup();
  const envelope = await encryptBackup(plain, recovery);
  const restaurant = (plain.stores.restaurant ?? []).find((r) => !(r as Record<string, unknown>).deleted_at) as
    | Record<string, unknown>
    | undefined;
  const slug = typeof restaurant?.slug === 'string' && restaurant.slug ? restaurant.slug : 'mi-local';
  const filename = `fize-${slug}-${plain.createdAt.slice(0, 10)}${BACKUP_EXTENSION}`;
  return { envelope, filename };
}

/** Descarga un archivo en el navegador. */
export function downloadText(text: string, filename: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exporta la copia cifrada como archivo `.fize` y anota la fecha. */
export async function exportBackupFile(): Promise<string> {
  const { envelope, filename } = await createEncryptedBackup();
  downloadText(JSON.stringify(envelope), filename);
  await patchSettings({ lastBackupAt: new Date().toISOString() });
  return filename;
}

export interface RestoreSummary {
  instanceId: string;
  /** El local que tenia este equipo antes (null si no habia ninguno). */
  previousInstanceId: string | null;
  /** True si la copia era de OTRO local: el anterior quedo archivado en este equipo. */
  replacedOtherLocal: boolean;
  counts: Record<string, number>;
}

/** Nombre y enlace de un local, para que el aviso de reemplazo diga de quien es cada cosa. */
export interface LocalSummary {
  instanceId: string;
  name: string | null;
  slug: string | null;
}

function firstActive(rows: unknown[] | undefined): Record<string, unknown> | undefined {
  return (rows ?? []).find((r) => r && typeof r === 'object' && !(r as Record<string, unknown>).deleted_at) as
    | Record<string, unknown>
    | undefined;
}

function summarize(instanceId: string, restaurants: unknown[] | undefined, settings: unknown): LocalSummary {
  const r = firstActive(restaurants);
  const published = (settings as LocalSettings | null | undefined)?.publishedSlug;
  const name = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : null;
  const slug = typeof r?.slug === 'string' && r.slug ? r.slug : typeof published === 'string' && published ? published : null;
  return { instanceId, name, slug };
}

/** El local que tiene este equipo ahora (null si no hay ninguno). */
export async function describeCurrentLocal(storage: StorageAdapter = getIdbAdapter()): Promise<LocalSummary | null> {
  const identity = await loadIdentity();
  if (!identity) return null;
  return summarize(identity.instanceId, await storage.list('restaurant', identity.instanceId), await getSettings());
}

/** El local que trae una copia ya abierta con `openBackup`. */
export function describeBackupLocal(plain: PlainBackup & { local: { identity: LocalIdentity } }): LocalSummary {
  const stores = plain.stores;
  const restaurants = Object.hasOwn(stores, 'restaurant') ? stores.restaurant : undefined;
  return summarize(plain.local.identity.instanceId, restaurants, plain.local.settings);
}

/**
 * Antes de reemplazar el local de este equipo por el de otra copia: descarga una copia cifrada del local
 * ACTUAL con SU codigo. Devuelve el nombre del archivo, o null si este equipo no tiene codigo (sus datos
 * igual quedan archivados en el equipo).
 */
export async function downloadSafetyBackup(): Promise<string | null> {
  const code = await getLocal<string>('recoveryCode');
  if (!code) return null;
  const { envelope, filename } = await createEncryptedBackup(code);
  const name = `${filename.slice(0, -BACKUP_EXTENSION.length)}-antes-de-reemplazar${BACKUP_EXTENSION}`;
  downloadText(JSON.stringify(envelope), name);
  return name;
}

/** Descifra y valida un archivo sin escribir nada. Lanza BackupError con mensaje en español. */
export async function openBackup(text: string, code: string): Promise<PlainBackup & { local: { identity: LocalIdentity } }> {
  if (text.length > MAX_BACKUP_BYTES) throw new BackupError('formato', 'El archivo es demasiado grande para ser una copia de Fize.');
  const plain = await decryptBackup(text, code);
  if (plain.appId !== domainConfig.appId) throw new BackupError('formato');
  const identity = plain.local?.identity;
  if (!(await isConsistentIdentity(identity))) throw new BackupError('alterado');
  const instanceId = (identity as LocalIdentity).instanceId;
  if (!plain.stores || typeof plain.stores !== 'object' || Array.isArray(plain.stores)) throw new BackupError('alterado');
  for (const records of Object.values(plain.stores)) {
    if (!Array.isArray(records)) throw new BackupError('alterado');
    for (const r of records) {
      const rec = r as Partial<DomainRecord> | null;
      if (!rec || typeof rec.id !== 'string' || rec.instance_id !== instanceId) throw new BackupError('alterado');
    }
  }
  return plain as PlainBackup & { local: { identity: LocalIdentity } };
}

export interface RestoreOptions {
  /**
   * La copia es de OTRO local y el usuario confirmo de forma explicita que este equipo pasa a trabajar con
   * ese local. Sin esto, restaurar la copia de otro local se rechaza (`otra-instancia`).
   */
  replaceInstance?: boolean;
}

/**
 * Restaura una copia en este equipo, sin poder quedar a medias (ver restoreTx.ts).
 * - Mismo local: sus datos quedan iguales a los de la copia (upsert y luego borrar lo que sobra, atomico).
 * - Otro local: solo con `replaceInstance`. Los datos del local actual NO se borran y su llave, ajustes y
 *   codigo quedan archivados en este equipo; el codigo de la copia es el del local nuevo.
 * - Una sola restauracion a la vez en el origen (candado Web Locks): si otra pestaña esta restaurando, no
 *   se escribe nada y sale `BackupError('en-curso')`.
 */
export async function restoreBackup(text: string, code: string, opts: RestoreOptions = {}): Promise<RestoreSummary> {
  const plain = await openBackup(text, code);
  const identity = plain.local.identity;
  const current = await loadIdentity();
  const replacedOtherLocal = Boolean(current && current.instanceId !== identity.instanceId);
  if (replacedOtherLocal && !opts.replaceInstance) throw new BackupError('otra-instancia');

  const recoveryCode = normalizeRecoveryCode(code);
  if (!recoveryCode) throw new BackupError('codigo');

  const rows: Record<string, DomainRecord[]> = {};
  const counts: Record<string, number> = {};
  for (const entity of entities()) {
    rows[entity] = (Object.hasOwn(plain.stores, entity) ? plain.stores[entity] : []) as DomainRecord[];
    counts[entity] = rows[entity].length;
  }
  for (const name of Object.keys(plain.stores)) if (!Object.hasOwn(counts, name)) counts[name] = 0;

  const local = plain.local as Record<string, unknown>;
  const pending: PendingRestore = {
    v: 1,
    instanceId: identity.instanceId,
    previousInstanceId: current?.instanceId ?? null,
    startedAt: new Date().toISOString(),
    digest: await digestRows(rows),
    local: {
      identity,
      onboarding: local.onboarding ?? null,
      settings: (local.settings ?? {}) as LocalSettings,
      recoveryCode,
    },
  };

  // 1-2. Marca y datos (una transaccion: si falla, el equipo queda como estaba). Todo bajo el candado de
  // restauracion: dos pestañas escribiendo a la vez dejaban la marca pisada y las filas de una copia con
  // la llave de otra. `loadIdentity` (arriba) ya cerro cualquier restauracion interrumpida antes de esto.
  const summary = await withRestoreLock(async (): Promise<RestoreSummary> => {
    await setLocal('restorePending', pending);
    try {
      await getIdbAdapter().replaceInstanceRows(identity.instanceId, rows);
      // 3. Verificar antes de cambiar de local.
      if ((await digestStoredInstance(identity.instanceId)) !== pending.digest) {
        throw new Error('La copia no quedó guardada completa.');
      }
    } catch (err) {
      await deleteLocal('restorePending').catch(() => undefined);
      if (err instanceof RowConflictError) throw new BackupError('conflicto');
      // Cuota llena, pestaña cerrada, error de IndexedDB: la transaccion se aborto y nada cambio.
      throw new Error('No se pudo guardar la copia en este equipo (puede que falte espacio). No se cambió nada: inténtalo de nuevo.', {
        cause: err,
      });
    }

    // 4. Cambio de local (una transaccion) y la pagina adopta la llave nueva.
    await commitLocalSwitch(pending);
    adoptIdentity(identity);
    return { instanceId: identity.instanceId, previousInstanceId: current?.instanceId ?? null, replacedOtherLocal, counts };
  });

  // Otra pestaña de este equipo tiene el candado: no se escribio nada.
  if (!summary) throw new BackupError('en-curso');
  return summary;
}
