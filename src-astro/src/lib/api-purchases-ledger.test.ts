import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIContext, APIRoute } from 'astro';
import { POST as createPurchase } from '../pages/api/purchases/index';
import { POST as createSupplier } from '../pages/api/suppliers/index';
import { POST as createItem } from '../pages/api/inventory/index';
import { POST as moveStock } from '../pages/api/inventory/[id]/transactions';
import { POST as createCategory } from '../pages/api/categories/index';
import { POST as createMenuItem } from '../pages/api/menu-items/index';
import { POST as createOrder } from '../pages/api/orders/index';
import { POST as transitionOrder } from '../pages/api/orders/[id]/transition';
import { getMemoryAdapter } from './domain';
import { stockOf, txHistory } from './inventoryLedger';

// Las compras entraban el stock por fuera del libro de inventario (sin `signedQty`): la siguiente venta o
// ajuste recalculaba stock = SUM(movimientos) y borraba lo comprado (ENLACE-ENTRE-APPS L0). Ahora la compra
// usa el mismo `appendTx` que ventas y ajustes, y es idempotente por linea.

const adapter = getMemoryAdapter();
const owner = { id: 'u1', email: 'chef@fize.app', name: 'Chef', role: 'owner' };

async function call(handler: APIRoute, path: string, payload?: unknown, params: Record<string, string> = {}) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const res = await handler({ request: req, params, locals: { user: owner } } as unknown as APIContext);
  if (!res) throw new Error('sin respuesta');
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function stockOfItem(id: string): Promise<number> {
  return Number(((await adapter.get('inventoryItem', id, 'default')) as Record<string, unknown>).stock);
}

async function setup() {
  const sup = await call(createSupplier, '/api/suppliers', { name: 'Distribuidora' });
  const papa = await call(createItem, '/api/inventory', { name: 'Papa', unit: 'kg', unitCost: 4200 });
  const now = new Date().toISOString();
  await adapter.create('table', { id: 't1', instance_id: 'default', number: 1, capacity: 2, qrCode: 'qr-1', created_at: now, updated_at: now });
  const cat = await call(createCategory, '/api/categories', { name: 'Almuerzos' });
  const dish = await call(createMenuItem, '/api/menu-items', {
    name: 'Papas fritas',
    price: 8000,
    categoryId: cat.body.id,
    recipe: [{ inventoryId: papa.body.id, qty: 0.5 }],
  });
  expect(dish.status).toBe(201);
  return { supplierId: String(sup.body.id), papaId: String(papa.body.id), dishId: String(dish.body.id) };
}

const invoice = (supplierId: string, papaId: string, over: Record<string, unknown> = {}) => ({
  supplierId,
  invoiceNumber: 'FV-2026-0100',
  invoiceDate: '2026-10-02',
  taxRate: 0.19,
  lines: [{ inventoryItemId: papaId, name: 'Papa', qty: 10, unit: 'kg', unitCost: 4500 }],
  ...over,
});

async function sell(dishId: string, qty: number) {
  const order = await call(createOrder, '/api/orders', { tableId: 't1', items: [{ menuItemId: dishId, qty }] });
  expect(order.status).toBe(201);
  const id = String(order.body.id);
  for (const to of ['preparing', 'ready', 'served']) {
    expect((await call(transitionOrder, `/api/orders/${id}/transition`, { to }, { id })).status).toBe(200);
  }
}

