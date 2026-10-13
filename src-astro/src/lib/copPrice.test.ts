import { describe, it, expect } from 'vitest';
import { parseCopPrice, parseCopPriceOrThrow } from './copPrice';

// QA pre-entrega 2026-10-13 #1: `parseFloat("38.000")` guardaba 38 (1000x menos).
// Este es el contrato del unico parser de precios de la app.
describe('parseCopPrice', () => {
  it('interpreta el punto de miles colombiano', () => {
    expect(parseCopPrice('38.000')).toBe(38000);
  });

  it('acepta el precio sin separador', () => {
    expect(parseCopPrice('38000')).toBe(38000);
  });

  it('ignora el simbolo de peso y los espacios', () => {
    expect(parseCopPrice('$ 38.000')).toBe(38000);
    expect(parseCopPrice('  $38.000 ')).toBe(38000);
    expect(parseCopPrice('$38000')).toBe(38000);
  });

  it('acepta millones con varios grupos', () => {
    expect(parseCopPrice('1.250.000')).toBe(1250000);
  });

  it('acepta la coma como separador de miles', () => {
    expect(parseCopPrice('38,000')).toBe(38000);
    expect(parseCopPrice('1,250,000')).toBe(1250000);
  });

  it('acepta numeros (los inputs de tipo number pueden entregar number)', () => {
    expect(parseCopPrice(38000)).toBe(38000);
  });

  it('rechaza basura con error (null)', () => {
    expect(parseCopPrice('abc')).toBeNull();
    expect(parseCopPrice('')).toBeNull();
    expect(parseCopPrice('   ')).toBeNull();
    expect(parseCopPrice('$')).toBeNull();
    expect(parseCopPrice(null)).toBeNull();
    expect(parseCopPrice(undefined)).toBeNull();
  });

  it('rechaza decimales en vez de inventarse un entero', () => {
    // "38.5" con punto de miles seria 385; con decimales serian 38,5. Ambiguo: error.
    expect(parseCopPrice('38.5')).toBeNull();
    expect(parseCopPrice('12,50')).toBeNull();
  });

  it('rechaza grupos de miles rotos', () => {
    expect(parseCopPrice('3.8000')).toBeNull();
    expect(parseCopPrice('38.000,00')).toBeNull();
    expect(parseCopPrice('1.25')).toBeNull();
  });

  it('rechaza negativos sin signo explicito', () => {
    expect(parseCopPrice('-500')).toBeNull();
  });
});

describe('parseCopPriceOrThrow', () => {
  it('devuelve el entero y lanza con basura', () => {
    expect(parseCopPriceOrThrow('38.000')).toBe(38000);
    expect(() => parseCopPriceOrThrow('abc')).toThrow(/Precio inválido/);
  });
});
