// El share de la nube (x=3) vive en D1 (sealed_meta.cloud_share): 0 escrituras KV por registro.
// KV free = 1000 escrituras/dia para TODA la cuenta; D1 = 100k filas/dia.
import { describe, it, expect } from 'vitest';
import { CloudflareVaultAdapter, type CloudflareEnv } from './cloudflareVaultAdapter';
import { createMemoryDeviceShareStoreForTests } from './deviceShareStore';

type Row = Record<string, any>;

/** D1 falso minimo: solo las sentencias que usa el adaptador. */
function fakeD1(opts: { withShareColumn?: boolean } = {}) {
  const withCol = opts.withShareColumn !== false;
  const rows = new Map<string, Row>();
  const prepare = (sql: string) => ({
    bind: (...a: any[]) => {
      const run = async () => {
        if (sql.startsWith('INSERT OR REPLACE')) {
          const hasShare = sql.includes('cloud_share');
          if (hasShare && !withCol) throw new Error('table sealed_meta has no column named cloud_share');
          const [id, appId, instance_id, entity, content_hash, r2_key, created_at, cloud_share] = a;
          rows.set(id, { id, appId, instance_id, entity, content_hash, r2_key, created_at, cloud_share: hasShare ? cloud_share : null });
        } else if (sql.startsWith('DELETE')) {
          rows.delete(a[0]);
        } else if (sql.startsWith('UPDATE sealed_meta SET cloud_share')) {
          const r = rows.get(a[1]);
          if (r && r.cloud_share == null) r.cloud_share = a[0];
        }
        return {};
      };
      return {
        run,
        first: async () => {
          if (!withCol && sql.includes('cloud_share')) throw new Error('no such column: cloud_share');
          const r = rows.get(a[0]);
          return r ? { cloud_share: r.cloud_share ?? null } : null;
        },
        all: async () => {
          if (!withCol && sql.includes('cloud_share')) throw new Error('no such column: cloud_share');
          const [appId, inst, entity] = a;
          return { results: [...rows.values()].filter((r) => r.appId === appId && r.instance_id === inst && r.entity === entity) };
        },
      };
    },
  });
  return { db: { prepare } as any, rows };
}

function fakeCloud(d1opts?: { withShareColumn?: boolean }) {
  const r2 = new Map<string, string>();
  const kv = new Map<string, string>();
  let kvPuts = 0;
  const d1 = fakeD1(d1opts);
  const env: CloudflareEnv = {
    SWAL_R2: {
      put: async (k: string, v: string) => void r2.set(k, v),
      get: async (k: string) => (r2.has(k) ? { text: async () => r2.get(k)! } : null),
      delete: async (k: string) => void r2.delete(k),
      list: async () => ({ objects: [] }),
    },
    SWAL_D1: d1.db,
    SWAL_KV: {
      put: async (k: string, v: string) => { kvPuts++; kv.set(k, v); },
      get: async (k: string) => kv.get(k) ?? null,
    },
  };
  return { env, r2, kv, d1, kvPuts: () => kvPuts };
}

const rec = () => ({ id: 'r1', instance_id: 'inst1', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', secreto: 'abc' });
const mk = (env: CloudflareEnv, extra: any = {}) =>
  new CloudflareVaultAdapter(env, 'app', { deviceShareStore: createMemoryDeviceShareStoreForTests(), ...extra });

describe('share de la nube en D1 (0 escrituras KV)', () => {
  it('create/update/delete hacen 0 KV puts y el share queda en la fila D1', async () => {
    const c = fakeCloud();
    const a = mk(c.env);
    await a.create('item', rec() as any);
    expect(JSON.parse(c.d1.rows.get('r1')!.cloud_share)).toHaveLength(1);
    expect(JSON.parse(c.d1.rows.get('r1')!.cloud_share)[0].index).toBe(3);
    await a.update('item', 'r1', { secreto: 'zzz' }, 'inst1');
    expect((await a.get('item', 'r1', 'inst1'))?.secreto).toBe('zzz');
    expect(await a.del('item', 'r1', 'inst1')).toBe(true);
    expect(c.d1.rows.has('r1')).toBe(false);
    expect(c.kvPuts()).toBe(0);
  });

  it('lectura fria (otro isolate) descifra con el share de D1 sin tocar KV', async () => {
    const c = fakeCloud();
    const store = createMemoryDeviceShareStoreForTests();
    await mk(c.env, { deviceShareStore: store }).create('item', rec() as any);
    const cold = mk(c.env, { deviceShareStore: store });
    expect((await cold.get('item', 'r1', 'inst1'))?.secreto).toBe('abc');
    expect(await cold.list('item', 'inst1')).toHaveLength(1);
    expect(c.kvPuts()).toBe(0);
  });

  it('serverReadable: todas las shares en D1, 0 KV puts', async () => {
    const c = fakeCloud();
    const a = new CloudflareVaultAdapter(c.env, 'app', { serverReadable: true });
    await a.create('item', rec() as any);
    expect(JSON.parse(c.d1.rows.get('r1')!.cloud_share)).toHaveLength(3);
    expect(c.kvPuts()).toBe(0);
  });

  it('serverReadable: leer no reescribe (0 escrituras R2/D1/KV por lectura)', async () => {
    for (const withShareColumn of [true, false]) {
      const c = fakeCloud({ withShareColumn });
      const a = new CloudflareVaultAdapter(c.env, 'app', { serverReadable: true });
      await a.create('item', rec() as any);
      const kvAfterCreate = c.kvPuts();
      const r2Before = c.r2.get('app/item/inst1/r1') ?? [...c.r2.values()][0];
      const cold = new CloudflareVaultAdapter(c.env, 'app', { serverReadable: true });
      for (let i = 0; i < 3; i++) {
        expect(await cold.list('item', 'inst1')).toHaveLength(1);
        expect((await new CloudflareVaultAdapter(c.env, 'app', { serverReadable: true }).get('item', 'r1', 'inst1'))?.secreto).toBe('abc');
      }
      expect(c.kvPuts()).toBe(kvAfterCreate);
      expect([...c.r2.values()][0]).toBe(r2Before); // pack no re-sellado
    }
  });

  it('legacy: share solo en KV (cloud_share NULL) sigue legible y migra a D1 sin escribir ni borrar KV', async () => {
    const c = fakeCloud();
    const store = createMemoryDeviceShareStoreForTests();
    await mk(c.env, { deviceShareStore: store }).create('item', rec() as any);
    // Simula registro legacy: share movido a KV, columna NULL.
    const shareJson = c.d1.rows.get('r1')!.cloud_share;
    c.d1.rows.get('r1')!.cloud_share = null;
    c.kv.set('share:app:r1', shareJson);
    const cold = mk(c.env, { deviceShareStore: store });
    expect((await cold.get('item', 'r1', 'inst1'))?.secreto).toBe('abc');
    expect(c.d1.rows.get('r1')!.cloud_share).toBe(shareJson); // migrado
    expect(c.kv.get('share:app:r1')).toBe(shareJson); // KV intacto
    expect(c.kvPuts()).toBe(0);
  });

  it('columna sin migrar: cae a KV (compat) y sigue funcionando', async () => {
    const c = fakeCloud({ withShareColumn: false });
    const store = createMemoryDeviceShareStoreForTests();
    await mk(c.env, { deviceShareStore: store }).create('item', rec() as any);
    expect(c.kvPuts()).toBe(1);
    const cold = mk(c.env, { deviceShareStore: store });
    expect((await cold.get('item', 'r1', 'inst1'))?.secreto).toBe('abc');
    expect(await cold.list('item', 'inst1')).toHaveLength(1);
  });
});
