import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainRecord } from '../domain';
import { createIdbDeviceShareStore, resetDeviceShareDbForTests } from '../deviceShareStore';
import { getIdbAdapter, resetIdbForTests } from '../idbAdapter';
import { enqueueMutation, pendingMutations, resetSyncForTests } from '../idbSync';
import {
  changePin,
  disableProtection,
  enableProtection,
  getActiveDek,
  getLockState,
  lock,
  LockedError,
  LockoutError,
  LOCK_STORAGE_EVENT_KEY,
  resetDeviceLockForTests,
  unlock,
  type LockOptions,
} from './deviceLock';
import { getLocal, getStoredLocal, resetLocalDbForTests, setLocal } from './localDb';
import {
  readLockTransition,
  resetLockMigrationForTests,
  writeLockTransition,
} from './lockMigration';
import {
  entityDb,
  entityNames,
  KV_STORE,
  kvDb,
  OUTBOX_STORE,
  outboxDb,
  resetLocalStoresForTests,
  SHARES_STORE,
  sharesDb,
} from './localStores';
import { isEncryptedBlob } from './rowCrypto';
import { resetStorageGateForTests } from './storageGate';

// Bloqueo del equipo: PIN/codigo, transicion de cifrado (activar y desactivar), intentos fallidos y aviso
// a las otras pestañas. Los PBKDF2 de estas pruebas usan 10 iteraciones inyectadas; produccion usa 600.000.

const FAST: LockOptions = { policy: { iterations: 10 } };
const PIN = '123456';
const INSTANCE = 'local-f2test';
const CODE = 'ABCD-EFGH-JKMN-PQRS';

async function wipeStores(): Promise<void> {
  await (await kvDb()).clear(KV_STORE);
  const entities = await entityDb();
  for (const entity of entityNames()) await entities.clear(entity);
  await (await outboxDb()).clear(OUTBOX_STORE);
  await (await sharesDb()).clear(SHARES_STORE);
}

const rec = (id: string, business: Record<string, unknown> = {}): DomainRecord =>
  ({
    id,
    instance_id: INSTANCE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...business,
  }) as DomainRecord;

/** Datos de negocio EN CLARO, como estarian antes de activar la proteccion. */
async function seedPlaintext(): Promise<void> {
  await setLocal('recoveryCode', CODE);
  await setLocal('settings', { publishedSlug: 'fonda-secreta', tableCount: 3 });
  const storage = getIdbAdapter();
  await storage.create('restaurant', rec('r1', { name: 'Fonda Secreta', slug: 'fonda-secreta' }));
  await storage.create('order', rec('o1', { tableId: 't1', status: 'pending', total: 22000 }));
  await enqueueMutation('order', 'create', rec('o2', { total: 9000 }), INSTANCE);
  await createIdbDeviceShareStore().save(INSTANCE, {
    device: { blobs: 'share-dispositivo' },
    recovery: { blobs: 'share-recuperacion' },
  });
}

/** Todo lo guardado, en crudo (para afirmar que ya no queda texto plano en ninguna parte). */
async function rawDump(): Promise<string> {
  const dump: unknown[] = [];
  const kv = await kvDb();
  for (const key of await kv.getAllKeys(KV_STORE)) dump.push(await kv.get(KV_STORE, key));
  const entities = await entityDb();
  for (const entity of entityNames()) dump.push(...(await entities.getAll(entity)));
  const outbox = await outboxDb();
  dump.push(...(await outbox.getAll(OUTBOX_STORE)));
  const shares = await sharesDb();
  for (const key of await shares.getAllKeys(SHARES_STORE)) dump.push(await shares.get(SHARES_STORE, key));
  return JSON.stringify(dump);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error('La condición no se cumplió a tiempo');
}

function storageEventOf(newValue: string): Event {
  const init = { key: LOCK_STORAGE_EVENT_KEY, newValue };
  try {
    return new StorageEvent('storage', init);
  } catch {
    return Object.assign(new Event('storage'), init);
  }
}

beforeEach(async () => {
  await wipeStores();
  resetLocalStoresForTests();
  resetLocalDbForTests();
  resetIdbForTests();
  resetSyncForTests();
  resetDeviceShareDbForTests();
  resetDeviceLockForTests();
  resetLockMigrationForTests();
  resetStorageGateForTests();
  localStorage.clear();
});

