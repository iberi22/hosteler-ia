import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { requireSession } from '../../../lib/auth/session';
import { resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';

const updateTableSchema = z.object({
  number: z.number().int().positive({ message: 'Number must be a positive integer' }).optional(),
  capacity: z.number().int().positive({ message: 'Capacity must be a positive integer' }).optional(),
  restaurantId: z.string().min(1, { message: 'restaurantId cannot be empty' }).optional(),
});

function isGone(record: Record<string, unknown> | null): boolean {
  return !record || Boolean(record.deleted_at);
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Table ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const record = (await adapter.get('table', id, await resolveRequestTenant(locals, request))) as Record<string, unknown> | null;

    if (isGone(record)) {
      return new Response(JSON.stringify({ error: 'Table not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
      return new Response(JSON.stringify({ error: 'Table ID required' }), {
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

    const validation = updateTableSchema.safeParse(body);
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
    const existing = (await adapter.get('table', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) {
      return new Response(JSON.stringify({ error: 'Table not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updated = await adapter.update('table', id, validation.data, instanceId);

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
      return new Response(JSON.stringify({ error: 'Table ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = await resolveRequestTenant(locals, request);
    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('table', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) {
      return new Response(JSON.stringify({ error: 'Table not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updated = await adapter.update('table', id, { deleted_at: new Date().toISOString() }, instanceId);

    return new Response(
      JSON.stringify({
        message: 'Table soft deleted',
        record: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
