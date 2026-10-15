// StockVsMinCard lee el store del navegador (src/stores/inventory.svelte.ts) en vez de recibir una copia
// serializada por props. En el prerender esa copia nacia vacia y el `client:load` la congelaba: la tarjeta
// nunca mostraba lo que `refreshInventoryFromApi` cargaba en el store. Aqui se fija el contrato y que las
// filas salgan del estado del store (la misma derivacion que hace el `$derived` de la tarjeta).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// El store usa runas de Svelte ($state). Fuera de un componente no hay compilador que las transforme; se
// resuelven con identidad, igual que en `src/stores/stores.smoke.test.ts`.
const g = globalThis as { $state?: <T>(v: T) => T };
g.$state = g.$state ?? ((v) => v);

const src = (...segments: string[]) => readFileSync(resolve(process.cwd(), 'src', ...segments), 'utf-8');
const card = src('components', 'inventory', 'StockVsMinCard.svelte');
const page = src('pages', 'dashboard', 'inventory', 'index.astro');

describe('StockVsMinCard: lee el store, no una copia serializada', () => {
  it('no declara prop `items`: deriva las filas de inventory.items', () => {
    expect(card).not.toContain('interface Props');
    expect(card).not.toContain('$props()');
    expect(card).toContain("import { inventory } from '../../stores/inventory.svelte'");
    expect(card).toContain('$derived(stockVsMin(inventory.items, 5))');
  });

  it('la pagina ya no le pasa items (ni la copia vacia del prerender)', () => {
    expect(page).toContain('<StockVsMinCard client:load />');
    expect(page).not.toMatch(/<StockVsMinCard[^>]*items=/);
  });

  it('las filas salen del store: al cargar insumos, stockVsMin(inventory.items) cambia', async () => {
    const { inventory, setItems, clearInventory } = await import('../../stores/inventory.svelte');
    const { stockVsMin } = await import('../../lib/stockVsMin');

    clearInventory();
    expect(stockVsMin(inventory.items, 5)).toEqual([]);

    setItems([{ id: 'a', sku: 'A', name: 'Harina', unit: 'kg', stock: 1, minStock: 10, costPerUnit: 2 }]);
    const rows = stockVsMin(inventory.items, 5);
    expect(rows.map((r) => r.item.id)).toEqual(['a']);
    expect(rows[0].level).toBe('critical');

    clearInventory();
    expect(stockVsMin(inventory.items, 5)).toEqual([]);
  });
});
