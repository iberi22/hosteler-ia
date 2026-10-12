import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../../lib/storageAdapter';
import { domainConfig } from '../../../../lib/domain.config';
import { requireSession, AuthError } from '../../../../lib/auth/session';
import { isOrderStatus } from '../../../../lib/orderStateMachine';
import {
  PAYMENT_METHODS,
  orderTotal,
  validatePayment,
  buildPayment,
  type PaymentMethod,
} from '../../../../lib/payments';
import type { DomainRecord } from '../../../../lib/domain';

// POST /api/orders/[id]/payment — registrar el pago de un pedido.
//
// Este es el camino que el restaurante usa HOY: cobra por su cuenta (efectivo,
// datafone, Bre-B, transferencia) y lo registra aqui. El mismo registro lo
// consumira mas adelante el webhook de Bre-B, para no partir la auditoria en
// dos sistemas.
//
// A diferencia de /transition, exige que el pedido este en 'served': no se
// cobra algo que no se sirvio.

const paySchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive({ message: 'amount must be greater than 0' }),
  reference: z.string().optional(),
  instance_id: z.string().optional(),
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const user = requireSession(locals);

    const { id } = params;
    if (!id) return json({ error: 'Order id is required' }, 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const validation = paySchema.safeParse(body);
    if (!validation.success) {
      return json(
        { error: 'Validation failed', details: z.treeifyError(validation.error) },
        400,
      );
    }

    const url = new URL(request.url);
    const instanceId =
      validation.data.instance_id ??
      url.searchParams.get('instance_id') ??
      domainConfig.instanceId ??
      'default';

    const adapter = createStorageAdapter(locals);
    const order = (await adapter.get('order', id, instanceId)) as Record<string, unknown> | null;

    if (!order || order.deleted_at) {
      return json({ error: 'Order not found' }, 404);
    }

    const status = order.status as string;
    if (!isOrderStatus(status)) {
      return json({ error: `Order has invalid status: ${String(status)}` }, 400);
    }

    if (status === 'paid') {
      return json({ error: 'Order is already paid' }, 409);
    }
    if (status !== 'served') {
      return json(
        { error: `Cannot pay an order in status "${status}". It must be "served" first.` },
        409,
      );
    }

    const total = orderTotal(order.items);
    const check = validatePayment({
      amount: validation.data.amount,
      method: validation.data.method,
      orderTotal: total,
    });
    if (!check.ok) {
      return json({ error: 'Invalid payment', details: check.errors }, 422);
    }

    const payment = buildPayment({
      orderId: id,
      instanceId,
      amount: validation.data.amount,
      method: validation.data.method as PaymentMethod,
      source: 'manual',
      reference: validation.data.reference,
      recordedBy: String((user as { email?: string } | null)?.email ?? 'desconocido'),
    });

    await adapter.create('payment', payment as unknown as DomainRecord);

    // Cerrar el pedido. assertTransition valida served -> paid.
    const { assertTransition } = await import('../../../../lib/orderStateMachine');
    assertTransition('served', 'paid');
    const updated = await adapter.update(
      'order',
      id,
      {
        status: 'paid',
        paidAt: payment.recorded_at,
        paymentMethod: payment.method,
        paymentId: payment.id,
      },
      instanceId,
    );

    return json({ order: updated, payment }, 201);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    // assertTransition lanza si la transicion no es valida
    if (err instanceof Error && err.message) {
      return json({ error: err.message }, 400);
    }
    console.error('[api/orders/[id]/payment:POST]', err);
    return json({ error: 'Internal Server Error' }, 500);
  }
};

/** GET /api/orders/[id]/payment — pagos registrados del pedido. */
export const GET: APIRoute = async ({ params, locals }) => {
  try {
    requireSession(locals);
    const { id } = params;
    if (!id) return json({ error: 'Order id is required' }, 400);

    const adapter = createStorageAdapter(locals);
    const all = await adapter.list('payment', domainConfig.instanceId ?? 'default');
    const payments = (all as Array<Record<string, unknown>>).filter((p) => p.orderId === id);

    return json({ payments }, 200);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json({ error: 'Internal Server Error' }, 500);
  }
};
