import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHODS,
  orderTotal,
  validatePayment,
  buildPayment,
} from './payments';

describe('orderTotal', () => {
  it('suma precio unitario por cantidad', () => {
    expect(
      orderTotal([
        { unitPrice: 18000, qty: 2 },
        { unitPrice: 9000, qty: 1 },
      ]),
    ).toBe(45000);
  });

  it('acepta quantity como alias de qty', () => {
    expect(orderTotal([{ unitPrice: 1000, quantity: 3 }])).toBe(3000);
  });

  it('devuelve 0 con items ausentes o no-array', () => {
    expect(orderTotal(undefined)).toBe(0);
    expect(orderTotal(null)).toBe(0);
    expect(orderTotal('nope')).toBe(0);
  });

  it('ignora items sin precio en vez de dar NaN', () => {
    expect(orderTotal([{ qty: 2 }, { unitPrice: 1000, qty: 1 }])).toBe(1000);
  });
});

describe('validatePayment', () => {
  const total = 50000;

  it('acepta un pago que cubre el total exacto', () => {
    const r = validatePayment({ amount: 50000, method: 'efectivo', orderTotal: total });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('acepta un pago con propina (mas del total)', () => {
    expect(validatePayment({ amount: 55000, method: 'efectivo', orderTotal: total }).ok).toBe(true);
  });

  it('rechaza un pago parcial sin explicar por que', () => {
    const r = validatePayment({ amount: 20000, method: 'efectivo', orderTotal: total });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('50000');
  });

  it('rechaza monto cero o negativo', () => {
    expect(validatePayment({ amount: 0, method: 'efectivo', orderTotal: total }).ok).toBe(false);
    expect(validatePayment({ amount: -5, method: 'efectivo', orderTotal: total }).ok).toBe(false);
  });

  it('rechaza un metodo fuera de la lista cerrada', () => {
    const r = validatePayment({ amount: total, method: 'bitcoin', orderTotal: total });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('bitcoin');
  });

  it('acepta los cinco metodos soportados', () => {
    for (const m of PAYMENT_METHODS) {
      expect(validatePayment({ amount: total, method: m, orderTotal: total }).ok).toBe(true);
    }
  });

  it('tolera diferencia de un centavo por redondeo de flotante', () => {
    // 0.1 + 0.2 clasico: el pago debe aceptarse igual
    expect(validatePayment({ amount: 45000.004, method: 'efectivo', orderTotal: 45000 }).ok).toBe(true);
  });

  it('no exige monto minimo cuando el pedido vale 0', () => {
    expect(validatePayment({ amount: 1, method: 'efectivo', orderTotal: 0 }).ok).toBe(true);
  });
});

describe('buildPayment', () => {
  it('genera un id unico por pago', () => {
    const base = { orderId: 'o1', instanceId: 'default', amount: 100, method: 'efectivo' as const, source: 'manual' as const };
    expect(buildPayment(base).id).not.toBe(buildPayment(base).id);
  });

  it('redondea a 2 decimales', () => {
    const p = buildPayment({ orderId: 'o1', instanceId: 'default', amount: 1234.5678, method: 'breb', source: 'webhook' });
    expect(p.amount).toBe(1234.57);
  });

  it('omite reference y recordedBy cuando no vienen', () => {
    const p = buildPayment({ orderId: 'o1', instanceId: 'default', amount: 100, method: 'efectivo', source: 'manual' });
    expect(p.reference).toBeUndefined();
    expect(p.recordedBy).toBeUndefined();
  });

  it('conserva reference y recordedBy cuando vienen', () => {
    const p = buildPayment({
      orderId: 'o1', instanceId: 'default', amount: 100, method: 'breb',
      source: 'webhook', reference: 'tx-123', recordedBy: 'caja@restaurante.com',
    });
    expect(p.reference).toBe('tx-123');
    expect(p.recordedBy).toBe('caja@restaurante.com');
  });

  it('acepta un timestamp fijo para tests deterministas', () => {
    const now = '2026-10-01T00:00:00.000Z';
    const p = buildPayment({ orderId: 'o1', instanceId: 'default', amount: 100, method: 'efectivo', source: 'manual', now });
    expect(p.recorded_at).toBe(now);
  });

  // Regresion: sealed_meta.created_at es NOT NULL en D1. Sin este campo el
  // INSERT fallaba, el pago se quedaba en la memoria del isolate y
  // GET /api/orders/[id]/payment devolvia [] en el siguiente request.
  it('incluye created_at porque la columna de D1 es NOT NULL', () => {
    const p = buildPayment({ orderId: 'o1', instanceId: 'default', amount: 100, method: 'efectivo', source: 'manual' });
    expect(p.created_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(p.created_at))).toBe(false);
  });
  it('created_at y recorded_at son el mismo instante', () => {
    const now = '2026-10-01T00:00:00.000Z';
    const p = buildPayment({ orderId: 'o1', instanceId: 'default', amount: 100, method: 'efectivo', source: 'manual', now });
    expect(p.created_at).toBe(p.recorded_at);
  });
});
