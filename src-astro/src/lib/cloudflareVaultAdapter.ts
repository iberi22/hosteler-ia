// cloudflareVaultAdapter.ts — StorageAdapter 100% cifrado sobre Cloudflare R2+D1+KV
// Reusable para cualquier app SWAL (gara-g, hosteler-ia, flota, etc).
// Si no hay bindings (mesh-only), fallback a MemoryAdapter (0$, replica P2P en otros nodos gara-g).
// Si hay bindings, cada record se cifra via @swal/vault createSealedPack y se guarda ciphertext en R2 + meta en D1.
// 1 camion = 100 camiones mismo precio: no hay fee por entity, solo bytes (R2) + rows (D1) + AI tokens.

import type { StorageAdapter, DomainRecord } from './domain';
import { domainConfig } from './domain.config';
import type { DeviceShareStore } from './deviceShareStore';
import {
  createSealedPack,
  unpackSealedPack,
  packWithoutShares,
  cloudBoundShare,
  assertCloudSharesSafe,
} from '@swal/vault/sealedPack.js';

// Tipos Cloudflare bindings (compat con wrangler.example.jsonc)
export type CloudflareEnv = {
  SWAL_R2?: { put(key: string, val: string, opts?: any): Promise<any>; get(key: string): Promise<any>; delete(key: string): Promise<any>; list(opts?: any): Promise<any> };
  SWAL_D1?: { prepare(sql: string): { bind(...a: any[]): { first(): Promise<any>; run(): Promise<any>; all(): Promise<any> } } };
  SWAL_KV?: { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
};

export class CloudflareVaultAdapter implements StorageAdapter {
  private env: CloudflareEnv;
  private appId: string;
  // memory fallback para dev/tests sin bindings
  private mem = new Map<string, Map<string, DomainRecord>>();

  // Shares que NUNCA salen del dispositivo (x=1) y de recuperacion (x=2).
  //
  // Sin almacen inyectado NO hay valor por defecto: sellar en modo E2EE FALLA CERRADO (antes caia a un
  // Map en memoria y el registro quedaba indescifrable tras recargar). En el browser se inyecta
  // `createIdbDeviceShareStore()` (IndexedDB); el de memoria es solo para tests.
  private deviceStore: DeviceShareStore | null = null;

  /** Inyecta el almacen local de shares (IndexedDB en browser, keychain en el equipo). */
  setDeviceShareStore(store: DeviceShareStore) {
    this.deviceStore = store;
  }

  /** Share de recuperacion (x=2) para entregar al usuario en el alta. Solo en el dispositivo. */
  async recoveryShare(id: string): Promise<any> {
    const s = this.deviceStore ? await this.deviceStore.load(id) : null;
    return s?.recovery ?? null;
  }

  private async localShares(id: string): Promise<any[]> {
    const s = this.deviceStore ? await this.deviceStore.load(id) : null;
    if (!s) return [];
    return [s.device, s.recovery].filter(Boolean);
  }

  /**
   * Descifra un pack de R2. Combina el share del DISPOSITIVO con el de KV; si el dispositivo no
   * aporta el suyo, no se descifra (falla cerrado: esa es la garantia E2EE).
   *
   * MIGRACION: los packs escritos antes de este fix llevan las 3 shares dentro del pack (y KV las 3).
   * Siguen siendo legibles (`legacy = true`) y el llamador los re-sella con el formato nuevo para que
   * la nube deje de poder descifrarlos. Hasta que se re-sellen, el operador SI puede leerlos.
   */
  private async openPack(pack: any, id: string, prefetched?: string | null): Promise<{ rec: any; legacy: boolean } | null> {
    const kvShares = await this.loadCloudShares(id, prefetched);
    // Legacy: la nube por si sola ya alcanza el umbral (pack con shares o KV con >=2).
    const legacyShares: any[] = kvShares.length >= 2 ? kvShares : (pack.shares ?? []);
    if (legacyShares.length >= 2) {
      const plain = await unpackSealedPack(pack, legacyShares.slice(0, 2));
      return { rec: JSON.parse(new TextDecoder().decode(plain)), legacy: true };
    }
    const shares = [...(await this.localShares(id)), ...kvShares];
    if (shares.length < 2) return null;
    const plain = await unpackSealedPack(pack, shares.slice(0, 2));
    return { rec: JSON.parse(new TextDecoder().decode(plain)), legacy: false };
  }

  /**
   * Share(s) de la nube. Fuente primaria: columna `cloud_share` de D1 (0 escrituras KV por registro).
   * Fallback: KV (registros legacy). Si viene de KV y hay D1, se migra perezosamente a D1; NO se borra
   * de KV (borrar cuesta una escritura KV; limite del plan gratuito de Cloudflare, limpieza puntual).
   */
  private async loadCloudShares(id: string, prefetched?: string | null): Promise<any[]> {
    let raw: string | null = prefetched ?? null;
    if (raw === null && prefetched === undefined && this.env.SWAL_D1?.prepare) {
      try {
        const row = await this.env.SWAL_D1.prepare('SELECT cloud_share FROM sealed_meta WHERE id=? AND appId=?').bind(id, this.appId).first();
        raw = row?.cloud_share ?? null;
      } catch {
        raw = null; // columna aun sin migrar → KV
      }
    }
    if (raw) return JSON.parse(raw) ?? [];
    const kvRaw = (await this.env.SWAL_KV?.get(`share:${this.appId}:${id}`)) || null;
    if (!kvRaw) return [];
    if (this.env.SWAL_D1?.prepare) {
      // Migracion perezosa KV -> D1 (UPDATE no-op si la fila no existe). Sin tocar KV.
      await this.env.SWAL_D1.prepare('UPDATE sealed_meta SET cloud_share=? WHERE id=? AND appId=? AND cloud_share IS NULL')
        .bind(kvRaw, id, this.appId).run().catch(() => {});
    }
    return JSON.parse(kvRaw) ?? [];
  }

  private async migrateLegacy(entity: string, rec: DomainRecord): Promise<void> {
    // En `serverReadable` el pack con las 3 shares ES el formato esperado: re-sellarlo produciria el mismo
    // formato y cada lectura reescribiria el registro (R2 + D1, y KV sin la 003) para siempre.
    if (this.serverReadable) return;
    try {
      await this.create(entity, rec);
    } catch (e) {
      console.warn('[vaultAdapter] legacy pack re-seal failed', e);
    }
  }

  private serverReadable: boolean;
  constructor(env: CloudflareEnv, appId = domainConfig.appId as string, opts: { serverReadable?: boolean; deviceShareStore?: DeviceShareStore } = {}) {
    if (opts.deviceShareStore) this.deviceStore = opts.deviceShareStore;
    this.serverReadable = opts.serverReadable === true;
    this.env = env;
    this.appId = appId;
  }

  private memKey(entity: string) {
    if (!this.mem.has(entity)) this.mem.set(entity, new Map());
    return this.mem.get(entity)!;
  }

  private hasCloud(): boolean {
    return !!this.env.SWAL_R2 || !!this.env.SWAL_D1;
  }

  // Los aislados workerd NO comparten memoria: el cloud path necesita
  // la tabla real. Se crea una vez por aislado (idempotente).
  private async ensureSchema(): Promise<void> {
    if (!this.hasCloud() || !this.env.SWAL_D1) return;
    if ((globalThis as Record<string, unknown>).__sealedMetaReady) return;
    try {
      const db = this.env.SWAL_D1 as {
        exec?: (sql: string) => Promise<unknown>;
        prepare?: (sql: string) => unknown;
      };
      if (db.exec) {
        await db.exec(
          'CREATE TABLE IF NOT EXISTS sealed_meta (id TEXT PRIMARY KEY, appId TEXT, instance_id TEXT, entity TEXT, content_hash TEXT, r2_key TEXT, created_at TEXT, cloud_share TEXT)',
        );
      } else if (db.prepare) {
        await (db.prepare(
          'CREATE TABLE IF NOT EXISTS sealed_meta (id TEXT PRIMARY KEY, appId TEXT, instance_id TEXT, entity TEXT, content_hash TEXT, r2_key TEXT, created_at TEXT, cloud_share TEXT)',
        ) as { run: () => Promise<unknown> }).run();
      }
      (globalThis as Record<string, unknown>).__sealedMetaReady = true;
    } catch {
      // sin DDL (permisos/edge) → se sigue con fallback en memoria
    }
  }

  private r2Key(entity: string, id: string, instanceId: string): string {
    return `packs/${this.appId}/${instanceId}/${entity}/${id}.json`;
  }

  // Cifra record y guarda: R2 ciphertext + D1 meta (content_hash + r2_key)
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    if (!this.hasCloud()) {
      this.memKey(entity).set(record.id, record);
      return record;
    }
    await this.ensureSchema();
    try {
      const payload = new TextEncoder().encode(JSON.stringify(record));
      const pack: any = await createSealedPack(payload, {
        entity, entityId: record.id, appId: this.appId, instanceId: record.instance_id, timestamp: Date.now(),
      } as any);

      const r2Key = this.r2Key(entity, record.id, record.instance_id);

      // ── Frontera E2EE ────────────────────────────────────────────────────────
      // El reparto es Shamir 2-de-3: con dos shares se reconstruye la DEK. Por eso:
      //   * R2 guarda el pack SIN shares (solo ciphertext + metadatos + hash),
      //   * KV guarda UN unico share (x=3),
      //   * los shares x=1 (dispositivo) y x=2 (recuperacion) no salen de aqui.
      // Antes se subia el pack COMPLETO a R2 y ADEMAS las 3 shares a KV: el operador podia
      // reconstruir la clave y la promesa "el operador no puede leer" era falsa.
      // `serverReadable` (SOLO la API SSR del Worker, que es stateless y necesita leer sus propios datos
      // operativos: usuarios, sesiones, pedidos) conserva el reparto antiguo: ahi el operador SI puede
      // leer y NO se debe presentar como E2EE. El modo E2EE (por defecto) es el de arriba.
      const cloudPack = this.serverReadable ? pack : packWithoutShares(pack);
      const kvShare = this.serverReadable ? null : cloudBoundShare(pack.shares ?? []);
      if (!this.serverReadable) {
        if (!this.deviceStore) {
          throw new Error(`[vaultAdapter] create failed for ${entity}/${record.id}: no device share store injected (E2EE seal refused; call setDeviceShareStore)`);
        }
        assertCloudSharesSafe(kvShare ? 1 : 0);
        await this.deviceStore.save(record.id, {
          device: pack.shares?.[0] ?? null,
          recovery: pack.shares?.[1] ?? null,
        });
      }

      let r2Ok = true;
      if (this.env.SWAL_R2?.put) {
        // El PUT a R2 se comprobaba solo por el try/catch global, que ademas
        // cae al fallback de memoria: un registro con R2 caido terminaba en
        // memoria del isolate y se perdia al siguiente request. Se separa para
        // poder distinguir "fallo de R2" de "fallo de D1" en el log.
        r2Ok = await this.env.SWAL_R2.put(r2Key, JSON.stringify(cloudPack), { httpMetadata: { contentType: 'application/json' } })
          .then(() => true)
          .catch((e) => {
            console.error(`[vaultAdapter] R2 PUT failed for ${entity}/${record.id}`, e);
            return false;
          });
      }
      let d1Ok = true;
      const shareJson = this.serverReadable ? (pack.shares?.[0] ? JSON.stringify(pack.shares) : null) : (kvShare ? JSON.stringify([kvShare]) : null);
      let shareInD1 = false;
      if (this.env.SWAL_D1?.prepare) {
        const db = this.env.SWAL_D1;
        const insert = (withShare: boolean) =>
          withShare
            ? db.prepare('INSERT OR REPLACE INTO sealed_meta (id, appId, instance_id, entity, content_hash, r2_key, created_at, cloud_share) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(record.id, this.appId, record.instance_id, entity, pack.content_hash, r2Key, record.created_at, shareJson).run()
            : db.prepare('INSERT OR REPLACE INTO sealed_meta (id, appId, instance_id, entity, content_hash, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(record.id, this.appId, record.instance_id, entity, pack.content_hash, r2Key, record.created_at).run();
        try {
          await insert(true);
          shareInD1 = true;
        } catch (e1) {
          // Columna `cloud_share` aun sin migrar (003): se inserta sin ella y el share va a KV (legacy).
          try {
            await insert(false);
          } catch (e) {
            // No se traga en silencio: un INSERT fallido deja el registro solo
            // en la memoria del isolate y la API responde 201 como si estuviera
            // guardado. Sin este log, un NOT NULL violado tardo horas en verse.
            console.error(`[vaultAdapter] D1 INSERT failed for ${entity}/${record.id}`, e);
            d1Ok = false;
          }
        }
      }
      // El share de la nube va en la MISMA fila D1 (0 escrituras KV; KV solo admite 1000/dia por cuenta).
      // KV queda como fallback si no hay D1 o la columna no esta migrada.
      if (!shareInD1 && shareJson && this.env.SWAL_KV?.put) {
        await this.env.SWAL_KV.put(`share:${this.appId}:${record.id}`, shareJson).catch(() => {});
      }
      if (!d1Ok && !r2Ok) {
        // Ni R2 ni D1 aceptaron el registro: queda solo en la memoria de este
        // isolate y se pierde en el siguiente request. Devolverlo como si fuera
        // un exito es lo que hizo que pagos, recetas y compras se perdieran tres
        // veces con un 201/200 en la cara. Ahora el error sube.
        throw new Error(`[vaultAdapter] create failed for ${entity}/${record.id}: storage rejected the record`);
      }
    } catch (e) {
      // El fallo de persistencia NO se degrada a memoria: se propaga.
      if (e instanceof Error && e.message.startsWith('[vaultAdapter] create failed')) throw e;
      console.warn('[vaultAdapter] cloud create fallback to mem', e);
      this.memKey(entity).set(record.id, record);
    }
    // siempre guarda en mem como cache + mesh replica
    this.memKey(entity).set(record.id, record);
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    // Intenta D1 primero
    if (this.hasCloud() && this.env.SWAL_D1?.prepare) {
      await this.ensureSchema();
      try {
        let hasShareCol = true;
        const q = (cols: string) => this.env.SWAL_D1!.prepare(`SELECT ${cols} FROM sealed_meta WHERE appId=? AND instance_id=? AND entity=?`)
          .bind(this.appId, instanceId, entity).all();
        const res = await q('id, r2_key, cloud_share').catch(() => { hasShareCol = false; return q('id, r2_key'); });
        const rows = (res as any)?.results ?? [];
        if (rows.length > 0 && this.env.SWAL_R2?.get) {
          const out: DomainRecord[] = [];
          for (const row of rows) {
            try {
              const obj = await this.env.SWAL_R2.get(row.r2_key);
              if (!obj) continue;
              const pack = JSON.parse(await obj.text());
              const opened = await this.openPack(pack, row.id, hasShareCol ? (row.cloud_share ?? null) : undefined);
              if (!opened) continue;
              const rec = opened.rec;
              if (rec.instance_id === instanceId) {
                out.push(rec);
                if (opened.legacy) await this.migrateLegacy(entity, rec);
              }
            } catch {}
          }
          if (out.length > 0) return out;
        }
      } catch {}
    }
    return [...this.memKey(entity).values()].filter((r) => r.instance_id === instanceId);
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const mem = this.memKey(entity).get(id) ?? null;
    if (mem && mem.instance_id === instanceId) return mem;
    if (!this.hasCloud()) return null;
    try {
      const r2Key = this.r2Key(entity, id, instanceId);
      const obj = await this.env.SWAL_R2?.get(r2Key);
      if (!obj) return mem;
      const pack = JSON.parse(await obj.text());
      const opened = await this.openPack(pack, id);
      if (!opened) return mem; // sin el share del dispositivo no hay descifrado posible
      const rec = opened.rec;
      if (rec.instance_id !== instanceId) return null;
      if (opened.legacy) await this.migrateLegacy(entity, rec);
      this.memKey(entity).set(id, rec);
      return rec;
    } catch {
      return mem;
    }
  }

  async update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    await this.create(entity, next); // re-cifra y re-subre
    this.memKey(entity).set(id, next);
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return false;
    this.memKey(entity).delete(id);
    if (!this.hasCloud()) return true;
    try {
      const r2Key = this.r2Key(entity, id, instanceId);
      await this.env.SWAL_R2?.delete(r2Key);
      await this.env.SWAL_D1?.prepare('DELETE FROM sealed_meta WHERE id=? AND appId=?').bind(id, this.appId).run().catch(() => {});
      // El share vive en la fila D1 (ya borrada). Sin escritura KV; los restos legacy en KV se limpian
      // una sola vez (cupo de escrituras KV del plan gratuito). Sin D1 (solo KV) se sigue invalidando el share.
      if (!this.env.SWAL_D1?.prepare) await this.env.SWAL_KV?.put(`share:${this.appId}:${id}`, '').catch(() => {});
    } catch {}
    return true;
  }

  // Helper para activar desde app (onMount o Worker)
  static attachIfCloud(env: CloudflareEnv, appId?: string, opts?: { serverReadable?: boolean; deviceShareStore?: DeviceShareStore }): CloudflareVaultAdapter | null {
    if (!env.SWAL_R2 && !env.SWAL_D1) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return new CloudflareVaultAdapter(env, appId, opts);
  }
}
