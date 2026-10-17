import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DomainRecord } from './domain';
import { createIdbDeviceShareStore } from './deviceShareStore';
import { IndexedDBAdapter, getIdbAdapter, resetIdbForTests } from './idbAdapter';
import { enqueueMutation, pendingMutations, resetSyncForTests } from './idbSync';
import {
  disableProtection,
  enableProtection,
  lock,
  LockedError,
  resetDeviceLockForTests,
  unlock,
  type LockOptions,
} from './local/deviceLock';
import { resetLocalDbForTests } from './local/localDb';
import { resetLockMigrationForTests } from './local/lockMigration';
import { entityDb, entityNames, KV_STORE, kvDb, OUTBOX_STORE, outboxDb, resetLocalStoresForTests, SHARES_STORE, sharesDb } from './local/localStores';
import { isEncryptedBlob, PlaintextDataError } from './local/rowCrypto';
import { resetStorageGateForTests } from './local/storageGate';

// Lo que la proteccion de dispositivo cambia en los OTROS almacenes: el adapter de IndexedDB (escrituras
// masivas incluidas), el outbox de sincronizacion y los shares E2EE. Cada escritura se cifra de antemano y
// una fila en claro con la proteccion activa se rechaza en vez de devolverse.

const FAST: LockOptions = { policy: { iterations: 10 } };
const PIN = '123456';

const record = (id: string, instance: string, business: Record<string, unknown> = {}): DomainRecord =>
  ({
    id,
    instance_id: instance,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...business,
  }) as DomainRecord;

async function wipeStores(): Promise<void> {
  await (await kvDb()).clear(KV_STORE);
  const entities = await entityDb();
  for (const entity of entityNames()) await entities.clear(entity);
  await (await outboxDb()).clear(OUTBOX_STORE);
  await (await sharesDb()).clear(SHARES_STORE);
}

beforeEach(async () => {
  await wipeStores();
  resetLocalStoresForTests();
  resetLocalDbForTests();
  resetIdbForTests();
  resetSyncForTests();
  resetDeviceLockForTests();
  resetLockMigrationForTests();
  resetStorageGateForTests();
});

describe('replaceInstanceRows con la proteccion activa', () => {
  it('rechaza la escritura si el equipo esta bloqueado y no deja nada a medias', async () => {
    const instance = 'local-locked';
    await enableProtection('pin', PIN, undefined, FAST);
    await getIdbAdapter().create('restaurant', record('r1', instance, { name: 'Antes' }));
    lock();

    const adapter = new IndexedDBAdapter();
    await expect(
      adapter.replaceInstanceRows(instance, { restaurant: [record('r2', instance, { name: 'Despues' })] }),
    ).rejects.toBeInstanceOf(LockedError);

    await unlock('pin', PIN, undefined, FAST);
    expect(await adapter.get('restaurant', 'r2', instance)).toBeNull();
    expect((await adapter.get('restaurant', 'r1', instance))?.name).toBe('Antes');
    await disableProtection();
  });

  it('cifra las filas que entran de golpe', async () => {
    const instance = 'local-bulk';
    await enableProtection('pin', PIN, undefined, FAST);

    const adapter = new IndexedDBAdapter();
    await adapter.replaceInstanceRows(instance, {
      restaurant: [record('r1', instance, { name: 'Bulk Uno' }), record('r2', instance, { name: 'Bulk Dos' })],
    });

    const raw = await (await entityDb()).get('restaurant', 'r2');
    expect(isEncryptedBlob(raw)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('Bulk Dos');

    const rows = await adapter.list('restaurant', instance);
    expect(rows.map((r) => r.name).sort()).toEqual(['Bulk Dos', 'Bulk Uno']);
    await disableProtection();
  });
});

describe('lecturas con la proteccion activa', () => {
  it('RECHAZA una fila sin `__enc` (texto plano inyectado)', async () => {
    const instance = 'local-injected';
    await enableProtection('pin', PIN, undefined, FAST);
    await getIdbAdapter().create('restaurant', record('r1', instance, { name: 'Legítimo' }));
    await (await entityDb()).put('restaurant', record('plain1', instance, { name: 'Inyectado' }));

    await expect(new IndexedDBAdapter().list('restaurant', instance)).rejects.toBeInstanceOf(PlaintextDataError);
    await expect(new IndexedDBAdapter().get('restaurant', 'plain1', instance)).rejects.toBeInstanceOf(PlaintextDataError);
    await disableProtection();
  });

  it('con la proteccion DESACTIVADA rechaza la fila que sigue cifrada (no la devuelve como dato)', async () => {
    const instance = 'local-orphan';
    // Sobre huerfano: se borro la llave sin descifrar la fila (desactivacion a medias, copia restaurada).
    await (await entityDb()).put('restaurant', record('r1', instance, { __enc: 'v1.aaaa.bbbb.cccc' }));
    await (await entityDb()).put('restaurant', record('r2', instance, { name: 'En claro' }));

    const adapter = new IndexedDBAdapter();
    await expect(adapter.get('restaurant', 'r1', instance)).rejects.toThrow(/siguen cifrados/);
    // La lista tampoco la cuela entre las filas legitimas (antes devolvia el sobre como si fuera negocio).
    await expect(adapter.list('restaurant', instance)).rejects.toThrow(/siguen cifrados/);
    // Y la fila en claro de verdad si se lee.
    expect((await adapter.get('restaurant', 'r2', instance))?.name).toBe('En claro');
  });
});

describe('outbox y shares con la proteccion activa', () => {
  it('el record del outbox se guarda cifrado y se drena descifrado', async () => {
    const instance = 'local-outbox';
    await enableProtection('pin', PIN, undefined, FAST);

    await enqueueMutation('order', 'create', record('o1', instance, { total: 33000 }), instance);

    const raw = (await (await outboxDb()).getAll(OUTBOX_STORE))[0];
    expect(isEncryptedBlob(raw.record)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('33000');

    const pending = await pendingMutations();
    expect(pending[0].record.total).toBe(33000);

    lock();
    expect(await pendingMutations()).toEqual([]);
    await unlock('pin', PIN, undefined, FAST);
    expect((await pendingMutations())[0].record.total).toBe(33000);
    await disableProtection();
  });

  it('los shares del dispositivo se guardan cifrados y vuelven enteros', async () => {
    const instance = 'local-shares';
    await enableProtection('pin', PIN, undefined, FAST);
    const store = createIdbDeviceShareStore();

    await store.save(instance, { device: { blobs: 'x1' }, recovery: { blobs: 'x2' } });

    const raw = await (await sharesDb()).get(SHARES_STORE, instance);
    expect(isEncryptedBlob(raw)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('x2');

    expect(await store.load(instance)).toEqual({ device: { blobs: 'x1' }, recovery: { blobs: 'x2' } });

    lock();
    await expect(store.load(instance)).rejects.toBeInstanceOf(LockedError);
    await unlock('pin', PIN, undefined, FAST);
    expect((await store.load(instance))?.device).toEqual({ blobs: 'x1' });
    await disableProtection();
  });
});
