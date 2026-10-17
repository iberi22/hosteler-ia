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
import { getLocal, getStoredLocal, resetLocalDbForTests, setLocal, updateLocalAtomically } from './localDb';
import {
  findEncryptedLeftovers,
  findPlaintextLeftovers,
  migrateLocalValues,
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
import { resetStorageGateForTests, withStorageGate } from './storageGate';

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

async function rawEnvelope(): Promise<unknown> {
  return (await (await kvDb()).get(KV_STORE, 'lockEnvelope')) as unknown;
}

async function rawTransition(): Promise<unknown> {
  return (await (await kvDb()).get(KV_STORE, 'lockTransition')) as unknown;
}

/**
 * Nonce de la transicion vigente del sobre. Los marcadores que reanudan una transicion lo llevan dentro
 * (y dentro de lo que se firma): uno capturado de un intento anterior ya no vale.
 */
async function envelopeNonce(): Promise<string | undefined> {
  return ((await rawEnvelope()) as { transitionNonce?: string } | null | undefined)?.transitionNonce;
}

/**
 * Pausa el PRIMER cifrado de la escritura que se lance (el sobre en claro que se guarda despues depende de
 * ese `await`) y en ese hueco corre `middle` (por defecto la desactivacion). Reproduce la carrera de
 * verdad: cifrar fuera del candado dejaba el `{__enc}` aterrizando despues de que el sobre ya no estaba, o
 * con la llave vieja despues de desactivar y reactivar.
 */
async function inFlightEncryptThen(
  start: () => Promise<unknown>,
  middle: () => Promise<unknown> = () => disableProtection(),
): Promise<void> {
  const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let reached!: () => void;
  const atEncrypt = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let open!: () => void;
  const hold = new Promise<void>((resolve) => {
    open = resolve;
  });
  let first = true;
  const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(
    (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
      if (first) {
        first = false;
        reached();
        return hold.then(() => realEncrypt(algorithm, key, data));
      }
      return realEncrypt(algorithm, key, data);
    },
  );
  try {
    const write = start();
    await atEncrypt;
    const pending = middle();
    pending.catch(() => undefined);
    // Si `middle` NO comparte el candado con la escritura (defecto), termina en este hueco.
    const deadline = Date.now() + 500;
    while ((await rawEnvelope()) !== undefined && Date.now() < deadline) await sleep(10);
    if ((await rawEnvelope()) === undefined) await sleep(30);
    open();
    await write;
    await pending;
  } finally {
    spy.mockRestore();
  }
}

const inFlightEncryptThenDisable = (start: () => Promise<unknown>): Promise<void> => inFlightEncryptThen(start);

/**
 * Lanza `transition` (activar o desactivar), espera a que tenga el candado de escritura TOMADO y en ese
 * hueco lanza `write`. El candado se detecta de verdad: la transicion esta dentro de `withStorageGate`
 * cuando hace su primer cifrado/descifrado con el sobre ya escrito (el marcador se firma antes, asi que
 * tambien se espera a que el sobre exista para no caer en ese primer cifrado de la activacion).
 *
 * Devuelve si la escritura se decidio MIENTRAS la transicion seguia con el candado. Con el estado leido
 * fuera del candado, la escritura se resuelve en ese hueco (con la DEK vieja o con el 'off' anterior a la
 * activacion) en vez de esperar su turno.
 */
async function writeWhileTransitionHoldsGate(
  transition: () => Promise<unknown>,
  write: () => Promise<unknown>,
): Promise<boolean> {
  const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let reached!: () => void;
  const atTransition = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let open!: () => void;
  const hold = new Promise<void>((resolve) => {
    open = resolve;
  });
  let first = true;
  const maybeHold = async (run: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> => {
    if (first && (await rawEnvelope()) !== undefined) {
      first = false;
      reached();
      await hold;
    }
    return run();
  };
  const spyEncrypt = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(
    async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) =>
      maybeHold(() => realEncrypt(algorithm, key, data)),
  );
  const spyDecrypt = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(
    async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) =>
      maybeHold(() => realDecrypt(algorithm, key, data)),
  );
  try {
    const pending = transition();
    pending.catch(() => undefined);
    await atTransition;
    let settled = false;
    const inFlight = write();
    inFlight.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Varias vueltas del bucle de eventos: leyendo el estado FUERA del candado, aqui ya estaria decidida.
    await sleep(50);
    const settledWhileHeld = settled;
    open();
    await pending;
    await inFlight.catch(() => undefined);
    return settledWhileHeld;
  } finally {
    spyEncrypt.mockRestore();
    spyDecrypt.mockRestore();
  }
}

/**
 * Corre `transition` y copia el marcador `lockTransition` que deja escrito en disco mientras corre (lo que
 * haria un atacante que espia el equipo a mitad de una desactivacion). Espera a que termine y se queda con
 * la copia: da igual si la transicion acabo bien o mal.
 */
async function captureMarkerDuring(transition: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let reached!: () => void;
  const atTransition = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let open!: () => void;
  const hold = new Promise<void>((resolve) => {
    open = resolve;
  });
  let first = true;
  const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(
    async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
      if (first) {
        first = false;
        reached();
        await hold;
        return realDecrypt(algorithm, key, data);
      }
      return realDecrypt(algorithm, key, data);
    },
  );
  try {
    const pending = transition();
    pending.catch(() => undefined);
    await atTransition;
    const captured = (await rawTransition()) as Record<string, unknown>;
    open();
    await pending.catch(() => undefined);
    return captured;
  } finally {
    spy.mockRestore();
  }
}

