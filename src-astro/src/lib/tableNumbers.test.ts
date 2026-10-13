import { describe, it, expect } from 'vitest';
import { tableNumberById } from './tableNumbers';

// QA pre-entrega 2026-10-13 #3: el KDS pintaba el id crudo de la mesa.
describe('tableNumberById', () => {
  const tables = [
    { id: 'mv6j956n-5ct119', number: 1 },
    { id: 'zz9-abc', number: 7 },
  ];

  it('resuelve el numero de la mesa por su id', () => {
    expect(tableNumberById('mv6j956n-5ct119', tables)).toBe(1);
    expect(tableNumberById('zz9-abc', tables)).toBe(7);
  });

  it('acepta el numero como id (pedidos demo del dashboard)', () => {
    expect(tableNumberById('12', tables)).toBe(12);
  });

  it('sin mesa o con id desconocido devuelve null (la tarjeta pinta —)', () => {
    expect(tableNumberById(null, tables)).toBeNull();
    expect(tableNumberById(undefined, tables)).toBeNull();
    expect(tableNumberById('', tables)).toBeNull();
    expect(tableNumberById('otro-id-raro', tables)).toBeNull();
  });

  it('acepta numeros serializados como string en la tabla', () => {
    expect(tableNumberById('t1', [{ id: 't1', number: '3' }])).toBe(3);
  });
});
