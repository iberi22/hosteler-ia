import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../../lib/storageAdapter';
import { isTxKind, appendTx, txHistory, type TxKind } from '../../../../lib/inventoryLedger';
import { requireSession } from '../../../../lib/auth/session';
import { resolveTenant, authErrorResponse } from '../../../../lib/auth/tenant';

const txSchema = z.object({
  kind: z.string().min(1, { message: 'kind is required (purchase|use|waste|adjust)' }),
  qty: z.number().positive({ message: 'qty must be greater than 0' }),
  note: z.string().optional(),
});

// GET historial inmutable · POST nuevo movimiento (stock se recalcula solo)
export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Item ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = resolveTenant(locals, request);

    const adapter = createStorageAdapter(locals);
    const item = (await adapter.get('inventoryItem', id, instanceId)) as Record<string, unknown> | null;

    if (!item || item.deleted_at) {
      return new Response(JSON.stringify({ error: 'Inventory item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const history = await txHistory(adapter, instanceId, id);

    return new Response(JSON.stringify(history), {
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

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    requireSession(locals);

    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Item ID required' }), {
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

    const validation = txSchema.safeParse(body);
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

    if (!isTxKind(validation.data.kind)) {
      return new Response(JSON.stringify({ error: `Invalid kind: ${validation.data.kind}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = resolveTenant(locals, request);

    const adapter = createStorageAdapter(locals);
    const item = (await adapter.get('inventoryItem', id, instanceId)) as Record<string, unknown> | null;

    if (!item || item.deleted_at) {
      return new Response(JSON.stringify({ error: 'Inventory item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tx = await appendTx(
      adapter,
      instanceId,
      id,
      validation.data.kind as TxKind,
      validation.data.qty,
      validation.data.note,
    );

    const refreshed = await adapter.get('inventoryItem', id, instanceId);

    return new Response(JSON.stringify({ transaction: tx, item: refreshed }), {
      status: 201,
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