describe('compras por el libro de inventario', () => {
  beforeEach(() => adapter.clear());

  it('compra, venta y ajuste: lo comprado no se pierde', async () => {
    const { supplierId, papaId, dishId } = await setup();
    const res = await call(createPurchase, '/api/purchases', invoice(supplierId, papaId));
    expect(res.status).toBe(201);
    expect(await stockOfItem(papaId)).toBe(10);

    // Venta: 4 porciones x 0,5 kg = 2 kg.
    await sell(dishId, 4);
    expect(await stockOfItem(papaId)).toBe(8);
    expect(await stockOf(adapter, 'default', papaId)).toBe(8);

    // Ajuste (conteo): +1 kg encontrado.
    const adj = await call(moveStock, `/api/inventory/${papaId}/transactions`, { kind: 'adjust', qty: 1, note: 'conteo' }, { id: papaId });
    expect(adj.status).toBe(201);
    expect(await stockOfItem(papaId)).toBe(9);

    const kinds = (await txHistory(adapter, 'default', papaId)).map((t) => (t as Record<string, unknown>).kind);
    expect(kinds).toEqual(['purchase', 'use', 'adjust']);
    const purchaseTx = (await txHistory(adapter, 'default', papaId))[0] as Record<string, unknown>;
    expect(purchaseTx).toMatchObject({ signedQty: 10, reference: (res.body.purchase as Record<string, unknown>).id, line: 0, unitCost: 4500 });
  });

  it('la misma factura enviada dos veces no suma dos veces', async () => {
    const { supplierId, papaId } = await setup();
    const first = await call(createPurchase, '/api/purchases', invoice(supplierId, papaId));
    expect(first.status).toBe(201);
    // Reintento (doble clic, red que se cae): mismo proveedor, numero (con otro formato) y fecha.
    const again = await call(createPurchase, '/api/purchases', invoice(supplierId, papaId, { invoiceNumber: ' fv-2026-0100 ' }));
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect((again.body.purchase as Record<string, unknown>).id).toBe((first.body.purchase as Record<string, unknown>).id);
    expect(await stockOfItem(papaId)).toBe(10);
    expect(await adapter.list('purchase', 'default')).toHaveLength(1);
    expect(await adapter.list('inventoryTx', 'default')).toHaveLength(1);

    // Misma factura con otras cantidades: conflicto, nada cambia.
    const changed = invoice(supplierId, papaId, {
      lines: [{ inventoryItemId: papaId, name: 'Papa', qty: 12, unit: 'kg', unitCost: 4500 }],
    });
    expect((await call(createPurchase, '/api/purchases', changed)).status).toBe(409);
    expect(await stockOfItem(papaId)).toBe(10);

    // Otra factura (otro numero) si suma.
    expect((await call(createPurchase, '/api/purchases', invoice(supplierId, papaId, { invoiceNumber: 'FV-2026-0101' }))).status).toBe(201);
    expect(await stockOfItem(papaId)).toBe(20);
  });

  it('si un intento se cortó a mitad, el reintento solo aplica las líneas que faltaban', async () => {
    const { supplierId, papaId } = await setup();
    const sal = await call(createItem, '/api/inventory', { name: 'Sal', unit: 'kg' });
    const salId = String(sal.body.id);
    const twoLines = invoice(supplierId, papaId, {
      lines: [
        { inventoryItemId: papaId, name: 'Papa', qty: 10, unit: 'kg', unitCost: 4500 },
        { inventoryItemId: salId, name: 'Sal', qty: 2, unit: 'kg', unitCost: 1000 },
      ],
    });
    // La compra y la primera linea se guardan; el movimiento de la segunda falla.
    const realCreate = adapter.create.bind(adapter);
    const spy = vi.spyOn(adapter, 'create').mockImplementation(async (entity, record) => {
      if (entity === 'inventoryTx' && (record as Record<string, unknown>).inventoryId === salId) throw new Error('caída');
      return realCreate(entity, record);
    });
    expect((await call(createPurchase, '/api/purchases', twoLines)).status).toBe(500);
    spy.mockRestore();
    expect(await stockOfItem(papaId)).toBe(10);
    expect(await stockOfItem(salId)).toBe(0);

    const retry = await call(createPurchase, '/api/purchases', twoLines);
    expect(retry.status).toBe(200);
    expect(await stockOfItem(papaId)).toBe(10);
    expect(await stockOfItem(salId)).toBe(2);
    expect(await adapter.list('inventoryTx', 'default')).toHaveLength(2);
  });

  it('compras viejas (movimiento sin signedQty) cuentan: la venta siguiente ya no borra ese stock', async () => {
    const { papaId, dishId } = await setup();
    const now = new Date().toISOString();
    // Como lo dejaba el codigo anterior: stock sumado a mano y movimiento sin signedQty.
    await adapter.update('inventoryItem', papaId, { stock: 10 }, 'default');
    await adapter.create('inventoryTx', {
      id: 'itx-viejo', instance_id: 'default', inventoryId: papaId, kind: 'purchase', qty: 10, unitCost: 4500,
      reference: 'pur-viejo', created_at: now, updated_at: now,
    });
    await sell(dishId, 2);
    expect(await stockOfItem(papaId)).toBe(9);
  });

  it('insumo con stock cargado sin movimientos: recibe saldo inicial y no se pierde', async () => {
    const { supplierId, papaId } = await setup();
    await adapter.update('inventoryItem', papaId, { stock: 7 }, 'default');
    expect((await call(createPurchase, '/api/purchases', invoice(supplierId, papaId))).status).toBe(201);
    expect(await stockOfItem(papaId)).toBe(17);
  });

  it('rechaza una línea con un insumo que no existe, sin guardar nada', async () => {
    const { supplierId, papaId } = await setup();
    const bad = invoice(supplierId, papaId, {
      lines: [
        { inventoryItemId: papaId, name: 'Papa', qty: 10, unit: 'kg', unitCost: 4500 },
        { inventoryItemId: 'no-existe', name: 'Fantasma', qty: 1, unit: 'kg', unitCost: 1 },
      ],
    });
    expect((await call(createPurchase, '/api/purchases', bad)).status).toBe(404);
    expect(await adapter.list('purchase', 'default')).toHaveLength(0);
    expect(await stockOfItem(papaId)).toBe(0);
  });
});