/**
 * Corre `activate` y copia el marcador `lockTransition` que queda escrito en `fize-local` a mitad de la
 * migracion (lo que haria un atacante espiando el equipo durante una activacion que acaba bien). La copia se
 * toma en el primer cifrado posterior a la escritura del marcador, que es cuando el marcador ya esta en
 * disco. Espera a que la activacion termine (bien o mal) y devuelve la copia.
 */
async function captureLockingMarkerDuring(activate: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let reached!: () => void;
  const atMarker = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let open!: () => void;
  const hold = new Promise<void>((resolve) => {
    open = resolve;
  });
  let holding = false;
  const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(
    async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
      if (!holding && (await rawTransition()) !== undefined) {
        holding = true;
        reached();
        await hold;
      }
      return realEncrypt(algorithm, key, data);
    },
  );
  try {
    const pending = activate();
    pending.catch(() => undefined);
    await atMarker;
    const captured = (await rawTransition()) as Record<string, unknown>;
    open();
    await pending.catch(() => undefined);
    return captured;
  } finally {
    spy.mockRestore();
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

    // Corte simulado: la fila del restaurante volvio a quedar en claro y el marcador quedo a medias
    // FIRMADO por la DEK (y con el nonce del sobre), que es lo que deja la activacion de verdad.
    await (await entityDb()).put('restaurant', { id: 'r1', instance_id: INSTANCE, name: 'Fonda Secreta', slug: 'fonda-secreta' });
    await writeLockTransition(
      { v: 1, phase: 'locking', done: ['local'], startedAt: new Date().toISOString(), nonce: await envelopeNonce() },
      getActiveDek()!,
    );
    lock();

    await unlock('pin', PIN, undefined, FAST);

    expect(await readLockTransition()).toBeNull();
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'r1'))).toBe(true);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    await disableProtection();
  });

  it('un corte REAL a mitad de la activacion se reanuda al desbloquear y termina todo cifrado', async () => {
    await seedPlaintext();

    // El fallo se inyecta DENTRO de la migracion (un cifrado intermedio), no escribiendo el marcador a mano:
    // la activacion muere despues de marcar la fase `local` como hecha y antes de terminar `entities`, que es
    // un corte de verdad (pestaña cerrada, equipo apagado).
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let injected = false;
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(
      async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
        if (!injected) {
          const marker = (await rawTransition()) as { done?: unknown } | undefined;
          if (marker && Array.isArray(marker.done) && marker.done.includes('local')) {
            injected = true;
            throw new Error('fallo inyectado a mitad de la migracion');
          }
        }
        return realEncrypt(algorithm, key, data);
      },
    );
    try {
      await expect(enableProtection('pin', PIN, undefined, FAST)).rejects.toThrow(/fallo inyectado/);
    } finally {
      spy.mockRestore();
    }

    // Lo que dejo el corte: sobre escrito y estado bloqueado, la fase `local` cifrada, el resto en claro y el
    // marcador apuntando a la fase `local`.
    expect(await getLockState()).toBe('locked');
    const cut = await readLockTransition();
    const nonceAtCut = await envelopeNonce();
    expect(cut?.phase).toBe('locking');
    expect(cut?.done).toEqual(['local']);
    expect(await findPlaintextLeftovers()).not.toEqual([]);

    lock();
    await unlock('pin', PIN, undefined, FAST);

    // La reanudacion legitima termina el trabajo: si el marcador del corte no estuviera firmado (o el
    // desbloqueo lo descartara en vez de reanudarlo), todo lo que falto cifrar seguiria en claro y leerlo
    // moriria con `PlaintextDataError`.
    expect(await getLockState()).toBe('unlocked');
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    expect((await pendingMutations())[0].record.total).toBe(9000);
    expect((await createIdbDeviceShareStore().load(INSTANCE))?.recovery).toEqual({ blobs: 'share-recuperacion' });
    expect(await findPlaintextLeftovers()).toEqual([]);
    expect(await readLockTransition()).toBeNull();

    // El marcador del corte (capturado ANTES del desbloqueo) estaba firmado por la DEK y traia el nonce que el
    // sobre tenia entonces: es lo que autoriza a reanudar. El nonce no puede haber rotado antes del cierre:
    // mientras quede texto plano, el marcador tiene que seguir valiendo o el equipo no tendria como terminar.
    expect(cut?.mac).toBeTruthy();
    expect(cut?.nonce).toBe(nonceAtCut);

    // Y sigue siendo el MISMO equipo: los datos se leen con la DEK del sobre despues de bloquear de nuevo.
    lock();
    await unlock('pin', PIN, undefined, FAST);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    await disableProtection();
  });

  it('un corte REAL en la entrada de la migracion (nada cifrado todavia) se reanuda igual', async () => {
    await seedPlaintext();

    // El fallo cae en el primer cifrado posterior a la escritura del sobre: la activacion muere en el mismo
    // umbral de la migracion, cuando todavia no ha cifrado ni una fila. El marcador que queda en `fize-local`
    // es el que escribio `enableProtection` (nada escrito a mano), y es el caso mas estrecho: si ese marcador
    // no estuviera firmado, el desbloqueo lo descartaria y el equipo quedaria con el sobre puesto y TODOS los
    // datos en claro, sin camino de vuelta (leerlos muere con `PlaintextDataError` y no hay transicion que
    // reanudar ni forma de activar/desactivar de nuevo).
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let injected = false;
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(
      async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
        if (!injected && (await rawEnvelope()) !== undefined) {
          injected = true;
          throw new Error('fallo inyectado al entrar en la migracion');
        }
        return realEncrypt(algorithm, key, data);
      },
    );
    try {
      await expect(enableProtection('pin', PIN, undefined, FAST)).rejects.toThrow(/fallo inyectado/);
    } finally {
      spy.mockRestore();
    }
    expect(injected).toBe(true);

    const cut = await readLockTransition();
    const nonceAtCut = await envelopeNonce();
    expect(cut?.done).toEqual([]);
    expect(await findPlaintextLeftovers()).not.toEqual([]);

    lock();
    await unlock('pin', PIN, undefined, FAST);

    expect(await getLockState()).toBe('unlocked');
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    expect((await pendingMutations())[0].record.total).toBe(9000);
    expect(await findPlaintextLeftovers()).toEqual([]);
    expect(await readLockTransition()).toBeNull();
    expect(cut?.mac).toBeTruthy();
    expect(cut?.nonce).toBe(nonceAtCut);

    await disableProtection();
    expect(await getLockState()).toBe('off');
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

// ---------------------------------------------------------------------------
// Perdida de datos: cifrar FUERA del candado dejaba `{__enc}` huerfanos (sin llave) si la desactivacion
// ganaba el turno, y una DEK vieja seguia escribiendo despues de desactivar y reactivar en otra pestaña.
// ---------------------------------------------------------------------------

describe('deviceLock: escrituras en vuelo y transiciones', () => {
  const parallel = (): DomainRecord => rec('r-par', { name: 'Paralela' });

  const writers: { nombre: string; start: () => Promise<unknown>; check: () => Promise<void> }[] = [
    {
      nombre: 'create (adapter)',
      start: () => getIdbAdapter().create('restaurant', parallel()),
      check: async () => {
        expect((await getIdbAdapter().get('restaurant', 'r-par', INSTANCE))?.name).toBe('Paralela');
      },
    },
    {
      nombre: 'setLocal',
      start: () => setLocal('settings', { publishedSlug: 'paralela', tableCount: 7 }),
      check: async () => {
        expect(await getLocal('settings')).toEqual({ publishedSlug: 'paralela', tableCount: 7 });
      },
    },
    {
      nombre: 'updateLocalAtomically',
      start: () =>
        updateLocalAtomically(async (tx) => {
          tx.put('settings', { publishedSlug: 'paralela', tableCount: 7 });
        }),
      check: async () => {
        expect(await getLocal('settings')).toEqual({ publishedSlug: 'paralela', tableCount: 7 });
      },
    },
    {
      nombre: 'replaceInstanceRows',
      start: () => getIdbAdapter().replaceInstanceRows(INSTANCE, { restaurant: [parallel()] }),
      check: async () => {
        expect((await getIdbAdapter().get('restaurant', 'r-par', INSTANCE))?.name).toBe('Paralela');
      },
    },
    {
      nombre: 'outbox (enqueueMutation)',
      start: () => enqueueMutation('order', 'create', rec('o-par', { total: 4321 }), INSTANCE),
      check: async () => {
        const pending = await pendingMutations();
        expect(pending.map((e) => e.record.total)).toContain(4321);
      },
    },
    {
      nombre: 'shares del dispositivo',
      start: async () => {
        await createIdbDeviceShareStore().save(INSTANCE, {
          device: { blobs: 'paralelo' },
          recovery: { blobs: 'paralelo' },
        });
      },
      check: async () => {
        expect((await createIdbDeviceShareStore().load(INSTANCE))?.device).toEqual({ blobs: 'paralelo' });
      },
    },
  ];

  for (const writer of writers) {
    it(`desactivar con una escritura en vuelo (${writer.nombre}) no deja nada cifrado sin llave`, async () => {
      await seedPlaintext();
      await enableProtection('pin', PIN, undefined, FAST);

      await inFlightEncryptThenDisable(writer.start);

      expect(await getLockState()).toBe('off');
      // Ni un solo resto cifrado con el sobre ya borrado: era el `{__enc}` huerfano que perdia la fila.
      expect(await findEncryptedLeftovers()).toEqual([]);

      // Y los datos siguen ahi: reactivar y leer (antes reventaba con "Dato alterado o llave incorrecta").
      await enableProtection('pin', PIN, undefined, FAST);
      await writer.check();
      await disableProtection();
    });
  }

  it('activar con una escritura en vuelo no deja el valor en claro con la proteccion activa', async () => {
    let reached!: () => void;
    const atCallback = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let open!: () => void;
    const hold = new Promise<void>((resolve) => {
      open = resolve;
    });

    const write = updateLocalAtomically(async (tx) => {
      reached();
      await hold;
      tx.put('settings', { publishedSlug: 'en-vuelo', tableCount: 5 });
    });
    await atCallback;

    const enable = enableProtection('pin', PIN, undefined, FAST);
    // Con el candado compartido, activar espera a la escritura; sin el, activa entero y la migracion ya
    // paso, asi que el `put` en claro aterriza DESPUES con la proteccion activa.
    const deadline = Date.now() + 500;
    const activationDone = async (): Promise<boolean> =>
      (await rawEnvelope()) !== undefined && (await rawTransition()) === undefined;
    while (!(await activationDone()) && Date.now() < deadline) await sleep(10);
    const activatedFirst = await activationDone();
    if (activatedFirst) await sleep(30);
    open();
    await write;
    await enable;

    expect(await findPlaintextLeftovers()).toEqual([]);
    expect(isEncryptedBlob(await getStoredLocal('settings'))).toBe(true);
    expect(await getLocal('settings')).toEqual({ publishedSlug: 'en-vuelo', tableCount: 5 });
    await disableProtection();
  });

  it('una escritura en vuelo no aterriza con la llave VIEJA tras desactivar y reactivar', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    const storage = getIdbAdapter();
    await inFlightEncryptThen(
      () => storage.create('restaurant', rec('r-re', { name: 'Reactivada' })),
      async () => {
        await disableProtection();
        await enableProtection('pin', PIN, undefined, FAST);
      },
    );

    // La fila se lee: su sobre es el de la llave vigente (con el defecto queda cifrada con la vieja y esta
    // lectura muere con "Dato alterado o llave incorrecta").
    expect((await storage.get('restaurant', 'r-re', INSTANCE))?.name).toBe('Reactivada');
    expect(await getLockState()).toBe('unlocked');

    await disableProtection();
    expect(await findEncryptedLeftovers()).toEqual([]);
  });

  it('la cola del candado serializa la escritura con la desactivacion', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // La escritura NO puede ver el estado antes del candado: si lo viera, guardaria con la DEK vieja.
    await Promise.all([
      getIdbAdapter().create('restaurant', rec('r-cola', { name: 'En cola' })),
      setLocal('settings', { tableCount: 11 }),
      disableProtection(),
    ]);

    expect(await getLockState()).toBe('off');
    expect(await findEncryptedLeftovers()).toEqual([]);
    await enableProtection('pin', PIN, undefined, FAST);
    expect((await getIdbAdapter().get('restaurant', 'r-cola', INSTANCE))?.name).toBe('En cola');
    await disableProtection();
  });

  it('leer el estado FUERA del candado dejaria cifrada con la llave vieja la escritura que espera a desactivar', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // La desactivacion ya tiene el candado tomado cuando la escritura se lanza. Leyendo el estado fuera
    // del candado, la escritura guarda su foto de ANTES ('unlocked' + DEK vieja) y aterriza despues de que
    // el sobre se borrara: el valor queda con `{__enc}` y sin llave que lo abra.
    const settledWhileHeld = await writeWhileTransitionHoldsGate(
      () => disableProtection(),
      () => setLocal('settings', { publishedSlug: 'en-vuelo', tableCount: 4 }),
    );

    expect(settledWhileHeld).toBe(false);
    expect(await getLockState()).toBe('off');
    expect(await findEncryptedLeftovers()).toEqual([]);
    // El valor se guardo con el estado NUEVO (en claro), no cifrado con la DEK que ya no existe.
    expect(await getLocal('settings')).toEqual({ publishedSlug: 'en-vuelo', tableCount: 4 });
  });

  it('leer el estado FUERA del candado decidiria mal la escritura que espera a activar', async () => {
    await seedPlaintext();

    // La activacion ya tiene el candado tomado cuando la escritura se lanza. Leyendo el estado fuera del
    // candado, la escritura se decide en ese hueco (con el estado de antes de activar) en vez de esperar su
    // turno dentro del candado.
    const settledWhileHeld = await writeWhileTransitionHoldsGate(
      () => enableProtection('pin', PIN, undefined, FAST),
      () => setLocal('settings', { publishedSlug: 'al-activar', tableCount: 8 }),
    );

    expect(settledWhileHeld).toBe(false);
    expect(await findPlaintextLeftovers()).toEqual([]);
    expect(isEncryptedBlob(await getStoredLocal('settings'))).toBe(true);
    await disableProtection();
    expect(await getLocal('settings')).toEqual({ publishedSlug: 'al-activar', tableCount: 8 });
  });
});

