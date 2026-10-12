import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';
import {
  costPerServing,
  recipeCostTotal,
  totalTime,
  roundCOP,
  type RecipeLine,
  type RecipeVisibility,
} from '../../../lib/domain.extensions';
import type { DomainRecord } from '../../../lib/domain';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const lineSchema = z.object({
  inventoryItemId: z.string().min(1, 'Cada linea necesita el insumo'),
  name: z.string().min(1, 'Cada linea necesita el nombre'),
  qty: z.coerce.number().positive('La cantidad debe ser mayor que cero'),
  unit: z.string().min(1, 'Cada linea necesita la unidad'),
  unitCost: z.coerce.number().min(0, 'El costo no puede ser negativo'),
});

const createSchema = z.object({
  menuItemId: z.string().min(1, 'La receta pertenece a un plato'),
  name: z.string().min(2, 'El nombre de la receta es obligatorio'),
  yield: z.coerce.number().int().positive('La receta debe rendir al menos 1 porcion'),
  prepTimeMin: z.coerce.number().int().min(0).max(1440).default(0),
  cookTimeMin: z.coerce.number().int().min(0).max(1440).default(0),
  cookTempC: z.coerce.number().int().min(30).max(400).optional(),
  visibility: z.enum(['privada', 'equipo']).default('privada'),
  steps: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, 'La receta necesita al menos un insumo'),
});

/**
 * GET /api/recipes
 *
 * Solo para sesion iniciada. NO existe ruta publica de recetas: son propiedad
 * intelectual del restaurante. Lo que se expone al cliente final es el plato
 * (menuItem.isPublic) via /api/menu, que nunca incluye estos campos.
 */
export const GET: APIRoute = async ({ locals }) => {
  try {
    requireSession(locals);
    const adapter = createStorageAdapter(locals);
    const recipes = await adapter.list('recipe', domainConfig.instanceId ?? 'default');
    const items = await adapter.list('menuItem', domainConfig.instanceId ?? 'default');
    const priceById = new Map(
      items.map((m) => [m.id, Number((m as Record<string, unknown>).price ?? 0)]),
    );
    const rows = (recipes as Array<Record<string, unknown>>).map((r): Record<string, unknown> => {
      const price = priceById.get(String(r.menuItemId)) ?? 0;
      const cost = Number(r.costPerServing ?? 0);
      return {
        ...r,
        price,
        margin: price > 0 ? Math.round(((price - cost) / price) * 10000) / 10000 : 0,
        lossMaking: price > 0 && cost >= price,
      };
    });
    return json(rows, 200);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json({ error: 'Internal Server Error' }, 500);
  }
};

/**
 * POST /api/recipes
 *
 * Los costos SIEMPRE se derivan de las lineas, nunca se aceptan del cliente:
 * si un restaurante pudiera mandar el costo, el margen del menu seria un
 * numero que el mismo puede falsear sin querer.
 */
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

    const instanceId = domainConfig.instanceId ?? 'default';
    const adapter = createStorageAdapter(locals);
    const menuItem = await adapter.get('menuItem', parsed.data.menuItemId, instanceId);
    if (!menuItem) return json({ error: 'El plato no existe' }, 404);

    const lines: RecipeLine[] = parsed.data.lines.map((l) => ({
      ...l,
      lineTotal: roundCOP(l.qty * l.unitCost),
    }));

    const now = new Date().toISOString();
    const record: DomainRecord = {
      id: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      instance_id: instanceId,
      menuItemId: parsed.data.menuItemId,
      name: parsed.data.name,
      yield: parsed.data.yield,
      lines,
      costTotal: recipeCostTotal(lines),
      costPerServing: costPerServing(lines, parsed.data.yield),
      prepTimeMin: parsed.data.prepTimeMin,
      cookTimeMin: parsed.data.cookTimeMin,
      totalTimeMin: totalTime(parsed.data.prepTimeMin, parsed.data.cookTimeMin),
      ...(parsed.data.cookTempC !== undefined ? { cookTempC: parsed.data.cookTempC } : {}),
      visibility: parsed.data.visibility as RecipeVisibility,
      steps: parsed.data.steps,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      createdAt: now,
      // `created_at` es la columna NOT NULL de sealed_meta; sin ella el INSERT
      // falla, la receta se queda solo en la memoria del isolate y GET devuelve
      // [] en el siguiente request aunque el POST haya respondido 201. El mismo
      // fallo que sufrió el registro de pagos.
      created_at: now,
      updated_at: now,
    } as unknown as DomainRecord;

    await adapter.create('recipe', record);
    return json(record, 201);
  } catch (err) {
    if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json({ error: 'Internal Server Error' }, 500);
  }
};
