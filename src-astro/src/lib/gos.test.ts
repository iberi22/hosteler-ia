import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDbCache, memoryCache, type Ingredient } from '@swal/gos-client';
import { createAppGosClient, resilientCache } from './gos';
import { gramsFor, ingredientAllergens, nutritionPerServing } from './gosNutrition';
import { loadPublicNutrition } from './publicMenuNutrition';
import { mapInventoryItem } from './storeSync';
import { getMemoryAdapter, type DomainRecord } from './domain';
import manifest from './fixtures/gos/manifest.json';
import fixtures from './fixtures/gos/ingredients.json';

// JSON imports infer optional union keys as undefined; export fixtures follow the GOS schema.
const ingredients = fixtures as unknown as Ingredient[];
const inventory = [
  { id: 'garlic', gosIngredientId: 'gos:ingredient/ajo', gramsPerUnit: 1000 },
  { id: 'rice', gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 },
  { id: 'legacy' },
];
const lines = [{ inventoryId: 'garlic', qty: 0.1 }, { inventoryId: 'rice', qty: 0.2 }];
const online = (data: Ingredient[] = ingredients) => vi.fn<typeof fetch>(async input =>
  new Response(JSON.stringify(String(input).endsWith('manifest.json') ? manifest : data)),
);
const makeClient = (data: Ingredient[] = ingredients) => createAppGosClient({ fetch: online(data), cache: memoryCache() });

beforeEach(() => getMemoryAdapter().clear());
afterEach(() => vi.useRealTimers());

describe('GOS nutrition and migration', () => {
  it('converts inventory units to grams without assuming volume density', () => {
    expect(gramsFor(0.25, 1000)).toBe(250);
    expect(gramsFor(2, 60)).toBe(120);
    expect(gramsFor(1, undefined)).toBeUndefined();
  });
  it.each([0, -1, NaN, Infinity])('ignores invalid amounts or conversion %s', value => {
    expect(gramsFor(value, 1000)).toBeUndefined();
    expect(gramsFor(1, value)).toBeUndefined();
  });
  it('rejects an overflowing conversion', () => expect(gramsFor(Number.MAX_VALUE, 1000)).toBeUndefined());
  it('aggregates real GOS macros and divides by recipe yield', async () => {
    const total = await nutritionPerServing(lines, inventory, 2, makeClient());
    expect(total?.nutrition.calories).toBeCloseTo((149 + 365 * 2) / 2);
    expect(total?.nutrition.protein_g).toBeCloseTo((6.4 + 7.1 * 2) / 2);
    expect(total?.nutrition.carbs_g).toBeCloseTo((33 + 80 * 2) / 2);
    expect(total?.nutrition.fat_g).toBeCloseTo((0.5 + 0.7 * 2) / 2);
    expect(total?.linked).toBe(2);
    expect(total?.dataset).toBe(`${manifest.version}+sha256:${manifest.contentHash}`);
  });
  it('marks partial totals for unlinked lines', async () => {
    const total = await nutritionPerServing([...lines, { inventoryId: 'legacy', qty: 1 }], inventory, 1, makeClient());
    expect(total).toMatchObject({ linked: 2, total: 3, partial: true });
    expect(total?.nutrition.calories).toBeCloseTo(879);
  });
  it('marks unknown GOS IDs and missing gram conversion as partial', async () => {
    const stock = [...inventory, { id: 'unknown', gosIngredientId: 'gos:ingredient/missing', gramsPerUnit: 100 }];
    const total = await nutritionPerServing([...lines, { inventoryId: 'unknown', qty: 1 }, { inventoryId: 'legacy', qty: 2 }], stock, 1, makeClient());
    expect(total).toMatchObject({ linked: 2, total: 4, partial: true });
  });
  it('marks absent source nutrient blocks partial and never invents missing values', async () => {
    const data = ingredients.map(i => i.slug === 'ajo' ? { ...i, nutrition_per_100g: { calories: 149 }, micronutrients: null } : i);
    const total = await nutritionPerServing([{ inventoryId: 'garlic', qty: 0.1 }], inventory, 1, makeClient(data));
    expect(total?.nutrition).toEqual({ calories: 149 });
    expect(total?.partial).toBe(true);
  });
  it('derives only positive allergen tags and deduplicates them', () => {
    const tagged = { ...ingredients[0], allergens: ['gos:allergen/milk'], tags: ['gos:allergen/egg', 'vegetarian'] };
    expect(ingredientAllergens([tagged, tagged])).toEqual(['gos:allergen/egg', 'gos:allergen/milk']);
    expect(ingredientAllergens(ingredients)).toEqual([]);
  });
  it('keeps allergen-only records visible even when macros are missing', async () => {
    const data = [{ ...ingredients[0], nutrition_per_100g: null, allergens: ['gos:allergen/milk'] }];
    const total = await nutritionPerServing([{ inventoryId: 'garlic', qty: 0.1 }], inventory, 1, makeClient(data));
    expect(total).toMatchObject({ nutrition: {}, allergens: ['gos:allergen/milk'], partial: true });
  });
  it('hides nutrition for recipes with no linked ingredients or invalid yield', async () => {
    expect(await nutritionPerServing([{ inventoryId: 'legacy', qty: 1 }], inventory, 1, makeClient())).toBeUndefined();
    expect(await nutritionPerServing(lines, inventory, 0, makeClient())).toBeUndefined();
  });
  it('migrates legacy inventory shapes by preserving quantities and leaving GOS absent', () => {
    const legacy: DomainRecord = { id: 'old', instance_id: 'default', name: 'Arroz', unit: 'kg', stock: 5, created_at: '', updated_at: '' };
    expect(mapInventoryItem(legacy)).toMatchObject({ id: 'old', stock: 5, unit: 'kg' });
    expect(mapInventoryItem(legacy).gosIngredientId).toBeUndefined();
    expect(mapInventoryItem({ ...legacy, gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 }))
      .toMatchObject({ gosIngredientId: 'gos:ingredient/arroz', gramsPerUnit: 1000 });
  });
});