describe('deviceLock: la DEK esta atada a la generacion del sobre', () => {
  it('desactivar y reactivar en otra pestaña invalida la DEK vieja aunque nadie avise', async () => {
    await enableProtection('pin', PIN, undefined, FAST);

    // Pestaña B, sin BroadcastChannel: no se entera de ningun aviso, solo puede darse cuenta por el sobre.
    vi.resetModules();
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const tabB = await import('./deviceLock');
      const tabBLocal = await import('./localDb');
      await tabB.unlock('pin', PIN, undefined, FAST);
      expect(await tabB.getLockState()).toBe('unlocked');
      expect(tabB.getActiveDek()).not.toBeNull();

      await disableProtection();
      await enableProtection('pin', PIN, undefined, FAST);

      // La DEK de B era del sobre anterior: se suelta al preguntar el estado.
      expect(await tabB.getLockState()).toBe('locked');
      expect(tabB.getActiveDek()).toBeNull();

      // Y no escribe con la llave vieja (antes la fila quedaba cifrada con una llave que A no podia leer).
      // (El error es de OTRA instancia del modulo: se comprueba el mensaje, no el `instanceof`.)
      await expect(tabBLocal.setLocal('settings', { tableCount: 9 })).rejects.toThrow(/bloqueada/);
      // Ni desactiva la proteccion con una DEK que no es la del sobre vigente.
      await expect(tabB.disableProtection()).rejects.toThrow(/bloqueada/);
      expect(await getLockState()).toBe('unlocked');

      tabB.resetDeviceLockForTests();
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
    }
    await disableProtection();
  });

  it('desactivar avisa a la otra pestaña para que suelte su DEK', async () => {
    await enableProtection('pin', PIN, undefined, FAST);

    vi.resetModules();
    const tabB = await import('./deviceLock');
    // La pestaña tiene el LockGate montado: eso crea su BroadcastChannel.
    const unsubscribe = tabB.subscribeLockEvents(() => undefined);
    await tabB.unlock('pin', PIN, undefined, FAST);
    expect(tabB.getActiveDek()).not.toBeNull();

    await disableProtection();
    await until(() => tabB.getActiveDek() === null);
    expect(await tabB.getLockState()).toBe('off');

    unsubscribe();
    tabB.resetDeviceLockForTests();
  });

  it('disableProtection corta la DEK caducada antes de tocar los datos', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Pestaña B, con la DEK del sobre ANTERIOR en memoria y sin canal de aviso (no se entera de nada).
    vi.resetModules();
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const tabB = await import('./deviceLock');
      await tabB.unlock('pin', PIN, undefined, FAST);
      expect(tabB.getActiveDek()).not.toBeNull();

      // La pestaña A desactiva y vuelve a activar: sobre NUEVO, DEK nueva. B sigue con la vieja.
      await disableProtection();
      await enableProtection('pin', PIN, undefined, FAST);

      // SIN preguntar antes el estado (que es lo que soltaria la DEK vieja), B intenta desactivar. El
      // corte de la DEK caducada es lo unico que impide que recorra los cuatro almacenes con una llave que
      // ya no abre nada (y que el marcador firmado con ella quede escrito en el equipo).
      await expect(tabB.disableProtection()).rejects.toThrow(/bloqueada/);

      // La proteccion de A sigue entera y los datos siguen cifrados y legibles con su llave.
      expect(await getLockState()).toBe('unlocked');
      expect(isEncryptedBlob(await rawEnvelope())).toBe(false);
      expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');

      tabB.resetDeviceLockForTests();
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
    }
    await disableProtection();
    expect(await getLockState()).toBe('off');
  });
});

