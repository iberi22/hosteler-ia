import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as createPurchase, GET as listPurchases } from '../pages/api/purchases/index';
import { POST as createSupplier } from '../pages/api/suppliers/index';
import { POST as createItem } from '../pages/api/inventory/index';
import { getMemoryAdapter } from './domain';

// Tercera aparicion del mismo fallo (tras pagos y recetas): el POST respondia
// 200 con el stock aplicado y GET /api/purchases devolvia []. D1 no tenia ni una
// fila de `purchase`. Dos causas:
//   1) el registro llevaba `createdAt` y la columna es `created_at` (NOT NULL);
//   2) el resultado de adapter.create no se comprobaba, asi que un INSERT
//      fallido pasaba por success mientras el stock si avanzaba.

describe('persistencia de compras', () => {
  beforeEach(() => getMemoryAdapter().clear());

  const ctx = (req: Request) => ({
    request: req,
    params: {},
    locals: { user: { id: 'u1', email: 'chef@fize.app', name: 'C', role: 'owner' } },
  }) as any;

  const send = (path: string, body: unknown, method = 'POST') =>
    new Request(`http://x${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function setup() {
    const sup = await (await createSupplier(ctx(send('/api/suppliers', { name: 'Distribuidora' })))).json();
    const item = await (
      await createItem(ctx(send('/api/inventory', { name: 'Papa', unit: 'kg', unitCost: 4200 })))
    ).json();
    return { supplierId: sup.id, inventoryItemId: item.id };
  }

  const purchase = (ids: { supplierId: string; inventoryItemId: string }, over = {}) => ({
    supplierId: ids.supplierId,
    invoiceNumber: 'FV-2026-0099',
    invoiceDate: '2026-10-01',
    taxRate: 0.19,
    lines: [{ inventoryItemId: ids.inventoryItemId, name: 'Papa', qty: 10, unit: 'kg', unitCost: 4500 }],
    ...over,
  });

  it('la compra queda registrada y se puede listar despues', async () => {
    const ids = await setup();
    const res = await createPurchase(ctx(send('/api/purchases', purchase(ids))));
    expect(res.status).toBe(201);

    const rows = await (await listPurchases(ctx(new Request('http://x/api/purchases')))).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNumber).toBe('FV-2026-0099');
  });

  it('el total lleva IVA calculado (subtotal 45.000 + 19% = 53.550)', async () => {
    const ids = await setup();
    const res = await createPurchase(ctx(send('/api/purchases', purchase(ids))));
    const body = await res.json();
    expect(body.purchase.total).toBe(53550);
  });

  it('suma el stock y actualiza el costo del insumo', async () => {
    const ids = await setup();
    await createPurchase(ctx(send('/api/purchases', purchase(ids))));
    const item = await getMemoryAdapter().get('inventoryItem', ids.inventoryItemId, 'default');
    expect((item as Record<string, unknown>).stock).toBe(10);
    expect((item as Record<string, unknown>).unitCost).toBe(4500);
  });

  it('devuelve 500 si la compra no se pudo guardar (no stock sin factura)', async () => {
    const ids = await setup();
    const adapter = getMemoryAdapter();
    // Simula el INSERT fallido: el storageAdapter.create devuelve null.
    const spy = vi.spyOn(adapter, 'create').mockResolvedValueOnce(null as never);
    const res = await createPurchase(ctx(send('/api/purchases', purchase(ids))));
    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  it('rechaza una compra sin lineas (422 de Zod)', async () => {
    const ids = await setup();
    const res = await createPurchase(ctx(send('/api/purchases', purchase(ids, { lines: [] }))));
    expect(res.status).toBe(422);
  });

  it('rechaza un proveedor inexistente (404)', async () => {
    const ids = await setup();
    const res = await createPurchase(ctx(send('/api/purchases', purchase(ids, { supplierId: 'no-existe' }))));
    expect(res.status).toBe(404);
  });
});
