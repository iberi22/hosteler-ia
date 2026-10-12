// inventoryLedger.ts — libro inmutable de movimientos; stock = SUM(transactions)
// kinds: purchase (+) / use (-) / waste (-) / adjust (+/- con qty signado)

import type { StorageAdapter, DomainRecord } from './domain';

export const TX_KINDS = ['purchase', 'use', 'waste', 'adjust'] as const;
export type TxKind = (typeof TX_KINDS)[number];

export function isTxKind(value: unknown): value is TxKind {
  return typeof value === 'string' && (TX_KINDS as readonly string[]).includes(value);
}

export function txSign(kind: TxKind, qty: number): number {
  if (kind === 'use' || kind === 'waste') return -Math.abs(qty);
  if (kind === 'purchase') return Math.abs(qty);
  return qty; // adjust: respeta el signo
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AppendTxOptions {
  /**
   * Id fijo del movimiento (p. ej. una linea de compra). Si ya existe, no se vuelve a sumar: reintentar la
   * misma peticion no duplica el stock.
   */
  id?: string;
  /** Documento que origina el movimiento (id de la compra, del pedido...). */
  reference?: string;
  /** Linea del documento (compras: indice de la linea). */
  line?: number;
  unitCost?: number;
}

/**
 * Cantidad con signo de un movimiento. Las compras anteriores a que pasaran por el libro se guardaron sin
 * `signedQty`; se derivan de `kind` y `qty` para que el siguiente movimiento no borre ese stock.
 */
export function signedQtyOf(tx: Record<string, unknown>): number {
  if (tx.signedQty !== undefined && tx.signedQty !== null && Number.isFinite(Number(tx.signedQty))) {
    return Number(tx.signedQty);
  }
  const qty = Number(tx.qty);
  return isTxKind(tx.kind) && Number.isFinite(qty) ? txSign(tx.kind, qty) : 0;
}

async function itemTxs(adapter: StorageAdapter, instanceId: string, inventoryId: string): Promise<DomainRecord[]> {
  const all = await adapter.list('inventoryTx', instanceId);
  return all.filter((t) => (t as Record<string, unknown>).inventoryId === inventoryId);
}

/**
 * Un insumo con stock pero sin ningun movimiento (cargado antes del libro o por una importacion) recibe un
 * movimiento de saldo inicial: si no, el primer movimiento recalcula desde cero y ese stock desaparece.
 */
async function ensureOpeningBalance(adapter: StorageAdapter, instanceId: string, inventoryId: string): Promise<void> {
  const item = (await adapter.get('inventoryItem', inventoryId, instanceId)) as Record<string, unknown> | null;
  const stock = Number(item?.stock ?? 0);
  if (!item || !Number.isFinite(stock) || stock === 0) return;
  if ((await itemTxs(adapter, instanceId, inventoryId)).length > 0) return;
  const now = new Date().toISOString();
  await adapter.create('inventoryTx', {
    id: `itx-open-${inventoryId}`,
    instance_id: instanceId,
    inventoryId,
    kind: 'adjust',
    qty: stock,
    signedQty: stock,
    note: 'saldo inicial (stock anterior al libro de movimientos)',
    created_at: now,
    updated_at: now,
  } as DomainRecord);
}

/** Recalcula el stock del insumo desde el libro y lo guarda (denormalizado para listar rapido). */
export async function syncStock(adapter: StorageAdapter, instanceId: string, inventoryId: string): Promise<number> {
  const stock = await stockOf(adapter, instanceId, inventoryId);
  await adapter.update('inventoryItem', inventoryId, { stock }, instanceId);
  return stock;
}

export async function appendTx(
  adapter: StorageAdapter,
  instanceId: string,
  inventoryId: string,
  kind: TxKind,
  qty: number,
  note?: string,
  opts: AppendTxOptions = {},
): Promise<DomainRecord> {
  if (opts.id) {
    const existing = await adapter.get('inventoryTx', opts.id, instanceId);
    if (existing) {
      await syncStock(adapter, instanceId, inventoryId);
      return existing;
    }
  }
  await ensureOpeningBalance(adapter, instanceId, inventoryId);

  const now = new Date().toISOString();
  const tx = (await adapter.create('inventoryTx', {
    id: opts.id ?? genId(),
    instance_id: instanceId,
    inventoryId,
    kind,
    qty,
    signedQty: txSign(kind, qty),
    note: note ?? null,
    ...(opts.reference !== undefined ? { reference: opts.reference } : {}),
    ...(opts.line !== undefined ? { line: opts.line } : {}),
    ...(opts.unitCost !== undefined ? { unitCost: opts.unitCost } : {}),
    created_at: now,
    updated_at: now,
  } as DomainRecord)) as DomainRecord;

  await syncStock(adapter, instanceId, inventoryId);
  return tx;
}

export async function stockOf(adapter: StorageAdapter, instanceId: string, inventoryId: string): Promise<number> {
  // SUM(signedQty) — stock derivado, nunca editado a mano
  return (await itemTxs(adapter, instanceId, inventoryId)).reduce(
    (sum, t) => sum + signedQtyOf(t as Record<string, unknown>),
    0,
  );
}

export async function txHistory(adapter: StorageAdapter, instanceId: string, inventoryId: string): Promise<DomainRecord[]> {
  const all = await adapter.list('inventoryTx', instanceId);
  return all
    .filter((t) => (t as Record<string, unknown>).inventoryId === inventoryId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
