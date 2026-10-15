import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import type { DomainRecord } from '../../../lib/domain';
import { requireSession } from '../../../lib/auth/session';
import { requireRole } from '../../../lib/auth/requireRole';
import { resolveTenant, authErrorResponse } from '../../../lib/auth/tenant';

const createCategorySchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  description: z.string().optional(),
  instance_id: z.string().optional(),
});

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const adapter = createStorageAdapter(locals);
    const list = await adapter.list('category', resolveTenant(locals, request));
    const active = list.filter((item) => !(item as Record<string, unknown>).deleted_at);

    return new Response(JSON.stringify(active), {
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

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireRole(locals, ['owner']);
    requireSession(locals);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = createCategorySchema.safeParse(body);
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
    const now = new Date().toISOString();
    const newRecord: DomainRecord = {
      id: genId(),
      instance_id: resolveTenant(locals, request, data.instance_id),
      name: data.name,
      description: data.description ?? null,
      created_at: now,
      updated_at: now,
    } as DomainRecord;

    const adapter = createStorageAdapter(locals);
    const created = await adapter.create('category', newRecord);

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
