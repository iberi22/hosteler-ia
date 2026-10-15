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
  ciphertext: string;
}

export function inventoryExportFilename(_instanceId: string, now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `fize-inventario-${yyyy}-${mm}-${dd}.swal-inventory.json`;
}

function toB64(bin: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...bin));
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
  const bitsBuf = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  const bits = new Uint8Array(bitsBuf);

  const keyBin = new Uint8Array(new ArrayBuffer(32));
  keyBin.set(bits);

  const key = await crypto.subtle.importKey('raw', keyBin, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return key;
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

  const header = {
    format: ENC_EXPORT_FORMAT,
    kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations: KDF_ITERATIONS },
    salt: toB64(salt)
  };

  const key = await deriveKeys(passphrase, salt, KDF_ITERATIONS);

  const enc = new TextEncoder().encode(JSON.stringify(snapshot));
  const plainBin = new Uint8Array(new ArrayBuffer(enc.length));
  plainBin.set(enc);

  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBin);
  const ctBin = new Uint8Array(new ArrayBuffer(ctBuf.byteLength));
  ctBin.set(new Uint8Array(ctBuf));

  return { ...header, iv: toB64(iv), ciphertext: toB64(ctBin) };
}

function validatePlainSnapshot(data: unknown): PlainInventorySnapshot {
  const b = data as Partial<PlainInventorySnapshot> | null;
  if (!b || typeof b !== 'object' || b.format !== EXPORT_FORMAT || !b.source || typeof b.source.appId !== 'string') {
    throw new InventoryExportError('formato');
  }
  if (!Array.isArray(b.locations) || !Array.isArray(b.items) || !Array.isArray(b.movements)) {
    throw new InventoryExportError('formato');
  }
  return b as PlainInventorySnapshot;
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

  const key = await deriveKeys(passphrase, salt, e.kdf.iterations);

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    // Failing crypto.subtle.decrypt is assumed to be wrong key ('clave') since WebCrypto doesn't distinguish MAC failure from wrong key
    throw new InventoryExportError('clave');
  }

  let decryptedData: unknown;
  try {
    decryptedData = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new InventoryExportError('alterado');
  }

  return validatePlainSnapshot(decryptedData);
}
