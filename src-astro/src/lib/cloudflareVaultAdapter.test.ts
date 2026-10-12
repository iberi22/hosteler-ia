import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter, setStorageAdapter } from './domain';
import { CloudflareVaultAdapter } from './cloudflareVaultAdapter';

describe('cloudflareVaultAdapter mesh-only fallback (0$)', () => {
  beforeEach(() => setStorageAdapter(getMemoryAdapter()));

  it('sin bindings usa mem y no cifra (mesh-only gratis)', async () => {
    const adapter = new CloudflareVaultAdapter({}, 'my-app');
    const rec: any = { id: '1', instance_id: 'inst1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), name: 'test' };
    await adapter.create('item', rec);
    const got = await adapter.get('item', '1', 'inst1');
    expect(got?.name).toBe('test');
    const list = await adapter.list('item', 'inst1');
    expect(list).toHaveLength(1);
    expect(await adapter.del('item', '1', 'inst1')).toBe(true);
    expect(await adapter.get('item', '1', 'inst1')).toBeNull();
  });

  it('aisla por instance_id igual que domain', async () => {
    const adapter = new CloudflareVaultAdapter({}, 'my-app');
    const rec: any = { id: '2', instance_id: 'a', created_at: '', updated_at: '', name: 'x' };
    await adapter.create('item', rec);
    expect(await adapter.get('item', '2', 'b')).toBeNull();
    expect(await adapter.list('item', 'b')).toHaveLength(0);
  });

  it('attachIfCloud retorna null sin bindings (mesh-only)', () => {
    expect(CloudflareVaultAdapter.attachIfCloud({})).toBeNull();
    expect(CloudflareVaultAdapter.attachIfCloud({ SWAL_R2: {} as any })).not.toBeNull();
  });

  it('1 = 100 camiones mismo api (sin fee por vehiculo)', async () => {
    const adapter = new CloudflareVaultAdapter({}, 'flota');
    for (let i = 0; i < 100; i++) {
      await adapter.create('item', { id: `v${i}`, instance_id: 'fleet1', created_at: '', updated_at: '', name: `veh${i}` } as any);
    }
    const list = await adapter.list('item', 'fleet1');
    expect(list).toHaveLength(100);
  });
});