describe('deviceLock: PIN y codigo', () => {
  it('initial state is off', async () => {
    expect(await getLockState()).toBe('off');
  });

  it('enables protection, locks and unlocks with PIN', async () => {
    const code = await enableProtection('pin', PIN, undefined, FAST);
    expect(await getLockState()).toBe('unlocked');
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    lock();
    expect(await getLockState()).toBe('locked');

    await expect(unlock('pin', '654321', undefined, FAST)).rejects.toThrow(LockedError);
    expect(await getLockState()).toBe('locked');

    await unlock('pin', PIN, undefined, FAST);
    expect(await getLockState()).toBe('unlocked');
  });

  it('unlocks with recovery code', async () => {
    const code = await enableProtection('pin', PIN, undefined, FAST);
    lock();

    await unlock('recovery', code, undefined, FAST);
    expect(await getLockState()).toBe('unlocked');
  });

  it('changes PIN', async () => {
    await enableProtection('pin', PIN, undefined, FAST);
    await changePin(PIN, '654321', FAST);

    lock();
    await expect(unlock('pin', PIN, undefined, FAST)).rejects.toThrow();
    await unlock('pin', '654321', undefined, FAST);
    expect(await getLockState()).toBe('unlocked');
  });
});

describe('deviceLock: transicion de cifrado', () => {
  it('activar cifra lo que YA habia en los cuatro almacenes y no se pierde nada', async () => {
    await seedPlaintext();
    expect(isEncryptedBlob(await getStoredLocal('recoveryCode'))).toBe(false);
    expect(await rawDump()).toContain('Fonda Secreta');

    await enableProtection('pin', PIN, undefined, FAST);

    expect(await readLockTransition()).toBeNull();
    expect(isEncryptedBlob(await getStoredLocal('recoveryCode'))).toBe(true);
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'r1'))).toBe(true);
    expect(isEncryptedBlob((await (await outboxDb()).getAll(OUTBOX_STORE))[0].record)).toBe(true);
    expect(isEncryptedBlob(await (await sharesDb()).get(SHARES_STORE, INSTANCE))).toBe(true);

    const dump = await rawDump();
    for (const plain of ['Fonda Secreta', 'fonda-secreta', CODE, 'share-dispositivo', 'share-recuperacion']) {
      expect(dump, `quedó en claro: ${plain}`).not.toContain(plain);
    }

    // Los mismos datos siguen leyendose (antes y despues de bloquear).
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    lock();
    await unlock('pin', PIN, undefined, FAST);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect((await pendingMutations())[0].record.total).toBe(9000);
    expect((await createIdbDeviceShareStore().load(INSTANCE))?.recovery).toEqual({ blobs: 'share-recuperacion' });
    await disableProtection();
  });

  it('reanuda la migracion si la pestaña murio a mitad', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Corte simulado: la fila del restaurante volvio a quedar en claro y el marcador quedo a medias.
    await (await entityDb()).put('restaurant', { id: 'r1', instance_id: INSTANCE, name: 'Fonda Secreta', slug: 'fonda-secreta' });
    await writeLockTransition({ v: 1, phase: 'locking', done: ['local'], startedAt: new Date().toISOString() });
    lock();

    await unlock('pin', PIN, undefined, FAST);

    expect(await readLockTransition()).toBeNull();
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'r1'))).toBe(true);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    await disableProtection();
  });

  it('desactivar descifra TODO antes de borrar el sobre y la DEK', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    await disableProtection();

    expect(await getLockState()).toBe('off');
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'r1'))).toBe(false);
    expect(await getStoredLocal('recoveryCode')).toBe(CODE);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect((await pendingMutations())[0].record.total).toBe(9000);
    expect((await createIdbDeviceShareStore().load(INSTANCE))?.device).toEqual({ blobs: 'share-dispositivo' });

    // Volver a activar no pierde nada (si desactivar borrara el sobre sin descifrar, aqui saldria `{__enc}`).
    await enableProtection('pin', PIN, undefined, FAST);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    await disableProtection();
  });

  it('si algo no se puede descifrar, desactivar NO borra el sobre', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);
    await (await entityDb()).put('order', { id: 'o1', instance_id: INSTANCE, __enc: 'v1.aaaa.bbbb' });

    await expect(disableProtection()).rejects.toThrow();

    expect(isEncryptedBlob(await (await kvDb()).get(KV_STORE, 'lockEnvelope'))).toBe(false);
    expect(await readLockTransition()).not.toBeNull();
    expect(await getLockState()).toBe('unlocked');

    // Sin la fila dañada, el reintento si termina.
    await (await entityDb()).delete('order', 'o1');
    await disableProtection();
    expect(await getLockState()).toBe('off');
  });
});

