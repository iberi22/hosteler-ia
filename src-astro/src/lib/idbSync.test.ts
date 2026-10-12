import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueMutation,
  pendingMutations,
  drainOutbox,
  isOnline,
  setOnlineOverride,
  resetSyncForTests,
  clearOutbox,
  backoffDelayMs,
  watchConnectivity,
  MAX_ATTEMPTS,
  type OutboxEntry,
} from './idbSync';
import { getMemoryAdapter } from './domain';
import type { StorageAdapter, DomainRecord } from './domain';

describe('idbSync engine', () => {
  beforeEach(async () => {
    resetSyncForTests();
    await clearOutbox();
    getMemoryAdapter().clear();
    setOnlineOverride(true);
  });

  const record = (id: string): DomainRecord =>
    ({
      id,
      instance_id: 'default',
      name: `Item ${id}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }) as DomainRecord;

  it('isOnline respects override (offline simulation)', () => {
    expect(isOnline()).toBe(true);
    setOnlineOverride(false);
    expect(isOnline()).toBe(false);
  });

  it('enqueue + pending roundtrip through IndexedDB', async () => {
    await enqueueMutation('table', 'create', record('t1'), 'default');
    const pending = await pendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].op).toBe('create');
    expect(pending[0].attempts).toBe(0);
  });

  it('skips drain while offline, keeps outbox intact', async () => {
    await enqueueMutation('table', 'create', record('t1'), 'default');
    setOnlineOverride(false);

    const result = await drainOutbox(getMemoryAdapter());
    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
    expect(await pendingMutations()).toHaveLength(1);
  });

  it('drains creates/updates/deletes into the remote adapter', async () => {
    const remote = getMemoryAdapter();
    await enqueueMutation('restaurant', 'create', record('r1'), 'default');
    await enqueueMutation('restaurant', 'update', { ...record('r1'), name: 'Nuevo' }, 'default');

    const result = await drainOutbox(remote);
    expect(result.synced).toBe(2);
    expect(await pendingMutations()).toHaveLength(0);
    expect(((await remote.get('restaurant', 'r1', 'default')) as any).name).toBe('Nuevo');

    await enqueueMutation('restaurant', 'del', record('r1'), 'default');
    await drainOutbox(remote);
    expect(await remote.get('restaurant', 'r1', 'default')).toBeNull();
  });

  it('retries with backoff and gives up after MAX_ATTEMPTS', async () => {
    let calls = 0;
    const base = getMemoryAdapter();
    const flaky: StorageAdapter = {
      create: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network down');
        return record('x');
      },
      list: (entity, instanceId) => base.list(entity, instanceId),
      get: (entity, id, instanceId) => base.get(entity, id, instanceId),
      update: (entity, id, patch, instanceId) => base.update(entity, id, patch, instanceId),
      del: (entity, id, instanceId) => base.del(entity, id, instanceId),
    };

    await enqueueMutation('table', 'create', record('x'), 'default');
    await drainOutbox(flaky);
    expect(calls).toBe(1);
    let pending: OutboxEntry[] = await pendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);

    await drainOutbox(flaky);
    await drainOutbox(flaky);
    pending = await pendingMutations();
    expect(pending).toHaveLength(0);

    // dead letter: entry stuck past max attempts counts as failed
    await enqueueMutation('table', 'create', record('y'), 'default');
    const base2 = getMemoryAdapter();
    const alwaysFail: StorageAdapter = {
      create: async () => {
        throw new Error('down');
      },
      list: (entity, instanceId) => base2.list(entity, instanceId),
      get: (entity, id, instanceId) => base2.get(entity, id, instanceId),
      update: (entity, id, patch, instanceId) => base2.update(entity, id, patch, instanceId),
      del: (entity, id, instanceId) => base2.del(entity, id, instanceId),
    };
    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      await drainOutbox(alwaysFail);
    }
    pending = await pendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('backoff grows exponentially', () => {
    expect(backoffDelayMs(0)).toBe(500);
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(3)).toBe(4000);
  });

  it('watchConnectivity subscribes/unsubscribes without crashing', () => {
    const stop = watchConnectivity(() => getMemoryAdapter());
    expect(typeof stop).toBe('function');
    window.dispatchEvent(new Event('online'));
    stop();
  });
});
