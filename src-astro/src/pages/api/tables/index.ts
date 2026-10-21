import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import type { DomainRecord } from '../../../lib/domain';
import { requireRole } from '../../../lib/auth/requireRole';
import { resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';

const createTableSchema = z.object({
  number: z.number().int().positive({ message: 'Number must be a positive integer' }),
  capacity: z.number().int().positive({ message: 'Capacity must be a positive integer' }),
  restaurantId: z.string().min(1, { message: 'restaurantId is required' }).optional(),
  instance_id: z.string().optional(),
});

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function qrExists(adapter: ReturnType<typeof createStorageAdapter>, qrCode: string, instanceId: string): Promise<boolean> {
  const list = await adapter.list('table', instanceId);
  return list.some((t) => (t as Record<string, unknown>).qrCode === qrCode);
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    requireRole(locals, ['owner', 'caja', 'staff', 'cocina']);
    const instanceId = await resolveRequestTenant(locals, request);

    const adapter = createStorageAdapter(locals);
    const list = await adapter.list('table', instanceId);
    const active = list.filter((item) => !(item as Record<string, unknown>).deleted_at);

    return new Response(JSON.stringify(active), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error('[api/tables:GET]', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireRole(locals, ['owner', 'caja', 'staff']);
    // Query o body (`instance_id`) con otra instancia -> 403 antes de leer el cuerpo.
    const instanceId = await resolveRequestTenant(locals, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = createTableSchema.safeParse(body);
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

    const data = validation.data;

    const adapter = createStorageAdapter(locals);

    let qrCode = crypto.randomUUID();
    while (await qrExists(adapter, qrCode, instanceId)) {
      qrCode = crypto.randomUUID();
    }

    const now = new Date().toISOString();
    const newRecord: DomainRecord = {
      id: genId(),
      instance_id: instanceId,
      number: data.number,
      capacity: data.capacity,
      restaurantId: data.restaurantId ?? null,
      qrCode,
      created_at: now,
      updated_at: now,
    } as DomainRecord;

    const created = await adapter.create('table', newRecord);

    return new Response(JSON.stringify(created), {
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
