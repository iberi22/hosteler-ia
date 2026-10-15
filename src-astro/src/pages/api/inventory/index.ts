import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import type { DomainRecord } from '../../../lib/domain';
import { appendTx } from '../../../lib/inventoryLedger';
import { requireSession } from '../../../lib/auth/session';
import { resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';

const createItemSchema = z.object({
  gosIngredientId: z.string().regex(/^gos:ingredient\/[^/]+$/).nullable().optional(),
  gramsPerUnit: z.number().positive().nullable().optional(),
  name: z.string().min(1, { message: 'Name is required' }),
  unit: z.string().min(1, { message: 'Unit is required' }),
  initialStock: z.number().nonnegative({ message: 'initialStock must be >= 0' }).optional(),
  minStock: z.number().nonnegative().optional(),
  /**
   * Costo por unidad. Sin este campo el costo de receta sale siempre $0 y el
   * margen del menu queda mintiendo; ademas Zod descarta en silencio las claves
   * desconocidas, asi que mandarlo sin declararlo aqui pasaba desapercibido.
   * Se actualiza solo cuando el restaurante registra una compra.
   */
  unitCost: z.number().nonnegative({ message: 'unitCost must be >= 0' }).optional(),
  instance_id: z.string().optional(),
});

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const url = new URL(request.url);
    const instanceId = await resolveRequestTenant(locals, request);
    const lowStockParam = url.searchParams.get('lowStock');
    const lowThreshold = lowStockParam !== null ? Number(lowStockParam) : null;

    if (lowThreshold !== null && Number.isNaN(lowThreshold)) {
      return new Response(JSON.stringify({ error: 'Invalid lowStock threshold' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const list = await adapter.list('inventoryItem', instanceId);
    const active = list.filter((item) => {
      const r = item as Record<string, unknown>;
      if (r.deleted_at) return false;
      if (lowThreshold !== null && Number(r.stock ?? 0) >= lowThreshold) return false;
      return true;
    });

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
    requireSession(locals);
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

    const validation = createItemSchema.safeParse(body);
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
    const now = new Date().toISOString();
    const created = (await adapter.create('inventoryItem', {
      id: genId(),
      instance_id: instanceId,
      name: data.name,
      unit: data.unit,
      stock: 0,
      ...(data.gosIngredientId !== undefined ? { gosIngredientId: data.gosIngredientId } : {}),
      ...(data.gramsPerUnit !== undefined ? { gramsPerUnit: data.gramsPerUnit } : {}),
      minStock: data.minStock ?? 0,
      // Se persiste el costo inicial: las recetas toman el costo de aqui.
      ...(data.unitCost !== undefined ? { unitCost: data.unitCost } : {}),
      created_at: now,
      updated_at: now,
    } as DomainRecord)) as DomainRecord;

    if (data.initialStock && data.initialStock > 0) {
      await appendTx(adapter, instanceId, created.id, 'purchase', data.initialStock, 'initial stock');
      const refreshed = await adapter.get('inventoryItem', created.id, instanceId);
      return new Response(JSON.stringify(refreshed), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
