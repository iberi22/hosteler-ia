// Contrato de la pantalla de inventario: sin prediccion IA. La tarjeta lateral
// compara el stock actual con el minimo configurado (dato real) y PredictionCard
// se elimino. Se comprueba sobre la fuente, como Landing.test.ts.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (...segments: string[]) => readFileSync(resolve(process.cwd(), 'src', ...segments), 'utf-8');

describe('inventario: stock vs minimo, sin prediccion IA', () => {
  const page = src('pages', 'dashboard', 'inventory', 'index.astro');
  const card = src('components', 'inventory', 'StockVsMinCard.svelte');

  it('la pagina monta StockVsMinCard y ya no PredictionCard', () => {
    expect(page).toContain('StockVsMinCard');
    expect(page).not.toContain('PredictionCard');
    expect(page).not.toContain('pred-title');
  });

  it('PredictionCard se elimino del repo', () => {
    expect(existsSync(resolve(process.cwd(), 'src', 'components', 'inventory', 'PredictionCard.svelte'))).toBe(false);
  });

  it('la tarjeta muestra stock/minimo sin badge de IA ni dias estimados', () => {
    expect(card).toContain('svm-title');
    expect(card).toContain('stockVsMin');
    expect(card).toContain('{item.stock} / {item.minStock}');
    expect(card).not.toContain('Predicción IA');
    expect(card).not.toContain('daysLeft');
    expect(card).not.toContain('confidence');
  });
});
