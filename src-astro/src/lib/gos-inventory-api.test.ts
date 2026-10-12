import { beforeEach, describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { POST } from '../pages/api/inventory/index';
import { PATCH, GET } from '../pages/api/inventory/[id]';
import { getMemoryAdapter } from './domain';

const context = (method: string, payload?: unknown, id?: string) => ({
  request: new Request(`http://localhost/api/inventory/${id ?? ''}`, {
    method, ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  }),
  params: { id }, locals: { user: { id: 'owner', email: 'owner@local.test', name: 'Owner', role: 'owner' } },
}) as unknown as APIContext;

beforeEach(() => getMemoryAdapter().clear());

describe('inventory GOS references', () => {
  it('preserves a legacy inventory record through linking, unlinking and reads', async () => {
    const response = await POST(context('POST', { name: 'Arroz', unit: 'kg', initialStock: 5 }));
    expect(response.status).toBe(201);
    const legacy = await response.json();
    expect(legacy.gosIngredientId).toBeUndefined();
    const link = await PATCH(context('PATCH', { gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 }, legacy.id));
    expect(link.status).toBe(200);
    expect(await link.json()).toMatchObject({ stock: 5, gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 });
    const read = await GET(context('GET', undefined, legacy.id));
    expect(await read.json()).toMatchObject({ gramsPerUnit: 1000 });
    const unlink = await PATCH(context('PATCH', { gosIngredientId: null, gramsPerUnit: null }, legacy.id));
    expect(await unlink.json()).toMatchObject({ stock: 5, gosIngredientId: null, gramsPerUnit: null });
  });
  it('stores links on new records without copying GOS food metadata', async () => {
    const response = await POST(context('POST', { name: 'Arroz', unit: 'kg', gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000, nutrition: { calories: 999 } }));
    expect(response.status).toBe(201);
    const record = await response.json();
    expect(record).toMatchObject({ gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 });
    expect(record.nutrition).toBeUndefined();
  });
  it.each([
    { gosIngredientId: 'arroz', gramsPerUnit: 1000 },
    { gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 0 },
    { gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: -100 },
  ])('rejects invalid references/conversions %j', async extra => {
    expect((await POST(context('POST', { name: 'Arroz', unit: 'kg', ...extra }))).status).toBe(400);
  });
});