describe('deviceLock: el marcador de transicion no autoriza nada por si solo', () => {
  it('un marcador `locking` sin firma no blanquea texto plano inyectado', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);
    lock();

    // Ataque (ronda 3): con el equipo bloqueado se planta la llave del atacante, una fila de negocio y un
    // marcador `{phase:'locking'}` SIN firma. El desbloqueo reanudaba la transicion sin mirar la firma y
    // cifraba con la DEK buena lo que encontrara en claro, asi que las tres cosas quedaban legitimas (y el
    // atacante sustituia la llave del restaurante).
    await (await kvDb()).put(KV_STORE, { privateJwk: { d: 'ATTACKER' } }, 'identity');
    await (await entityDb()).put('restaurant', { id: 'inj', instance_id: INSTANCE, name: 'Inyectado' });
    await (await kvDb()).put(
      KV_STORE,
      { v: 1, phase: 'locking', done: [], startedAt: new Date().toISOString() },
      'lockTransition',
    );

    await unlock('pin', PIN, undefined, FAST);

    // Ni se cifro lo inyectado (no queda blanqueado como dato legitimo)...
    expect(isEncryptedBlob(await (await kvDb()).get(KV_STORE, 'identity'))).toBe(false);
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'inj'))).toBe(false);
    // ...ni se acepta como dato: sigue saliendo `PlaintextDataError`.
    await expect(getLocal('identity')).rejects.toThrow(/sin cifrar/);
    await expect(getIdbAdapter().get('restaurant', 'inj', INSTANCE)).rejects.toThrow(/sin cifrar/);
    // El marcador sin firma se descarta: no queda ahi para el proximo desbloqueo.
    expect(await readLockTransition()).toBeNull();
    // Y lo que ya estaba cifrado sigue leyendose con normalidad.
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);

    await (await kvDb()).delete(KV_STORE, 'identity');
    await (await entityDb()).delete('restaurant', 'inj');
    await disableProtection();
  });

  it('un marcador `locking` con firma INVALIDA tampoco autoriza nada', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);
    lock();

    await (await kvDb()).put(KV_STORE, { privateJwk: { d: 'ATTACKER' } }, 'identity');
    await (await entityDb()).put('restaurant', { id: 'inj2', instance_id: INSTANCE, name: 'Inyectado 2' });
    // Firmado con una llave que no es la del equipo (y con el nonce copiado del sobre, que es publico): el
    // MAC no se puede autenticar con la DEK del restaurante.
    const stranger = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await writeLockTransition(
      { v: 1, phase: 'locking', done: [], startedAt: new Date().toISOString(), nonce: await envelopeNonce() },
      stranger,
    );

    await unlock('pin', PIN, undefined, FAST);

    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'inj2'))).toBe(false);
    expect(isEncryptedBlob(await (await kvDb()).get(KV_STORE, 'identity'))).toBe(false);
    await expect(getLocal('identity')).rejects.toThrow(/sin cifrar/);
    expect(await readLockTransition()).toBeNull();

    await (await kvDb()).delete(KV_STORE, 'identity');
    await (await entityDb()).delete('restaurant', 'inj2');
    await disableProtection();
  });

  it('un marcador `locking` CAPTURADO en una activacion correcta deja de autorizar', async () => {
    await seedPlaintext();

    // El atacante copia el marcador que la activacion deja escrito en `fize-local` mientras la migracion
    // corre. La activacion termina bien (se rota el nonce del sobre y se borra el marcador), pero la copia
    // ya esta hecha.
    const captured = await captureLockingMarkerDuring(() => enableProtection('pin', PIN, undefined, FAST));
    expect(captured.mac).toBeTruthy();
    expect(typeof captured.nonce).toBe('string');
    expect(await readLockTransition()).toBeNull();

    lock();

    // Ataque: con el equipo bloqueado se planta la llave del atacante, una fila de negocio y la copia del
    // marcador. Si el nonce no rotara al cerrar la activacion, la copia seguiria perteneciendo a la
    // transicion vigente del sobre: el desbloqueo "reanudaria" la activacion y cifraria con la DEK buena el
    // texto plano inyectado, blanqueandolo como dato legitimo.
    await (await kvDb()).put(KV_STORE, { privateJwk: { d: 'ATTACKER' } }, 'identity');
    await (await entityDb()).put('restaurant', { id: 'inj-cap', instance_id: INSTANCE, name: 'Inyectado' });
    await (await kvDb()).put(KV_STORE, captured, 'lockTransition');

    await unlock('pin', PIN, undefined, FAST);

    // Nada de lo inyectado quedo cifrado como si fuera legitimo...
    expect(isEncryptedBlob(await (await kvDb()).get(KV_STORE, 'identity'))).toBe(false);
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'inj-cap'))).toBe(false);
    // ...ni se acepta como dato.
    await expect(getLocal('identity')).rejects.toThrow(/sin cifrar/);
    await expect(getIdbAdapter().get('restaurant', 'inj-cap', INSTANCE)).rejects.toThrow(/sin cifrar/);
    // La copia rancia se descarta y el equipo queda desbloqueado (ni un intento fallido de mas).
    expect(await readLockTransition()).toBeNull();
    expect(await getLockState()).toBe('unlocked');
    // Y lo que ya estaba cifrado sigue leyendose con normalidad.
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    // El nonce del sobre roto al cerrar la activacion: por eso la copia ya no pertenece a la transicion
    // vigente (es el mecanismo que hace todo lo de arriba).
    expect(await envelopeNonce()).not.toBe(captured.nonce);

    await (await kvDb()).delete(KV_STORE, 'identity');
    await (await entityDb()).delete('restaurant', 'inj-cap');
    await disableProtection();
  });

  it('un marcador `locking` CAPTURADO de un corte REANUDADO tampoco autoriza', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Corte simulado con la forma que deja una activacion cortada: la fase `local` hecha, la fila del
    // restaurante vuelta a quedar en claro y el marcador firmado por la DEK con el nonce vigente.
    await (await entityDb()).put('restaurant', { id: 'r1', instance_id: INSTANCE, name: 'Fonda Secreta', slug: 'fonda-secreta' });
    await writeLockTransition(
      { v: 1, phase: 'locking', done: ['local'], startedAt: new Date().toISOString(), nonce: await envelopeNonce() },
      getActiveDek()!,
    );
    // El atacante copia el marcador justo antes de que el usuario reanude.
    const captured = (await rawTransition()) as Record<string, unknown>;

    lock();
    await unlock('pin', PIN, undefined, FAST);
    expect(await readLockTransition()).toBeNull();

    // Ataque: se planta la copia (con `done:['local']`, que se salta la fase donde vive `identity`) y una
    // fila inyectada con el equipo ya bloqueado.
    await (await kvDb()).put(KV_STORE, { privateJwk: { d: 'ATTACKER' } }, 'identity');
    await (await entityDb()).put('restaurant', { id: 'inj-res', instance_id: INSTANCE, name: 'Inyectado' });
    await (await kvDb()).put(KV_STORE, captured, 'lockTransition');
    lock();

    // Sin la rotacion, aqui el desbloqueo reanudaba con el `done` capturado: cifraba la fila inyectada y,
    // como `local` se lo saltaba, `identity` seguia en claro y el desbloqueo fallaba en CADA intento
    // (`No se pudo cifrar todo (local/identity)`), tambien con el codigo de recuperacion.
    await unlock('pin', PIN, undefined, FAST);

    expect(isEncryptedBlob(await (await kvDb()).get(KV_STORE, 'identity'))).toBe(false);
    expect(isEncryptedBlob(await (await entityDb()).get('restaurant', 'inj-res'))).toBe(false);
    await expect(getLocal('identity')).rejects.toThrow(/sin cifrar/);
    await expect(getIdbAdapter().get('restaurant', 'inj-res', INSTANCE)).rejects.toThrow(/sin cifrar/);
    expect(await readLockTransition()).toBeNull();
    expect(await getLockState()).toBe('unlocked');
    // Lo inyectado a proposito sigue en claro (no se blanquea) y lo del equipo sigue intacto y legible.
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    // El cierre de la reanudacion roto el nonce: la copia del corte ya no pertenece a la transicion vigente.
    expect(await envelopeNonce()).not.toBe(captured.nonce);

    await (await kvDb()).delete(KV_STORE, 'identity');
    await (await entityDb()).delete('restaurant', 'inj-res');
    await disableProtection();
  });

  it('un sobre de una version previa (sin `transitionNonce`) sigue reanudando su corte', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Sobre "viejo": la misma llave envuelta, pero sin el `transitionNonce` que estreno esta version (como
    // lo dejaria la version anterior de la app en disco). Nada de lo que hay guardado se migra por eso.
    const envelope = (await rawEnvelope()) as Record<string, unknown>;
    delete envelope.transitionNonce;
    await (await kvDb()).put(KV_STORE, envelope, 'lockEnvelope');
    expect(await envelopeNonce()).toBeUndefined();

    // Corte con un marcador de entonces: sin nonce, y sigue valiendo por su MAC.
    await (await entityDb()).put('restaurant', { id: 'r1', instance_id: INSTANCE, name: 'Fonda Secreta', slug: 'fonda-secreta' });
    await writeLockTransition(
      { v: 1, phase: 'locking', done: ['local'], startedAt: new Date().toISOString() },
      getActiveDek()!,
    );
    lock();
    await unlock('pin', PIN, undefined, FAST);

    expect(await readLockTransition()).toBeNull();
    expect(await findPlaintextLeftovers()).toEqual([]);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
    // Y al cerrar la transicion el sobre estrena el nonce que le faltaba, que es lo que hace que una copia
    // del marcador de antes deje de autorizar a partir de ahi.
    expect(typeof (await envelopeNonce())).toBe('string');

    await disableProtection();
    expect(await getLockState()).toBe('off');
  });

  it('un marcador `unlocking` plantado a mano NO abre la puerta al texto plano', async () => {
    await enableProtection('pin', PIN, undefined, FAST);

    // Ataque: se escribe el marcador en `fize-local` (devtools, perfil restaurado, copia vieja) y una
    // "identidad" en claro con la llave del atacante.
    await (await kvDb()).put(
      KV_STORE,
      { v: 1, phase: 'unlocking', done: [], startedAt: new Date().toISOString() },
      'lockTransition',
    );
    await (await kvDb()).put(KV_STORE, { privateJwk: { d: 'ATTACKER' } }, 'identity');

    lock();
    await unlock('pin', PIN, undefined, FAST);

    await expect(getLocal('identity')).rejects.toThrow(/sin cifrar/);
    await (await kvDb()).delete(KV_STORE, 'lockTransition');
    await (await kvDb()).delete(KV_STORE, 'identity');
    await disableProtection();
  });

  it('un desbloqueo TERMINA la desactivacion que quedo a medias (marcador firmado por la DEK)', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Corte simulado: la pestaña que desactivaba alcanzo a descifrar `fize-local` (marcador firmado con el
    // nonce vigente del sobre) y murio.
    const dek = getActiveDek()!;
    await writeLockTransition(
      { v: 1, phase: 'unlocking', done: [], startedAt: new Date().toISOString(), nonce: await envelopeNonce() },
      dek,
    );
    await migrateLocalValues('unlocking', dek);
    lock();

    await unlock('pin', PIN, undefined, FAST);

    expect(await getLockState()).toBe('off');
    expect(await readLockTransition()).toBeNull();
    expect(await findEncryptedLeftovers()).toEqual([]);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
  });

  it('un marcador `unlocking` CAPTURADO no se puede repetir en un desbloqueo posterior', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // El usuario pide desactivar y el intento falla a mitad (una fila cifrada dañada). El atacante copia
    // el marcador firmado que autoriza ESE intento; el fallo rota el nonce del sobre y escribe el marcador
    // del reintento, asi que la copia deja de pertenecer a la transicion vigente.
    await (await entityDb()).put('order', { id: 'o1', instance_id: INSTANCE, __enc: 'v1.aaaa.bbbb.cccc' });
    const captured = await captureMarkerDuring(() => disableProtection());
    expect(captured.mac).toBeTruthy();
    const capturedNonce = captured.nonce as string | undefined;
    expect(capturedNonce).toBeTruthy();
    expect(await envelopeNonce()).not.toBe(capturedNonce);

    // Ya no hay nada que impida terminar la desactivacion: si el marcador capturado autorizara, el
    // desbloqueo la TERMINARIA solo y el equipo perderia el sobre.
    await (await entityDb()).delete('order', 'o1');

    // Ataque: se planta el marcador capturado y el usuario desbloquea con su PIN.
    await (await kvDb()).put(KV_STORE, captured, 'lockTransition');
    lock();
    await unlock('pin', PIN, undefined, FAST);

    // El marcador capturado ya no pertenece a la transicion vigente del sobre: el desbloqueo NO desactiva
    // nada por su cuenta.
    expect(await getLockState()).toBe('unlocked');
    expect(isEncryptedBlob(await rawEnvelope())).toBe(false);

    // Y cuando el usuario pide desactivar de verdad, la proteccion se va: el reintento legitimo rota el
    // nonce otra vez y escribe el marcador del intento en curso.
    await disableProtection();
    expect(await getLockState()).toBe('off');
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
  });

  it('reescribir el `nonce` de un marcador firmado con el del sobre no lo valida', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Un intento de desactivacion que falla a mitad deja un marcador firmado y rota el nonce del sobre: la
    // copia pertenece a un intento que ya no es el vigente.
    await (await entityDb()).put('order', { id: 'o1', instance_id: INSTANCE, __enc: 'v1.aaaa.bbbb.cccc' });
    const captured = await captureMarkerDuring(() => disableProtection());
    expect(captured.mac).toBeTruthy();
    const capturedNonce = captured.nonce as string | undefined;
    expect(capturedNonce).toBeTruthy();
    // El nonce del sobre esta EN CLARO en `fize-local`: el atacante lo puede leer y copiar al marcador.
    const currentNonce = await envelopeNonce();
    expect(currentNonce).toBeTruthy();
    expect(currentNonce).not.toBe(capturedNonce);
    expect(await rawEnvelope()).toBeTruthy();

    // Ya no hay nada que impida terminar la desactivacion: si el marcador reescrito valiera, el desbloqueo
    // la terminaria solo y el equipo perderia el sobre.
    await (await entityDb()).delete('order', 'o1');

    // Ataque: se le pone al marcador capturado el nonce VIGENTE, conservando su MAC. El MAC se calcula sobre
    // el payload firmado, que incluye el nonce: al no coincidir, el marcador no se puede autenticar y no
    // autoriza nada aunque su campo `nonce` sea el bueno.
    await (await kvDb()).put(KV_STORE, { ...captured, nonce: currentNonce }, 'lockTransition');
    lock();
    await unlock('pin', PIN, undefined, FAST);

    expect(await getLockState()).toBe('unlocked');
    expect(isEncryptedBlob(await rawEnvelope())).toBe(false);

    // Y el usuario desactiva de verdad cuando quiere.
    await disableProtection();
    expect(await getLockState()).toBe('off');
    expect((await getIdbAdapter().get('restaurant', 'r1', INSTANCE))?.name).toBe('Fonda Secreta');
  });

  it('NO borra el sobre si queda un resto cifrado, aunque el marcador diga que todo esta hecho', async () => {
    await seedPlaintext();
    await enableProtection('pin', PIN, undefined, FAST);

    // Resto cifrado que la migracion ya no mira (fases dadas por terminadas) y que la comprobacion SI ve.
    await (await entityDb()).put('order', { id: 'o1', instance_id: INSTANCE, __enc: 'v1.aaaa.bbbb.cccc' });
    await writeLockTransition(
      {
        v: 1,
        phase: 'unlocking',
        done: ['local', 'entities', 'outbox', 'shares'],
        startedAt: new Date().toISOString(),
        nonce: await envelopeNonce(),
      },
      getActiveDek()!,
    );

    await expect(disableProtection()).rejects.toThrow(/No se pudo descifrar todo/);

    // El sobre y la DEK siguen ahi: la fila cifrada no se quedo sin llave.
    expect(isEncryptedBlob(await rawEnvelope())).toBe(false);
    expect(await getLockState()).toBe('unlocked');

    await (await entityDb()).delete('order', 'o1');
    await disableProtection();
    expect(await getLockState()).toBe('off');
  });
});

