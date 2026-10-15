import { describe, it, expect } from 'vitest';
import { stockLevel, stockVsMin } from './stockVsMin';

const it_ = (id: string, stock: number, minStock: number) => ({ id, name: id, unit: 'kg', sku: id, stock, minStock });

describe('stockLevel', () => {
  it('agotado o <= 50% del minimo es critico, <= minimo es bajo, mas es ok', () => {
    expect(stockLevel(0, 10)).toBe('critical');
    expect(stockLevel(5, 10)).toBe('critical');
    expect(stockLevel(6, 10)).toBe('low');
    expect(stockLevel(10, 10)).toBe('low');
    expect(stockLevel(11, 10)).toBe('ok');
  });
});

describe('stockVsMin', () => {
  it('ordena por stock/minimo ascendente y es un calculo real, sin consumo estimado', () => {
    const rows = stockVsMin([it_('a', 30, 10), it_('b', 2, 10), it_('c', 10, 10)]);
    expect(rows.map((r) => r.item.id)).toEqual(['b', 'c', 'a']);
    expect(rows.map((r) => r.ratio)).toEqual([0.2, 1, 3]);
    expect(rows.map((r) => r.level)).toEqual(['critical', 'low', 'ok']);
  });

  it('incluye agotados e ignora insumos sin minimo', () => {
    const rows = stockVsMin([it_('cero', 0, 4), it_('sin-min', 8, 0)]);
    expect(rows.map((r) => r.item.id)).toEqual(['cero']);
    expect(rows[0].level).toBe('critical');
  });

  it('limita a 5 por defecto y no devuelve ninguna cifra de dias', () => {
    const many = Array.from({ length: 8 }, (_, n) => it_(`i${n}`, n, 10));
    const rows = stockVsMin(many);
    expect(rows).toHaveLength(5);
    expect(Object.keys(rows[0]).sort()).toEqual(['item', 'level', 'ratio']);
  });

  it('lista vacia -> vacia', () => {
    expect(stockVsMin([])).toEqual([]);
  });
});