describe('deviceLock: intentos fallidos', () => {
  const THROTTLED: LockOptions = { policy: { iterations: 10, maxAttempts: 3, baseDelayMs: 80, maxDelayMs: 400 } };

  it('bloquea tras varios intentos, con espera creciente', async () => {
    await enableProtection('pin', PIN, undefined, THROTTLED);
    lock();

    for (let i = 0; i < 3; i++) {
      await expect(unlock('pin', '000000', undefined, THROTTLED)).rejects.toBeInstanceOf(LockedError);
    }

    const first = await unlock('pin', PIN, undefined, THROTTLED).then(
      () => null,
      (error: unknown) => error as LockoutError,
    );
    expect(first).toBeInstanceOf(LockoutError);
    expect(first!.retryAfterMs).toBeGreaterThan(0);
    // Ni el PIN correcto entra mientras dura la espera.
    await expect(unlock('pin', PIN, undefined, THROTTLED)).rejects.toBeInstanceOf(LockoutError);

    await sleep(first!.retryAfterMs + 40);
    await expect(unlock('pin', '000000', undefined, THROTTLED)).rejects.toBeInstanceOf(LockedError);
    const second = await unlock('pin', PIN, undefined, THROTTLED).then(
      () => null,
      (error: unknown) => error as LockoutError,
    );
    expect(second).toBeInstanceOf(LockoutError);
    expect(second!.retryAfterMs).toBeGreaterThan(first!.retryAfterMs);

    await sleep(second!.retryAfterMs + 40);
    await unlock('pin', PIN, undefined, THROTTLED);
    expect(await getLockState()).toBe('unlocked');
    await disableProtection();
  });

  it('no deja pasar intentos simultaneos de golpe (mutex)', async () => {
    const MUTEX: LockOptions = { policy: { iterations: 10, maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 500 } };
    await enableProtection('pin', PIN, undefined, MUTEX);
    lock();

    const results = await Promise.allSettled([
      unlock('pin', '000000', undefined, MUTEX),
      unlock('pin', '000000', undefined, MUTEX),
      unlock('pin', '000000', undefined, MUTEX),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);

    // Sin mutex los tres leerian `failures: 0` a la vez y el contador nunca llegaria a 3.
    await expect(unlock('pin', PIN, undefined, MUTEX)).rejects.toBeInstanceOf(LockoutError);
  });
});

describe('deviceLock: clave y codigo', () => {
  it('el codigo de recuperacion usa 16 bytes distintos (no 10 repetidos)', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) array[i] = i;
      return array;
    }) as typeof crypto.getRandomValues);
    try {
      const code = await enableProtection('pin', PIN, undefined, FAST);
      const chars = code.replace(/-/g, '');
      expect(chars).toHaveLength(16);
      // Con 10 bytes (`buf[i % 10]`) solo saldrian 10 caracteres distintos.
      expect(new Set(chars).size).toBe(16);
    } finally {
      spy.mockRestore();
    }
    await disableProtection();
  });

  it('la DEK viva en memoria no se puede exportar', async () => {
    await enableProtection('pin', PIN, undefined, FAST);
    expect(getActiveDek()!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', getActiveDek()!)).rejects.toThrow();

    lock();
    await unlock('pin', PIN, undefined, FAST);
    expect(getActiveDek()!.extractable).toBe(false);

    await changePin(PIN, '654321', FAST);
    expect(getActiveDek()!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', getActiveDek()!)).rejects.toThrow();
    await disableProtection();
  });
});

describe('deviceLock: aviso a las otras pestañas', () => {
  it('"Bloquear ahora" en una pestaña bloquea la otra (BroadcastChannel)', async () => {
    await enableProtection('pin', PIN, undefined, FAST);
    expect(getActiveDek()).not.toBeNull();

    // Otra "pestaña": otra instancia del modulo, con su propia DEK en memoria.
    vi.resetModules();
    const tabB = await import('./deviceLock');
    await tabB.unlock('pin', PIN, undefined, FAST);
    expect(await tabB.getLockState()).toBe('unlocked');
    expect(tabB.getActiveDek()).not.toBeNull();

    let notified = 0;
    const unsubscribe = tabB.subscribeLockEvents(() => {
      notified += 1;
    });

    lock();

    await until(() => notified === 1 && tabB.getActiveDek() === null);
    expect(await tabB.getLockState()).toBe('locked');
    expect(await getLockState()).toBe('locked');
    expect(getActiveDek()).toBeNull();

    unsubscribe();
    tabB.resetDeviceLockForTests();
  });

  it('sin BroadcastChannel el aviso viaja por evento storage', async () => {
    await enableProtection('pin', PIN, undefined, FAST);

    vi.resetModules();
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const tabB = await import('./deviceLock');
      await tabB.unlock('pin', PIN, undefined, FAST);
      expect(tabB.getActiveDek()).not.toBeNull();

      let notified = 0;
      const unsubscribe = tabB.subscribeLockEvents(() => {
        notified += 1;
      });

      lock();

      const payload = localStorage.getItem(LOCK_STORAGE_EVENT_KEY);
      expect(payload).toBeTruthy();

      // En un navegador real el evento lo dispara el navegador en la otra pestaña.
      window.dispatchEvent(storageEventOf(payload!));
      await until(() => notified === 1);
      expect(tabB.getActiveDek()).toBeNull();
      expect(await tabB.getLockState()).toBe('locked');

      unsubscribe();
      tabB.resetDeviceLockForTests();
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
    }
  });
});
