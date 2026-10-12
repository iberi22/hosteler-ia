import { describe, it, expect, beforeEach } from 'vitest';
import { createEntity, listEntities, getEntity, surrealDefineTable, getMemoryAdapter, setStorageAdapter } from './domain';

describe('domain hosteler-ia', () => {
  beforeEach(() => { getMemoryAdapter().clear(); setStorageAdapter(getMemoryAdapter()); });
  it('restaurant instance isolation', async () => {
    const a = await createEntity('restaurant', { name:'R1', slug:'r1' } as any, 'inst1');
    await createEntity('restaurant', { name:'R2', slug:'r2' } as any, 'inst2');
    expect(a.instance_id).toBe('inst1');
    expect(await listEntities('restaurant','inst1')).toHaveLength(1);
    expect(await listEntities('restaurant','inst2')).toHaveLength(1);
  });
  it('order get respeta instance', async () => {
    const r = await createEntity('order', { tableId:'t1' } as any, 'inst1');
    expect(await getEntity('order', r.id, 'inst1')).not.toBeNull();
    expect(await getEntity('order', r.id, 'inst2')).toBeNull();
  });
  it('surreal DDL', () => {
    const ddl = surrealDefineTable('restaurant');
    expect(ddl).toContain('DEFINE TABLE restaurant');
    expect(ddl).toContain('instance_id');
  });
});
