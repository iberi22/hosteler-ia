import { describe, it, expect, beforeEach } from 'vitest';
import { POST as payOrder, GET as listPayments } from '../pages/api/orders/[id]/payment';
import { POST as createOrder } from '../pages/api/orders/index';
import { POST as transitionOrder } from '../pages/api/orders/[id]/transition';
import { getMemoryAdapter } from './domain';

// El registro de pagos es lo que el restaurante usa HOY mientras Bre-B no
// este integrado. Estos tests fijan las reglas que no se pueden romper:
// no se cobra antes de servir, no se cobra dos veces, no se cobra de menos.

describe('Payment API', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'u1', email: 'caja@restaurante.com', name: 'Caja', role: 'owner' };
  const ctx = (req: Request, params: Record<string, string> = {}) =>
    ({ request: req, params, locals: { user: mockUser } }) as any;

  const post = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function seedServedOrder() {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('table', {
      id: 't1', instance_id: 'default', number: 1, capacity: 2, qrCode: 'qr-1',
      created_at: now, updated_at: now,
    });
    await adapter.create('menuItem', {
      id: 'm1', instance_id: 'default', name: 'Bandeja', price: 25000, categoryId: 'c1',
      created_at: now, updated_at: now,
    });

    const res = await createOrder(
      ctx(post('http://localhost/api/orders', { tableId: 't1', items: [{ menuItemId: 'm1', qty: 2 }] })),
    );
    const order = await res.json();

    for (const to of ['preparing', 'ready', 'served']) {
      await transitionOrder(
        ctx(post(`http://localhost/api/orders/${order.id}/transition`, { to }), { id: order.id }),
      );
    }
    return order;
  }

  it('registra el pago de un pedido servido y lo marca pagado', async () => {
    const order = await seedServedOrder();
    const res = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 50000 }), { id: order.id }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.order.status).toBe('paid');
    expect(body.payment.method).toBe('efectivo');
    expect(body.payment.amount).toBe(50000);
    expect(body.payment.source).toBe('manual');
    expect(body.payment.recordedBy).toBe('caja@restaurante.com');
  });

  it('rechaza cobrar un pedido que no se ha servido', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create('table', {
      id: 't1', instance_id: 'default', number: 1, capacity: 2, qrCode: 'qr-1',
      created_at: now, updated_at: now,
    });
    await adapter.create('menuItem', {
      id: 'm1', instance_id: 'default', name: 'Bandeja', price: 25000, categoryId: 'c1',
      created_at: now, updated_at: now,
    });
    const res = await createOrder(
      ctx(post('http://localhost/api/orders', { tableId: 't1', items: [{ menuItemId: 'm1', qty: 1 }] })),
    );
    const order = await res.json();

    const pay = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 25000 }), { id: order.id }),
    );
    expect(pay.status).toBe(409);
  });

  it('no permite pagar dos veces el mismo pedido', async () => {
    const order = await seedServedOrder();
    const first = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 50000 }), { id: order.id }),
    );
    expect(first.status).toBe(201);

    const second = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 50000 }), { id: order.id }),
    );
    expect(second.status).toBe(409);
  });

  it('rechaza un monto menor que el total', async () => {
    const order = await seedServedOrder();
    const res = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 10000 }), { id: order.id }),
    );
    expect(res.status).toBe(422);
  });

  it('acepta propina: un monto mayor al total cierra el pedido', async () => {
    const order = await seedServedOrder();
    const res = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'efectivo', amount: 60000 }), { id: order.id }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).payment.amount).toBe(60000);
  });

  it('rechaza un metodo de pago desconocido', async () => {
    const order = await seedServedOrder();
    const res = await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'bitcoin', amount: 50000 }), { id: order.id }),
    );
    expect(res.status).toBe(400);
  });

  it('404 si el pedido no existe', async () => {
    const res = await payOrder(
      ctx(post('http://localhost/api/orders/no-existe/payment', { method: 'efectivo', amount: 1000 }), { id: 'no-existe' }),
    );
    expect(res.status).toBe(404);
  });

  it('GET lista los pagos del pedido', async () => {
    const order = await seedServedOrder();
    await payOrder(
      ctx(post(`http://localhost/api/orders/${order.id}/payment`, { method: 'breb', amount: 50000, reference: 'tx-9' }), { id: order.id }),
    );
    const res = await listPayments(
      ctx(new Request(`http://localhost/api/orders/${order.id}/payment`), { id: order.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].reference).toBe('tx-9');
  });
});