describe('deviceLock: intentos entre varias pestañas', () => {
  it('no llegan al KDF mas intentos que los que cobra el contador', async () => {
    const POL: LockOptions = {
      policy: { iterations: 10, maxAttempts: 3, baseDelayMs: 5_000, maxDelayMs: 5_000 },
    };
    await enableProtection('pin', PIN, undefined, POL);
    lock();

    const realDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
    let kdfCalls = 0;
    const spy = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(
      (...args: Parameters<SubtleCrypto['deriveKey']>) => {
        kdfCalls += 1;
        return realDeriveKey(...args);
      },
    );
    try {
      const tabs: (typeof import('./deviceLock'))[] = [];
      for (let i = 0; i < 6; i++) {
        vi.resetModules();
        tabs.push(await import('./deviceLock'));
      }
      const results = await Promise.allSettled(tabs.map((tab) => tab.unlock('pin', '000000', undefined, POL)));
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      // Seis pestañas a la vez: el contador solo cobra cuatro intentos (3 fallos + el primero con espera) y
      // los otros dos quedan bloqueados sin tocar el KDF. Con read-modify-write sin atomizar serian seis.
      expect(kdfCalls).toBe(4);
      const blocked = results.filter(
        (result) => result.status === 'rejected' && (result.reason as { name?: string })?.name === 'LockoutError',
      );
      expect(blocked).toHaveLength(2);
      // Y el intento siguiente (ya secuencial) sigue bloqueado.
      await expect(unlock('pin', PIN, undefined, POL)).rejects.toBeInstanceOf(LockoutError);
    } finally {
      spy.mockRestore();
    }
  });
});