describe('optional offline GOS', () => {
  it('degrades gracefully on first use without network/cache', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const client = createAppGosClient({ fetch: fetcher, cache: memoryCache() });
    expect(await client.searchIngredients('ajo')).toEqual([]);
    expect(await client.getIngredient('ajo')).toBeUndefined();
    expect(await client.getManifest()).toBeUndefined();
    expect(await nutritionPerServing(lines, inventory, 1, client)).toBeUndefined();
  });
  it('tolerates non-200 and unsupported schemas', async () => {
    for (const response of [new Response('', { status: 503 }), Response.json({ schemaVersion: '99' })]) {
      const client = createAppGosClient({ fetch: async () => response.clone(), cache: memoryCache() });
      expect(await client.searchIngredients('ajo')).toEqual([]);
    }
  });
  it('bounds an unreachable fetch even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    const client = createAppGosClient({ fetch: () => new Promise(() => {}), cache: memoryCache(), timeoutMs: 50 });
    const search = client.searchIngredients('ajo');
    await vi.advanceTimersByTimeAsync(51);
    expect(await search).toEqual([]);
  });
  it('bounds a response that delivers headers but stalls its body', async () => {
    vi.useFakeTimers();
    const client = createAppGosClient({
      cache: memoryCache(), timeoutMs: 50,
      fetch: async () => new Response(new ReadableStream({ start() { /* body never arrives */ } })),
    });
    const search = client.searchIngredients('ajo');
    await vi.advanceTimersByTimeAsync(51);
    expect(await search).toEqual([]);
  });
  it('searches accent-insensitively with the real client', async () => {
    const client = makeClient();
    expect((await client.searchIngredients('ÁJÓ'))[0]?.id).toBe('gos:ingredient/ajo');
    expect((await client.searchIngredients('GARLIC'))[0]?.id).toBe('gos:ingredient/ajo');
  });
  it('retains a versioned IndexedDB dataset across client instances offline', async () => {
    const cache = indexedDbCache(`test-gos-${crypto.randomUUID()}`);
    const first = createAppGosClient({ fetch: online(), cache });
    await first.searchIngredients('ajo');
    const offline = createAppGosClient({ fetch: async () => { throw new TypeError('offline'); }, cache });
    expect((await offline.searchIngredients('ÁJO'))[0]?.id).toBe('gos:ingredient/ajo');
    const total = await nutritionPerServing(lines, inventory, 2, offline);
    expect(total?.nutrition.calories).toBeCloseTo(439.5);
    expect(total?.dataset).toBe(`${manifest.version}+sha256:${manifest.contentHash}`);
  });
  it('attributes stale ingredients to their cached hash when a newer manifest cannot refresh', async () => {
    const cache = memoryCache();
    const first = createAppGosClient({ fetch: online(), cache });
    await first.searchIngredients('ajo');
    const nextManifest = { ...manifest, version: '9.0.0', contentHash: 'f'.repeat(64) };
    const client = createAppGosClient({ cache, fetch: async input => {
      if (String(input).endsWith('manifest.json')) return Response.json(nextManifest);
      throw new TypeError('dataset unavailable');
    } });
    await client.getManifest();
    const total = await nutritionPerServing(lines, inventory, 1, client);
    expect(total?.dataset).toBe(`${manifest.version}+sha256:${manifest.contentHash}`);
    expect(total?.nutrition.calories).toBeCloseTo(879);
  });
  it('falls back to session memory when IndexedDB storage throws', async () => {
    const cache = resilientCache({ get: async () => { throw new Error('denied'); }, set: async () => { throw new Error('quota'); } });
    const client = createAppGosClient({ fetch: online(), cache });
    expect((await client.searchIngredients('ajo'))[0]?.id).toBe('gos:ingredient/ajo');
    expect(await cache.get('absent')).toBeUndefined();
  });
});

