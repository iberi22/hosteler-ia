import { describe, it, expect, beforeEach } from 'vitest';
import { POST as createRecipe, GET as listRecipes } from '../pages/api/recipes/index';
import { POST as createSupplier } from '../pages/api/suppliers/index';
import { POST as createPurchase } from '../pages/api/purchases/index';
import { getMemoryAdapter } from './domain';

// El cliente pidio explicitamente que las recetas sean privadas al 100%. Este
// archivo fija esa regla en codigo: las recetas nunca se exponen, solo el plato.

describe('Recipes API', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'u1', email: 'chef@fize.app', name: 'Chef', role: 'owner' };
  const ctx = (req: Request) => ({ request: req, params: {}, locals: { user: mockUser } }) as any;
  const post = (body: unknown) =>
    new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function seedMenuItem() {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('menuItem', {
      id: 'm1', instance_id: 'default', name: 'Bandeja paisa', price: 32000,
      categoryId: 'c1', created_at: now, updated_at: now,
    });
    return 'm1';
  }

  const recipe = (menuItemId: string, over: Record<string, unknown> = {}) => ({
    menuItemId,
    name: 'Bandeja paisa clasica',
    yield: 4,
    prepTimeMin: 20,
    cookTimeMin: 30,
    cookTempC: 200,
    steps: ['Sofirir', 'Servir'],
    lines: [
      { inventoryItemId: 'i1', name: 'Carne', qty: 500, unit: 'g', unitCost: 20 },
      { inventoryItemId: 'i2', name: 'Arroz', qty: 300, unit: 'g', unitCost: 6 },
    ],
    ...over,
  });

  it('crea la receta con costo, tiempo y temperatura derivados', async () => {
    const menuItemId = await seedMenuItem();
    const res = await createRecipe(ctx(post(recipe(menuItemId))));
    expect(res.status).toBe(201);
    const r = await res.json();
    // 500*20 + 300*6 = 11800, /4 raciones = 2950
    expect(r.costTotal).toBe(11800);
    expect(r.costPerServing).toBe(2950);
    expect(r.totalTimeMin).toBe(50);
    expect(r.cookTempC).toBe(200);
  });

  it('ignora cualquier costo que el cliente intente mandar', async () => {
    const menuItemId = await seedMenuItem();
    const res = await createRecipe(
      ctx(post(recipe(menuItemId, { costPerServing: 1, costTotal: 1 }))),
    );
    const r = await res.json();
    expect(r.costPerServing).toBe(2950);
    expect(r.costTotal).toBe(11800);
  });

  it('la receta es privada por defecto', async () => {
    const menuItemId = await seedMenuItem();
    const res = await createRecipe(ctx(post(recipe(menuItemId))));
    expect((await res.json()).visibility).toBe('privada');
  });

  it('nunca acepta visibility publica', async () => {
    const menuItemId = await seedMenuItem();
    const res = await createRecipe(ctx(post(recipe(menuItemId, { visibility: 'publica' }))));
    expect(res.status).toBe(422);
  });

  it('rechaza una receta sin ingredientes', async () => {
    const menuItemId = await seedMenuItem();
    const res = await createRecipe(ctx(post(recipe(menuItemId, { lines: [] }))));
    expect(res.status).toBe(422);
  });

  it('rechaza una receta de un plato inexistente', async () => {
    const res = await createRecipe(ctx(post(recipe('no-existe'))));
    expect(res.status).toBe(404);
  });

  it('rechaza cantidad cero o negativa', async () => {
    const menuItemId = await seedMenuItem();
    const bad = recipe(menuItemId, {
      lines: [{ inventoryItemId: 'i1', name: 'Carne', qty: 0, unit: 'g', unitCost: 20 }],
    });
    expect((await createRecipe(ctx(post(bad)))).status).toBe(422);
  });

  it('rechaza una temperatura fuera de rango de cocina', async () => {
    const menuItemId = await seedMenuItem();
    const alta = await createRecipe(ctx(post(recipe(menuItemId, { cookTempC: 900 }))));
    const baja = await createRecipe(ctx(post(recipe(menuItemId, { cookTempC: 5 }))));
    expect(alta.status).toBe(422);
    expect(baja.status).toBe(422);
  });

  it('GET incluye margen y marca los platos que se venden bajo costo', async () => {
    const menuItemId = await seedMenuItem();
    await createRecipe(ctx(post(recipe(menuItemId))));
    const res = await listRecipes(ctx(new Request('http://localhost/api/recipes')));
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    // precio 32000, costo 2950 -> 90.78% margen, no es perdida
    expect(rows[0].margin).toBeCloseTo(0.9078, 3);
    expect(rows[0].lossMaking).toBe(false);
  });
});

