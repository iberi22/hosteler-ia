import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../../lib/storageAdapter';
import { isOrderStatus, assertTransition, type OrderStatus } from '../../../../lib/orderStateMachine';
import { deductRecipe } from '../../../../lib/recipes';
import type { StorageAdapter } from '../../../../lib/domain';
import { requireRole } from '../../../../lib/auth/requireRole';
import { resolveRequestTenant, authErrorResponse } from '../../../../lib/auth/tenant';

async function deductOrderStock(
  adapter: StorageAdapter,
  instanceId: string,
  orderId: string,
  items: unknown,
): Promise<number> {
  if (!Array.isArray(items)) return 0;
  let movements = 0;
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const menuItemId = typeof it.menuItemId === 'string' ? it.menuItemId : null;
    if (!menuItemId) continue;
    const qtyRaw = it.qty ?? it.quantity;
    const times = typeof qtyRaw === 'number' && Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    const menuItem = await adapter.get('menuItem', menuItemId, instanceId);
    if (!menuItem || (menuItem as Record<string, unknown>).deleted_at) continue;
    movements += await deductRecipe(adapter, instanceId, menuItem as Record<string, unknown>, times, orderId);
  }
  return movements;
}

const transitionSchema = z.object({
  to: z.string().min(1, { message: 'Target status is required' }),
});

// POST /api/orders/[id]/transition { to } — único camino válido para cambiar status
export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    requireRole(locals, ['owner', 'staff', 'cocina']);
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

    const validation = transitionSchema.safeParse(body);
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

    if (!existing || existing.deleted_at) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const from = existing.status as OrderStatus;
    const to = validation.data.to;

    if (!isOrderStatus(from) || !isOrderStatus(to)) {
      return new Response(JSON.stringify({ error: `Invalid status: ${String(to)}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      assertTransition(from, to);
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updated = await adapter.update('order', id, { status: to }, instanceId);

    // Descuento de stock al servir: una sola vez (guarda stockDeducted como marca de idempotencia).
    if (to === 'served' && !existing.stockDeducted) {
      try {
        const movements = await deductOrderStock(adapter, instanceId, id, (updated as Record<string, unknown>).items);
        const finalOrder = await adapter.update('order', id, { stockDeducted: new Date().toISOString() }, instanceId);
        return new Response(JSON.stringify({ ...finalOrder, deduction: { ok: true, movements } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.warn(`[orders] stock deduction failed for order ${id}:`, err);
        return new Response(JSON.stringify({ ...updated, deduction: { ok: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

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
