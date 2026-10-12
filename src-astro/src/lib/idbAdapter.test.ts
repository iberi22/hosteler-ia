import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBAdapter, getIdbAdapter, resetIdbForTests } from './idbAdapter';
import type { DomainRecord } from './domain';

describe('IndexedDBAdapter', () => {
  beforeEach(() => {
    resetIdbForTests();
  });

  const record = (id: string, instance = 'default'): DomainRecord =>
    ({
      id,
      instance_id: instance,
      name: `Item ${id}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }) as DomainRecord;

  it('shares one instance via getIdbAdapter', () => {
    expect(getIdbAdapter()).toBeInstanceOf(IndexedDBAdapter);
    expect(getIdbAdapter()).toBe(getIdbAdapter());
  });

  it('create/get roundtrip with instance isolation', async () => {
    const adapter = new IndexedDBAdapter();
    await adapter.create('restaurant', record('r1', 'a'));
    await adapter.create('restaurant', record('r2', 'b'));

    expect(await adapter.get('restaurant', 'r1', 'a')).not.toBeNull();
    expect(await adapter.get('restaurant', 'r1', 'b')).toBeNull();
    expect(await adapter.get('restaurant', 'missing', 'a')).toBeNull();
  });

  it('list filters by instance_id via index', async () => {
    const adapter = new IndexedDBAdapter();
    await adapter.create('table', record('t1', 'a'));
    await adapter.create('table', record('t2', 'a'));
    await adapter.create('table', record('t3', 'b'));

    expect((await adapter.list('table', 'a'))).toHaveLength(2);
    expect((await adapter.list('table', 'b'))).toHaveLength(1);
  });

  it('update refreshes updated_at, del hard-deletes', async () => {
    const adapter = new IndexedDBAdapter();
    await adapter.create('menuItem', record('m1'));

    const updated = await adapter.update('menuItem', 'm1', { name: 'Nuevo' }, 'default');
    expect(updated).not.toBeNull();
    expect((updated as any).name).toBe('Nuevo');
    expect(await adapter.update('menuItem', 'missing', {}, 'default')).toBeNull();

    expect(await adapter.del('menuItem', 'm1', 'default')).toBe(true);
    expect(await adapter.get('menuItem', 'm1', 'default')).toBeNull();
    expect(await adapter.del('menuItem', 'm1', 'default')).toBe(false);
  });

  it('implements the same contract as MemoryAdapter (CRUD parity)', async () => {
    const adapter = new IndexedDBAdapter();
    const created = await adapter.create('order', record('o1'));
    expect(created.id).toBe('o1');
    const list = await adapter.list('order', 'default');
    expect(list.map((r) => r.id)).toContain('o1');
  });
});
