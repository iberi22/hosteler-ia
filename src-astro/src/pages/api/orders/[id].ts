import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { isOrderStatus, assertTransition, type OrderStatus } from '../../../lib/orderStateMachine';
import { requireSession } from '../../../lib/auth/session';
import { resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';

const patchOrderSchema = z.object({
  note: z.string().optional(),
  tableId: z.string().min(1).optional(),
});

function isGone(record: Record<string, unknown> | null): boolean {
  return !record || Boolean(record.deleted_at);
}

const notFound = () =>
  new Response(JSON.stringify({ error: 'Order not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const record = (await adapter.get('order', id, await resolveRequestTenant(locals, request))) as Record<string, unknown> | null;

    if (isGone(record)) return notFound();

    return new Response(JSON.stringify(record), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    requireSession(locals);
    // Query o body (`instance_id`) con otra instancia -> 403 antes de leer el cuerpo.
    const instanceId = await resolveRequestTenant(locals, request);

    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status changes MUST go through /transition (state machine enforced)
    if ((body as Record<string, unknown>)?.status !== undefined) {
      return new Response(JSON.stringify({ error: 'Use POST /api/orders/[id]/transition for status changes' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = patchOrderSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          details: z.treeifyError(validation.error),
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('order', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) return notFound();

    if (validation.data.tableId) {
      const table = await adapter.get('table', validation.data.tableId, instanceId);
      if (!table || (table as Record<string, unknown>).deleted_at) {
        return new Response(JSON.stringify({ error: 'Table not found' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const updated = await adapter.update('order', id, validation.data, instanceId);

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  try {
    requireSession(locals);

    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = await resolveRequestTenant(locals, request);
    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('order', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) return notFound();

    const current = existing?.status as OrderStatus;
    if (isOrderStatus(current) && current !== 'cancelled' && current !== 'paid') {
      try {
        assertTransition(current, 'cancelled');
      } catch {
        return new Response(JSON.stringify({ error: `Order in status ${current} cannot be cancelled` }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const updated = await adapter.update('order', id, { status: 'cancelled' }, instanceId);
      return new Response(JSON.stringify({ message: 'Order cancelled', record: updated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // paid orders: soft delete record
    const updated = await adapter.update('order', id, { deleted_at: new Date().toISOString() }, instanceId);
    return new Response(JSON.stringify({ message: 'Order soft deleted', record: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