describe('public nutrition privacy', () => {
  it('distinguishes unavailable metadata from intentionally unlinked recipes', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('menuItem', { id: 'm', instance_id: 'default', created_at: '', updated_at: '', recipe: [{ inventoryId: 'i', qty: 1 }] });
    await adapter.create('inventoryItem', { id: 'i', instance_id: 'default', created_at: '', updated_at: '', gosIngredientId: 'gos:ingredient/ajo', gramsPerUnit: 100 });
    const offline = createAppGosClient({ cache: memoryCache(), fetch: async () => { throw new TypeError('offline'); } });
    await expect(loadPublicNutrition(adapter, 'default', ['m'], offline)).rejects.toThrow('GOS unavailable');
    await adapter.update('inventoryItem', 'i', { gosIngredientId: null }, 'default');
    expect(await loadPublicNutrition(adapter, 'default', ['m'], offline)).toEqual({});
  });
  it('returns only allowlisted totals, resolving both recipe shapes and yield', async () => {
    const adapter = getMemoryAdapter();
    const save = (entity: string, id: string, extra: Record<string, unknown>) => adapter.create(entity, {
      id, instance_id: 'default', created_at: '2026-10-02', updated_at: '2026-10-02', ...extra,
    });
    for (const i of inventory) await save('inventoryItem', i.id, i);
    await save('menuItem', 'simple', { recipe: lines, unitCost: 12345 });
    await save('menuItem', 'full', {});
    await save('menuItem', 'private', { isPublic: false, recipe: lines });
    await save('menuItem', 'other', { recipe: lines });
    await save('recipe', 'rec', { menuItemId: 'full', yield: 2, notes: 'secret', lines: lines.map(l => ({ inventoryItemId: l.inventoryId, qty: l.qty })) });
    const totals = await loadPublicNutrition(adapter, 'default', ['simple', 'full', 'private'], makeClient());
    expect(Object.keys(totals).sort()).toEqual(['full', 'simple']);
    expect(totals.full.nutrition.calories).toBeCloseTo(439.5);
    expect(totals.simple.nutrition.calories).toBeCloseTo(879);
    expect(JSON.stringify(totals)).not.toMatch(/secret|inventoryId|unitCost|recipe|notes/);
    expect(await loadPublicNutrition(adapter, 'another-instance', ['simple'], makeClient())).toEqual({});
  });
});
