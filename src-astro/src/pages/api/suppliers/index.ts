import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';
import type { DomainRecord } from '../../../lib/domain';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const createSchema = z.object({
  name: z.string().min(2, 'El nombre del proveedor es obligatorio'),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  // z.email() es la API actual de Zod 4; z.string().email() quedo deprecada.
  email: z.email('Email invalido').optional().or(z.literal('')),
  address: z.string().optional(),
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
});

/** GET /api/suppliers */
export const GET: APIRoute = async ({ locals }) => {
  try {
    requireSession(locals);
    const adapter = createStorageAdapter(locals);
    const rows = await adapter.list('supplier', (locals.instanceId ?? domainConfig.instanceId ?? 'default'));
    return json((rows as Array<Record<string, unknown>>).sort((a, b) => String(a.name).localeCompare(String(b.name))), 200);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json({ error: 'Internal Server Error' }, 500);
  }
};

/** POST /api/suppliers */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSession(locals);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) }, 422);
    }

    const adapter = createStorageAdapter(locals);
    const now = new Date().toISOString();
    const record: DomainRecord = {
      id: `sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      instance_id: (locals.instanceId ?? domainConfig.instanceId ?? 'default'),
      ...parsed.data,
      email: parsed.data.email || undefined,
      isActive: true,
      created_at: now,
    } as unknown as DomainRecord;

    await adapter.create('supplier', record);
    return json(record, 201);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json({ error: 'Internal Server Error' }, 500);
  }
};
