import { describe, it, expect, beforeEach } from 'vitest';
import { POST as createRecipe, GET as listRecipes } from '../pages/api/recipes/index';
import { getMemoryAdapter } from './domain';

// Mismo fallo que el del registro de pagos, repetido en recetas: el POST
// respondia 201 y la receta NO existia. `createdAt` (sin guion bajo) no es lo
// que el INSERT de sealed_meta lee — la columna es `created_at` y es NOT NULL,
// asi que el INSERT fallaba en silencio y GET /api/recipes devolvia [].

describe('persistencia de recetas', () => {
  beforeEach(() => getMemoryAdapter().clear());

  const ctx = (req: Request) => ({
    request: req,
    params: {},
    locals: { user: { id: 'u1', email: 'chef@fize.app', name: 'C', role: 'owner' } },
  }) as any;

  const post = (body: unknown) =>
    new Request('http://x/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function seed() {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('menuItem', {
      id: 'm1', instance_id: 'default', name: 'Bandeja paisa', price: 32000,
      created_at: now, updated_at: now,
    });
    return adapter;
  }

  const body = {
    menuItemId: 'm1',
    name: 'Bandeja paisa clasica',
    yield: 4,
    prepTimeMin: 25,
    cookTimeMin: 35,
    cookTempC: 190,
    lines: [{ inventoryItemId: 'i1', name: 'Carne de res', qty: 0.8, unit: 'kg', unitCost: 34000 }],
  };

  it('el registro creado lleva created_at y updated_at', async () => {
    await seed();
    const res = await createRecipe(ctx(post(body)));
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r.created_at).toBeTruthy();
    expect(r.updated_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(r.created_at))).toBe(false);
  });

  it('la receta creada se puede leer despues (regresion del INSERT fallido)', async () => {
    await seed();
    await createRecipe(ctx(post(body)));
    // GET en un request posterior, no en el mismo: en memoria pasaria igual.
    const res = await listRecipes(ctx(new Request('http://x/api/recipes')));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bandeja paisa clasica');
  });

  it('GET devuelve margen y precio de la receta guardada', async () => {
    await seed();
    await createRecipe(ctx(post(body)));
    const rows = await (await listRecipes(ctx(new Request('http://x/api/recipes')))).json();
    // 0.8 kg * 34.000 = 27.200 total, / 4 = 6.800 porcion; precio 32.000
    expect(rows[0].costPerServing).toBe(6800);
    expect(rows[0].price).toBe(32000);
    expect(rows[0].lossMaking).toBe(false);
  });

  it('marca lossMaking cuando el costo supera el precio', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    // Plato barato, carne cara: se vende bajo costo.
    await adapter.create('menuItem', {
      id: 'm2', instance_id: 'default', name: 'Papas', price: 5000,
      created_at: now, updated_at: now,
    });
    await createRecipe(
      ctx(post({ ...body, menuItemId: 'm2' })),
    );
    const rows = await (await listRecipes(ctx(new Request('http://x/api/recipes')))).json();
    expect(rows[0].lossMaking).toBe(true);
  });
});