describe('Suppliers and Purchases', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'u1', email: 'admin@fize.app', name: 'Admin', role: 'owner' };
  const ctx = (req: Request) => ({ request: req, params: {}, locals: { user: mockUser } }) as any;
  const post = (body: unknown) =>
    new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function seedSupplier() {
    const res = await createSupplier(ctx(post({ name: 'Carniceria del Sur', creditDays: 30 })));
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  it('crea un proveedor', async () => {
    const res = await createSupplier(ctx(post({ name: 'Distribuidora Norte' })));
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s.name).toBe('Distribuidora Norte');
    expect(s.creditDays).toBe(0);
    expect(s.isActive).toBe(true);
  });

  it('rechaza un proveedor sin nombre', async () => {
    expect((await createSupplier(ctx(post({ name: '' })))).status).toBe(422);
  });

  it('rechaza un email invalido', async () => {
    expect((await createSupplier(ctx(post({ name: 'X', email: 'no-es-mail' })))).status).toBe(422);
  });

  it('registra una compra y sube el stock del insumo', async () => {
    const supplierId = await seedSupplier();
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('inventoryItem', {
      id: 'i1', instance_id: 'default', name: 'Carne de res', stock: 10, unit: 'kg',
      unitCost: 20000, created_at: now, updated_at: now,
    });

    const res = await createPurchase(
      ctx(post({
        supplierId,
        invoiceNumber: 'FV-001',
        invoiceDate: '2026-10-01',
        taxRate: 0.19,
        lines: [{ inventoryItemId: 'i1', name: 'Carne de res', qty: 5, unit: 'kg', unitCost: 21000 }],
      })),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.purchase.total).toBe(124950);
    expect(body.stockApplied[0].newStock).toBe(15);

    const item = await adapter.get('inventoryItem', 'i1', 'default');
    expect((item as Record<string, unknown>).stock).toBe(15);
    // El costo unitario se actualiza: es el que alimenta el costo de receta.
    expect((item as Record<string, unknown>).unitCost).toBe(21000);
  });

  it('deja movimiento de inventario por cada linea', async () => {
    const supplierId = await seedSupplier();
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('inventoryItem', {
      id: 'i1', instance_id: 'default', name: 'Arroz', stock: 0, unit: 'kg',
      created_at: now, updated_at: now,
    });
    await createPurchase(
      ctx(post({
        supplierId, invoiceNumber: 'F-2', invoiceDate: '2026-10-01', taxRate: 0,
        lines: [{ inventoryItemId: 'i1', name: 'Arroz', qty: 25, unit: 'kg', unitCost: 5000 }],
      })),
    );
    const txs = await adapter.list('inventoryTx', 'default');
    expect(txs).toHaveLength(1);
    expect((txs[0] as Record<string, unknown>).kind).toBe('purchase');
  });

  it('rechaza una compra sin proveedor existente', async () => {
    const res = await createPurchase(
      ctx(post({
        supplierId: 'no-existe', invoiceNumber: 'F', invoiceDate: '2026-10-01',
        lines: [{ inventoryItemId: 'i1', name: 'x', qty: 1, unit: 'kg', unitCost: 1 }],
      })),
    );
    expect(res.status).toBe(404);
  });

  it('rechaza una compra sin lineas', async () => {
    const supplierId = await seedSupplier();
    const res = await createPurchase(
      ctx(post({ supplierId, invoiceNumber: 'F', invoiceDate: '2026-10-01', lines: [] })),
    );
    expect(res.status).toBe(422);
  });
});
