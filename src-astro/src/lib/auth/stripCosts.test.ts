import { describe, it, expect } from 'vitest';
import { stripCosts } from './stripCosts';

const recipe = {
  id: 'r1',
  name: 'Sopa',
  price: 20000,
  costTotal: 5000,
  costPerServing: 2500,
  margin: 0.8,
  lossMaking: false,
  lines: [{ inventoryItemId: 'i1', name: 'Papa', qty: 2, unit: 'kg', unitCost: 1000, lineTotal: 2000 }],
};

describe('stripCosts', () => {
  it('owner output is identical', () => {
    expect(stripCosts('owner', recipe)).toEqual(recipe);
  });
  for (const role of ['caja', 'staff', 'cocina', 'unknown']) {
    it(`${role} loses every cost field, including nested lines`, () => {
      const out = stripCosts(role, [recipe]) as Array<Record<string, unknown>>;
      expect(out[0]).toEqual({
        id: 'r1',
        name: 'Sopa',
        price: 20000,
        lines: [{ inventoryItemId: 'i1', name: 'Papa', qty: 2, unit: 'kg' }],
      });
    });
  }
  it('strips unitCost from a flat inventory item and does not mutate input', () => {
    const item = { id: 'i', stock: 3, unitCost: 10 };
    expect(stripCosts('caja', item)).toEqual({ id: 'i', stock: 3 });
    expect(item.unitCost).toBe(10);
  });
  it('passes primitives and null through', () => {
    expect(stripCosts('cocina', null)).toBeNull();
    expect(stripCosts('cocina', 5)).toBe(5);
  });
});
