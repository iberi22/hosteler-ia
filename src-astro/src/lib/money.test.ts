import { describe, it, expect } from 'vitest';
import { formatCOP, formatPlain } from './money';

// El menu es colombiano: cualquier moneda que no sea COP es un bug visible en
// la reunion con el cliente. Este test falla si alguien reintroduce EUR/USD.
describe('formatCOP', () => {
  it('formatea pesos colombianos sin decimales', () => {
    const out = formatCOP(18000);
    expect(out).toContain('18.000');
    expect(out).not.toContain('€');
    expect(out).not.toContain('EUR');
  });

  it('usa el simbolo de pesos', () => {
    expect(formatCOP(32000)).toMatch(/\$\s?32\.000/);
  });

  it('no muestra decimales (costumbre local)', () => {
    expect(formatCOP(18000.5)).not.toMatch(/,\d\d/);
  });

  it('maneja montos grandes de restaurante', () => {
    expect(formatCOP(2_500_000)).toContain('2.500.000');
  });

  it('devuelve 0 ante entrada invalida en vez de NaN', () => {
    expect(formatCOP(Number.NaN)).toContain('0');
    expect(formatCOP(Number.POSITIVE_INFINITY)).toContain('0');
  });

  it('formatea 0 sin romperse', () => {
    expect(formatCOP(0)).toContain('0');
  });
});

describe('formatPlain', () => {
  it('formatea sin simbolo para inputs', () => {
    expect(formatPlain(18000)).toBe('18.000');
  });

  it('devuelve 0 ante entrada invalida', () => {
    expect(formatPlain(Number.NaN)).toBe('0');
  });
});
