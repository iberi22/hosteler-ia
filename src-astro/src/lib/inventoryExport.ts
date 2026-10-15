import { KDF_ITERATIONS } from './local/backupCrypto';
import { signedQtyOf } from './inventoryLedger';
import type { StorageAdapter } from './domain';
import { domainConfig } from './domain.config';

export type InventoryExportErrorKind = 'formato' | 'clave' | 'alterado';

const MESSAGES: Record<InventoryExportErrorKind, string> = {
  formato: 'Este archivo no tiene el formato correcto de inventario.',
  clave: 'La clave es incorrecta.',
  alterado: 'El archivo está dañado o fue alterado.',
};

export class InventoryExportError extends Error {
  readonly kind: InventoryExportErrorKind;
  constructor(kind: InventoryExportErrorKind, message = MESSAGES[kind]) {
    super(message);
    this.name = 'InventoryExportError';
    this.kind = kind;
  }
}

export const EXPORT_FORMAT = 'swal-inventory-export/v1' as const;
export const ENC_EXPORT_FORMAT = 'swal-inventory-export-enc/v1' as const;

export interface PlainInventorySnapshot {
  format: typeof EXPORT_FORMAT;
  source: {
    appId: string;
    instanceId: string;
    schemaVersion: number;
    exportedAt: string;
  };
  currency: 'COP';
  locations: Array<{
    id: string;
    name: string;
    type: 'bodega' | 'sucursal';
  }>;
  items: Array<{
    id: string;
    sku?: string | null;
    name: string;
    quantity: number;
    unit?: string | null;
    minStock: number;
    cost: number;
    price: number;
    locationId?: string | null;
    customFields: Record<string, string>;
  }>;
  movements: Array<{
    id: string;
    itemId: string;
    kind: 'purchase' | 'use' | 'waste' | 'adjust';
    qty: number;
    at: string;
  }>;
}

export interface EncryptedInventorySnapshot {
  format: typeof ENC_EXPORT_FORMAT;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  salt: string;
  iv: string;
  check?: string;
  ciphertext: string;
}

export function inventoryExportFilename(_instanceId: string, now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `fize-inventario-${yyyy}-${mm}-${dd}.swal-inventory.json`;
}

