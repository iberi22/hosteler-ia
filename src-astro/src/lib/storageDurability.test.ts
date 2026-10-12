import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ensurePersistentStorage, getStorageQuota, isQuotaExceededError, reportIfQuotaExceeded,
  resetDurabilityForTests, setQuotaNotifier,
} from './storageDurability';
import { IndexedDBAdapter, resetIdbForTests } from './idbAdapter';
import type { DomainRecord } from './domain';

function mockStorage(over: Record<string, unknown> = {}) {
  const storage = {
    persist: vi.fn(async () => true),
    persisted: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 50, quota: 200 })),
    ...over,
  };
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
  return storage;
}

const rec = (id: string): DomainRecord =>
  ({ id, instance_id: 'a', created_at: 'x', updated_at: 'x' }) as DomainRecord;

beforeEach(() => { resetDurabilityForTests(); resetIdbForTests(); });
afterEach(() => { setQuotaNotifier(null); vi.restoreAllMocks(); });

describe('storageDurability', () => {
  it('persist() se pide una sola vez', async () => {
    const s = mockStorage();
    expect(await ensurePersistentStorage()).toBe(true);
    await ensurePersistentStorage();
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a pedir si ya es persistente', async () => {
    const s = mockStorage({ persisted: vi.fn(async () => true) });
    expect(await ensurePersistentStorage()).toBe(true);
    expect(s.persist).not.toHaveBeenCalled();
  });

  it('sin navigator.storage no lanza', async () => {
    mockStorage({ persist: undefined, estimate: undefined });
    expect(await ensurePersistentStorage()).toBe(false);
    expect(await getStorageQuota()).toBeNull();
  });

  it('estimate() devuelve uso, cuota y ratio', async () => {
    mockStorage();
    expect(await getStorageQuota()).toEqual({ usage: 50, quota: 200, ratio: 0.25 });
  });

  it('detecta QuotaExceededError', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError(new Error('x'))).toBe(false);
  });

  it('la primera escritura del adaptador IDB llama persist()', async () => {
    const s = mockStorage();
    await new IndexedDBAdapter().create('restaurant', rec('r1'));
    await new IndexedDBAdapter().create('restaurant', rec('r2'));
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('QuotaExceededError al escribir: toast visible y el error se relanza', async () => {
    mockStorage();
    const notify = vi.fn();
    setQuotaNotifier(notify);
    const err = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const { openDB } = await import('idb');
    const adapter = new IndexedDBAdapter();
    await adapter.create('restaurant', rec('ok')); // abre la DB
    const db = await openDB('fize-db');
    db.close();
    const IDBObjectStore = (globalThis as any).IDBObjectStore;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw err; });
    await expect(adapter.create('restaurant', rec('r3'))).rejects.toBe(err);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/lleno.*25% usado/);
  });

  it('reportIfQuotaExceeded ignora otros errores', async () => {
    const notify = vi.fn();
    setQuotaNotifier(notify);
    expect(await reportIfQuotaExceeded(new Error('x'))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
