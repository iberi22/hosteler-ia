import { describe, it, expect } from 'vitest';
import {
  costPerServing,
  recipeCostTotal,
  totalTime,
  grossMargin,
  isLossMaking,
  purchaseTotals,
  normalizeColombianPhone,
  buildWhatsappMessage,
  whatsappOrderLink,
  type RecipeLine,
  type PurchaseLine,
} from './domain.extensions';

const line = (qty: number, unitCost: number, unit = 'g'): RecipeLine => ({
  inventoryItemId: `inv-${qty}-${unitCost}`,
  name: 'insumo',
  qty,
  unit,
  unitCost,
  lineTotal: qty * unitCost,
});

describe('costPerServing', () => {
  it('divide el costo total entre las raciones', () => {
    expect(costPerServing([line(500, 20), line(200, 8)], 4)).toBe(2900);
  });

  it('recalcula desde qty*unitCost, ignorando el lineTotal guardado', () => {
    // El insumo subio de precio despues de armar la receta: el costo real
    // es el actual, no el congelado en lineTotal.
    const stale: RecipeLine = { ...line(1, 1000), lineTotal: 1 };
    expect(costPerServing([stale], 1)).toBe(1000);
  });

  it('devuelve 0 si las raciones son 0 o negativas', () => {
    expect(costPerServing([line(1, 100)], 0)).toBe(0);
    expect(costPerServing([line(1, 100)], -3)).toBe(0);
  });

  it('devuelve 0 con receta vacia', () => {
    expect(costPerServing([], 4)).toBe(0);
  });
});

describe('recipeCostTotal', () => {
  it('suma todas las lineas sin dividir', () => {
    expect(recipeCostTotal([line(500, 20), line(200, 8)])).toBe(11600);
  });
});

describe('totalTime', () => {
  it('suma preparacion y coccion', () => {
    expect(totalTime(15, 40)).toBe(55);
  });

  it('redondea a enteros', () => {
    expect(totalTime(10.4, 20.6)).toBe(31);
  });

  it('tolera tiempos negativos poniendolos en 0', () => {
    expect(totalTime(-5, 30)).toBe(30);
  });
});

describe('grossMargin', () => {
  it('calcula el margen de un plato', () => {
    // precio 30000, costo 10000 -> 66.67%
    expect(grossMargin(30000, 10000)).toBe(0.67);
  });

  it('da margen negativo cuando el costo supera el precio', () => {
    expect(grossMargin(10000, 15000)).toBe(-0.5);
  });

  it('devuelve 0 con precio 0 en vez de dividir por cero', () => {
    expect(grossMargin(0, 100)).toBe(0);
  });
});

describe('isLossMaking', () => {
  it('detecta el plato que se vende por debajo de costo', () => {
    expect(isLossMaking(10000, 12000)).toBe(true);
    expect(isLossMaking(10000, 10000)).toBe(true);
  });

  it('no marca un plato sano', () => {
    expect(isLossMaking(30000, 10000)).toBe(false);
  });

  it('no marca nada con precio 0 (plato no expuesto)', () => {
    expect(isLossMaking(0, 0)).toBe(false);
  });
});

describe('purchaseTotals', () => {
  const l = (qty: number, unitCost: number): PurchaseLine => ({
    inventoryItemId: 'i', name: 'x', qty, unit: 'kg', unitCost, lineTotal: qty * unitCost,
  });

  it('suma subtotal, calcula impuesto y total', () => {
    const r = purchaseTotals([l(10, 5000), l(2, 3000)], 0.19);
    expect(r.subtotal).toBe(56000);
    expect(r.tax).toBe(10640);
    expect(r.total).toBe(66640);
  });

  it('con impuesto 0 no toca nada', () => {
    const r = purchaseTotals([l(1, 1000)], 0);
    expect(r.total).toBe(1000);
  });

  it('trata una tasa NaN como 0 en vez de propagar el error', () => {
    expect(purchaseTotals([l(1, 1000)], NaN).total).toBe(1000);
  });
});

describe('normalizeColombianPhone', () => {
  it('agrega el codigo de pais a un numero local', () => {
    expect(normalizeColombianPhone('3001234567')).toBe('573001234567');
  });

  it('quita el 0 inicial de los numeros con prefijo 0', () => {
    expect(normalizeColombianPhone('0300 123 4567')).toBe('573001234567');
  });

  it('respeta un numero que ya trae codigo de pais', () => {
    expect(normalizeColombianPhone('+57 300 123 4567')).toBe('573001234567');
  });

  it('ignora espacios, guiones y parentesis', () => {
    expect(normalizeColombianPhone('+57 (300) 123-45.67')).toBe('573001234567');
  });

  it('devuelve vacio si no hay numero', () => {
    expect(normalizeColombianPhone('')).toBe('');
  });
});

describe('buildWhatsappMessage', () => {
  const base = {
    restaurantName: 'Sabor Paisa',
    orderId: 'abc-123',
    tableLabel: '7',
    lines: [
      { name: 'Bandeja paisa', qty: 2, unitPrice: 32000 },
      { name: 'Limonada', qty: 1, unitPrice: 9000 },
    ],
    total: 73000,
  };

  it('incluye nombre de la tienda, mesa, items y total', () => {
    const m = buildWhatsappMessage(base);
    expect(m).toContain('Sabor Paisa');
    expect(m).toContain('mesa 7');
    expect(m).toContain('Bandeja paisa');
    expect(m).toContain('Limonada');
    expect(m).toContain('73.000');
  });

  it('multiplica cantidad por precio en cada linea', () => {
    expect(buildWhatsappMessage(base)).toContain('2 × Bandeja paisa — 64.000');
  });

  it('agrega la URL solo si viene', () => {
    expect(buildWhatsappMessage(base)).not.toContain('http');
    expect(buildWhatsappMessage({ ...base, orderUrl: 'https://fize.swal.network/x/menu' })).toContain(
      'https://fize.swal.network/x/menu',
    );
  });
});

describe('whatsappOrderLink', () => {
  const base = {
    restaurantPhone: '3001234567',
    restaurantName: 'Sabor Paisa',
    orderId: 'abc-123',
    tableLabel: '7',
    lines: [{ name: 'Bandeja paisa', qty: 2, unitPrice: 32000 }],
    total: 64000,
  };

  it('genera un enlace wa.me con el numero normalizado', () => {
    const url = whatsappOrderLink(base);
    expect(url.startsWith('https://wa.me/573001234567?text=')).toBe(true);
  });

  it('codifica el mensaje en el query string', () => {
    const url = whatsappOrderLink(base);
    const text = decodeURIComponent(url.split('?text=')[1]);
    expect(text).toContain('Bandeja paisa');
  });

  it('no rompe si el restaurante no tiene telefono', () => {
    const url = whatsappOrderLink({ ...base, restaurantPhone: '' });
    expect(url).toContain('wa.me/?text=');
  });
});