function toB64(bin: Uint8Array<ArrayBuffer>): string {
  let s = '';
  for (let i = 0; i < bin.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(new Uint8Array(bin.buffer, bin.byteOffset + i, Math.min(0x8000, bin.length - i))));
  }
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKeys(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const enc = new TextEncoder().encode(passphrase);
  const baseBin = new Uint8Array(new ArrayBuffer(enc.length));
  baseBin.set(enc);

  const base = await crypto.subtle.importKey('raw', baseBin, 'PBKDF2', false, ['deriveBits']);
  const bitsBuf = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 512);
  const bits = new Uint8Array(bitsBuf);

  const keyBin = new Uint8Array(new ArrayBuffer(32));
  keyBin.set(bits.subarray(0, 32));

  const key = await crypto.subtle.importKey('raw', keyBin, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  const hmacBin = new Uint8Array(new ArrayBuffer(32));
  hmacBin.set(bits.subarray(32, 64));
  const hmacKey = await crypto.subtle.importKey('raw', hmacBin, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

  return { key, hmacKey };
}

export async function buildInventorySnapshot(
  storage: StorageAdapter,
  instanceId: string,
  now = new Date()
): Promise<PlainInventorySnapshot> {
  const items = await storage.list('inventoryItem', instanceId);
  const txs = await storage.list('inventoryTx', instanceId);

  const locId = 'principal';

  // Restaurant name for location (default to 'Local')
  const restaurants = await storage.list('restaurant', instanceId);
  const aliveRestaurants = restaurants.filter((r) => !(r as Record<string, unknown>).deleted_at);
  const locName = aliveRestaurants.length > 0 ? (aliveRestaurants[0] as Record<string, unknown>).name as string : 'Local';

  const outItems: PlainInventorySnapshot['items'] = [];
  for (const it of items) {
    const rec = it as Record<string, unknown>;
    if (rec.deleted_at) continue;

    const customFields: Record<string, string> = {};
    if (rec.sku != null && rec.sku !== '') customFields.sku = String(rec.sku);
    if (rec.gosIngredientId != null && rec.gosIngredientId !== '') customFields.gosIngredientId = String(rec.gosIngredientId);
    if (rec.gramsPerUnit != null && rec.gramsPerUnit !== '') customFields.gramsPerUnit = String(rec.gramsPerUnit);

    outItems.push({
      id: rec.id as string,
      sku: rec.sku != null ? String(rec.sku) : null,
      name: rec.name as string,
      quantity: Number(rec.stock ?? 0),
      unit: rec.unit != null ? String(rec.unit) : null,
      minStock: Number(rec.minStock ?? 0),
      cost: Number(rec.unitCost ?? rec.costPerUnit ?? 0),
      price: 0,
      locationId: locId,
      customFields
    });
  }

  const outMovements: PlainInventorySnapshot['movements'] = [];
  for (const t of txs) {
    const rec = t as Record<string, unknown>;
    if (rec.deleted_at) continue;

    const kind = String(rec.kind);
    // mapped to adjust if unknown
    const validKind = ['purchase', 'use', 'waste', 'adjust'].includes(kind) ? kind as 'purchase' | 'use' | 'waste' | 'adjust' : 'adjust';

    outMovements.push({
      id: rec.id as string,
      itemId: rec.inventoryId as string,
      kind: validKind,
      qty: signedQtyOf(rec),
      at: rec.created_at as string
    });
  }

  return {
    format: EXPORT_FORMAT,
    source: {
      appId: domainConfig.appId,
      instanceId,
      schemaVersion: 1,
      exportedAt: now.toISOString(),
    },
    currency: 'COP',
    locations: [{ id: locId, name: locName, type: 'bodega' }],
    items: outItems,
    movements: outMovements
  };
}

export async function sealInventorySnapshot(
  snapshot: PlainInventorySnapshot,
  passphrase: string
): Promise<EncryptedInventorySnapshot> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));

  const saltB64 = toB64(salt);
  const ivB64 = toB64(iv);

  const header = {
    format: ENC_EXPORT_FORMAT,
    kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations: KDF_ITERATIONS },
    salt: saltB64
  };

  const { key, hmacKey } = await deriveKeys(passphrase, salt, KDF_ITERATIONS);

  const checkPayload = new TextEncoder().encode(`${ENC_EXPORT_FORMAT}|${saltB64}|${ivB64}`);
  const checkSig = await crypto.subtle.sign('HMAC', hmacKey, checkPayload);
  const check = toB64(new Uint8Array(checkSig));

  const enc = new TextEncoder().encode(JSON.stringify(snapshot));
  const plainBin = new Uint8Array(new ArrayBuffer(enc.length));
  plainBin.set(enc);

  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBin);
  const ctBin = new Uint8Array(new ArrayBuffer(ctBuf.byteLength));
  ctBin.set(new Uint8Array(ctBuf));

  return { ...header, iv: ivB64, check, ciphertext: toB64(ctBin) };
}

