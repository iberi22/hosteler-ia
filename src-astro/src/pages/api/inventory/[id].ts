import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';

const updateItemSchema = z.object({
  gosIngredientId: z.string().regex(/^gos:ingredient\/[^/]+$/).nullable().optional(),
  gramsPerUnit: z.number().positive().nullable().optional(),
  name: z.string().min(1, { message: 'Name cannot be empty' }).optional(),
  unit: z.string().min(1, { message: 'Unit cannot be empty' }).optional(),
  minStock: z.number().nonnegative().optional(),
});

function resolveInstance(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';
}

function isGone(record: Record<string, unknown> | null): boolean {
  return !record || Boolean(record.deleted_at);
}

const notFound = () =>
  new Response(JSON.stringify({ error: 'Inventory item not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Item ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const record = (await adapter.get('inventoryItem', id, resolveInstance(request))) as Record<string, unknown> | null;

    if (isGone(record)) return notFound();

    return new Response(JSON.stringify(record), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
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

    // stock NUNCA se edita directo: usar POST /transactions
    if ((body as Record<string, unknown>)?.stock !== undefined) {
      return new Response(JSON.stringify({ error: 'Use POST /api/inventory/[id]/transactions to move stock' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = updateItemSchema.safeParse(body);
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

    const instanceId = resolveInstance(request);
    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('inventoryItem', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) return notFound();

    const updated = await adapter.update('inventoryItem', id, validation.data, instanceId);

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return new Response(JSON.stringify({ error: (err as { message?: string }).message ?? 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
      return new Response(JSON.stringify({ error: 'Item ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = resolveInstance(request);
    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('inventoryItem', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) return notFound();

    const updated = await adapter.update('inventoryItem', id, { deleted_at: new Date().toISOString() }, instanceId);

    return new Response(JSON.stringify({ message: 'Inventory item soft deleted', record: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return new Response(JSON.stringify({ error: (err as { message?: string }).message ?? 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
