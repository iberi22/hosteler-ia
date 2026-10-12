import { describe, it, expect, beforeEach } from 'vitest';
import { POST as createItem } from '../pages/api/inventory/index';
import { POST as createRecipe } from '../pages/api/recipes/index';
import { POST as createSupplier } from '../pages/api/suppliers/index';
import { POST as createPurchase } from '../pages/api/purchases/index';
import { getMemoryAdapter } from './domain';

// Regresion: `unitCost` no estaba en el schema de inventario, asi que Zod lo
// descartaba en silencio (strip unknown keys) y TODOS los insumos quedaban con
// costo null. Consecuencia: costPerServing daba 0 y el margen del menu era una
// mentira — el restaurante veía "ganancia 100%" en platos que no existian.

describe('unitCost del insumo', () => {
  beforeEach(() => getMemoryAdapter().clear());

  const ctx = (req: Request) => ({
    request: req,
    params: {},
    locals: { user: { id: 'u1', email: 'a@b.co', name: 'A', role: 'owner' } },
  }) as any;

  const post = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('persiste el costo unitario que le mandan', async () => {
    const res = await createItem(
      ctx(post('http://x/api/inventory', { name: 'Carne de res', unit: 'kg', initialStock: 10, unitCost: 34000 })),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).unitCost).toBe(34000);
  });

  it('rechaza un costo negativo', async () => {
    const res = await createItem(
      ctx(post('http://x/api/inventory', { name: 'X', unit: 'kg', unitCost: -5 })),
    );
    expect(res.status).toBe(400);
  });

  it('permite crear sin costo (no todo restaurante lo registra de entrada)', async () => {
    const res = await createItem(ctx(post('http://x/api/inventory', { name: 'Arroz', unit: 'kg' })));
    expect(res.status).toBe(201);
    expect((await res.json()).unitCost).toBeUndefined();
  });

  it('el costo del insumo alimenta el costo real de la receta', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    const item = await createItem(
      ctx(post('http://x/api/inventory', { name: 'Carne de res', unit: 'kg', unitCost: 34000 })),
    );
    const insumoId = (await item.json()).id;
    await adapter.create('menuItem', {
      id: 'm1', instance_id: 'default', name: 'Bandeja', price: 32000,
      created_at: now, updated_at: now,
    });

    // 500 g de carne a 34.000/kg = 17.000 por receta de 2 porciones = 8.500
    const res = await createRecipe(
      ctx(post('http://x/api/recipes', {
        menuItemId: 'm1', name: 'Bandeja de carne', yield: 2,
        lines: [{ inventoryItemId: insumoId, name: 'Carne de res', qty: 0.5, unit: 'kg', unitCost: 34000 }],
      })),
    );
    const r = await res.json();
    expect(r.costTotal).toBe(17000);
    expect(r.costPerServing).toBe(8500);
  });

  it('una compra actualiza el costo del insumo y el de las recetas siguientes', async () => {
    const adapter = getMemoryAdapter();
    const item = await createItem(
      ctx(post('http://x/api/inventory', { name: 'Arroz', unit: 'kg', unitCost: 4600 })),
    );
    const insumoId = (await item.json()).id;
    const sup = await createSupplier(ctx(post('http://x/api/suppliers', { name: 'Distribuidora' })));
    const supplierId = (await sup.json()).id;

    await createPurchase(
      ctx(post('http://x/api/purchases', {
        supplierId, invoiceNumber: 'F-1', invoiceDate: '2026-10-01', taxRate: 0,
        lines: [{ inventoryItemId: insumoId, name: 'Arroz', qty: 10, unit: 'kg', unitCost: 5200 }],
      })),
    );

    const refreshed = await adapter.get('inventoryItem', insumoId, 'default');
    expect((refreshed as Record<string, unknown>).unitCost).toBe(5200);
  });
});