function validatePlainSnapshot(data: unknown): PlainInventorySnapshot {
  const b = data as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new InventoryExportError('formato');

  if (b.format !== EXPORT_FORMAT) throw new InventoryExportError('formato');

  const src = b.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== 'object' || typeof src.appId !== 'string') throw new InventoryExportError('formato');
  if (typeof src.instanceId !== 'string' || typeof src.schemaVersion !== 'number' || !Number.isFinite(src.schemaVersion)) throw new InventoryExportError('formato');
  if (typeof src.exportedAt !== 'string' || Number.isNaN(Date.parse(src.exportedAt))) throw new InventoryExportError('formato');

  if (b.currency !== 'COP') throw new InventoryExportError('formato');

  if (!Array.isArray(b.locations)) throw new InventoryExportError('formato');
  const locations = b.locations.map((loc: unknown) => {
    const l = loc as Record<string, unknown>;
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || typeof l.name !== 'string') throw new InventoryExportError('formato');
    if (l.type !== 'bodega' && l.type !== 'sucursal') throw new InventoryExportError('formato');
    return { id: l.id, name: l.name, type: l.type as 'bodega' | 'sucursal' };
  });

  if (!Array.isArray(b.items)) throw new InventoryExportError('formato');
  const items = b.items.map((it: unknown) => {
    const i = it as Record<string, unknown>;
    if (!i || typeof i !== 'object') throw new InventoryExportError('formato');
    if (typeof i.id !== 'string' || typeof i.name !== 'string') throw new InventoryExportError('formato');
    if (typeof i.quantity !== 'number' || !Number.isFinite(i.quantity)) throw new InventoryExportError('formato');
    if (typeof i.minStock !== 'number' || !Number.isFinite(i.minStock)) throw new InventoryExportError('formato');
    if (typeof i.cost !== 'number' || !Number.isFinite(i.cost)) throw new InventoryExportError('formato');
    if (typeof i.price !== 'number' || !Number.isFinite(i.price)) throw new InventoryExportError('formato');

    let customFields = i.customFields as Record<string, string> | undefined;
    if (customFields) {
      if (typeof customFields !== 'object' || Array.isArray(customFields)) throw new InventoryExportError('formato');
      for (const val of Object.values(customFields)) {
        if (typeof val !== 'string') throw new InventoryExportError('formato');
      }
    } else {
      customFields = {};
    }

    return {
      id: i.id,
      sku: typeof i.sku === 'string' ? i.sku : (i.sku === null ? null : undefined),
      name: i.name,
      quantity: i.quantity,
      unit: typeof i.unit === 'string' ? i.unit : (i.unit === null ? null : undefined),
      minStock: i.minStock,
      cost: i.cost,
      price: i.price,
      locationId: typeof i.locationId === 'string' ? i.locationId : (i.locationId === null ? null : undefined),
      customFields
    };
  });

  if (!Array.isArray(b.movements)) throw new InventoryExportError('formato');
  const movements = b.movements.map((mov: unknown) => {
    const m = mov as Record<string, unknown>;
    if (!m || typeof m !== 'object') throw new InventoryExportError('formato');
    if (typeof m.id !== 'string' || typeof m.itemId !== 'string') throw new InventoryExportError('formato');
    if (typeof m.qty !== 'number' || !Number.isFinite(m.qty)) throw new InventoryExportError('formato');
    if (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at))) throw new InventoryExportError('formato');

    const validKinds = ['purchase', 'use', 'waste', 'adjust'] as const;
    const kind = typeof m.kind === 'string' && (validKinds as readonly string[]).includes(m.kind) ? m.kind as typeof validKinds[number] : 'adjust';

    return {
      id: m.id,
      itemId: m.itemId,
      kind,
      qty: m.qty,
      at: m.at
    };
  });

  return {
    format: EXPORT_FORMAT,
    source: {
      appId: src.appId,
      instanceId: src.instanceId,
      schemaVersion: src.schemaVersion,
      exportedAt: src.exportedAt
    },
    currency: 'COP',
    locations,
    items,
    movements
  };
}

export async function openInventorySnapshot(
  input: string | unknown,
  passphrase?: string
): Promise<PlainInventorySnapshot> {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new InventoryExportError('formato');
    }
  }

  const base = data as Record<string, unknown> | null;
  if (!base || typeof base !== 'object') throw new InventoryExportError('formato');

  if (base.format === EXPORT_FORMAT) {
    return validatePlainSnapshot(data);
  }

  if (base.format !== ENC_EXPORT_FORMAT) {
    throw new InventoryExportError('formato');
  }

  if (!passphrase) {
    throw new InventoryExportError('clave');
  }

  const e = base as Partial<EncryptedInventorySnapshot>;
  for (const field of ['salt', 'iv', 'ciphertext'] as const) {
    if (typeof e[field] !== 'string' || !e[field]) throw new InventoryExportError('formato');
  }

  if (!e.kdf || e.kdf.name !== 'PBKDF2' || e.kdf.hash !== 'SHA-256' || e.kdf.iterations !== KDF_ITERATIONS) {
    throw new InventoryExportError('alterado');
  }

  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(e.salt as string);
    iv = fromB64(e.iv as string);
    ct = fromB64(e.ciphertext as string);
  } catch {
    throw new InventoryExportError('alterado');
  }

  const { key, hmacKey } = await deriveKeys(passphrase, salt, e.kdf.iterations);

  if (typeof e.check === 'string' && e.check) {
    const checkPayload = new TextEncoder().encode(`${ENC_EXPORT_FORMAT}|${e.salt}|${e.iv}`);
    const checkSig = await crypto.subtle.sign('HMAC', hmacKey, checkPayload);
    const expectedCheck = toB64(new Uint8Array(checkSig));

    // Constant-time comparison is ideal, but strict equality of base64 works for our domain
    if (e.check !== expectedCheck) {
      throw new InventoryExportError('clave');
    }
  }

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    // If check was present and matched, decryption failure means the file was tampered with
    // If check was absent (older envelopes), we can't tell, so we fall back to 'clave' (legacy behavior)
    throw new InventoryExportError(e.check ? 'alterado' : 'clave');
  }

  let decryptedData: unknown;
  try {
    decryptedData = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new InventoryExportError('alterado');
  }

  return validatePlainSnapshot(decryptedData);
}
