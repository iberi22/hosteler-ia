import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { CloudflareVaultAdapter, type CloudflareEnv } from './cloudflareVaultAdapter';
import { createIdbDeviceShareStore, resetDeviceShareDbForTests } from './deviceShareStore';

function fakeCloud(): CloudflareEnv {
  const r2 = new Map<string, string>();
  const kv = new Map<string, string>();
  return {
    SWAL_R2: {
      put: async (k: string, v: string) => void r2.set(k, v),
      get: async (k: string) => {
        const v = r2.get(k);
        return v === undefined ? null : { text: async () => v };
      },
      delete: async (k: string) => void r2.delete(k),
      list: async () => ({ objects: [] as unknown[] }),
    },
    SWAL_KV: {
      put: async (k: string, v: string) => void kv.set(k, v),
      get: async (k: string) => kv.get(k) ?? null,
    },
  };
}

const rec = () => ({
  id: 'r1',
  instance_id: 'inst1',
  created_at: '2026-10-02T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  secreto: 'dato-confidencial',
});

describe('deviceShareStore (IndexedDB) + vault E2EE', () => {
  beforeEach(() => resetDeviceShareDbForTests());

  it('seal -> "recarga" (nueva instancia + nueva conexion IDB) -> open funciona', async () => {
    const env = fakeCloud();
    const a = new CloudflareVaultAdapter(env, 'app-e2ee', { deviceShareStore: createIdbDeviceShareStore() });
    await a.create('item', rec() as any);

    resetDeviceShareDbForTests(); // simula recarga: se pierde la conexion y la memoria
    const b = new CloudflareVaultAdapter(env, 'app-e2ee', { deviceShareStore: createIdbDeviceShareStore() });
    const got = await b.get('item', 'r1', 'inst1');
    expect(got?.secreto).toBe('dato-confidencial');
  });

  it('sin almacen inyectado, sellar falla cerrado (no cae a memoria)', async () => {
    const env = fakeCloud();
    const a = new CloudflareVaultAdapter(env, 'app-e2ee');
    await expect(a.create('item', rec() as any)).rejects.toThrow(/no device share store/);
  });

  it('serverReadable no necesita almacen de shares', async () => {
    const a = new CloudflareVaultAdapter(fakeCloud(), 'app-srv', { serverReadable: true });
    await expect(a.create('item', rec() as any)).resolves.toBeTruthy();
  });
});
