import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import type { DomainRecord } from '../../../lib/domain';
import { assertValidRecipe } from '../../../lib/recipes';
import { requireSession } from '../../../lib/auth/session';
import { requireRole } from '../../../lib/auth/requireRole';

const recipeLineSchema = z.object({
  inventoryId: z.string().min(1, { message: 'inventoryId is required' }),
  qty: z.number().positive({ message: 'qty must be greater than 0' }),
});

const createMenuItemSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  price: z.number().positive({ message: 'Price must be greater than 0' }),
  categoryId: z.string().min(1, { message: 'categoryId is required' }),
  description: z.string().optional(),
  recipe: z.array(recipeLineSchema).default(() => []),
  instance_id: z.string().optional(),
});

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';
    const categoryFilter = url.searchParams.get('categoryId');

    const adapter = createStorageAdapter(locals);
    const list = await adapter.list('menuItem', instanceId);
    const active = list.filter((item) => {
      const r = item as Record<string, unknown>;
      if (r.deleted_at) return false;
      if (categoryFilter && r.categoryId !== categoryFilter) return false;
      return true;
    });

    return new Response(JSON.stringify(active), {
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

    const validation = createMenuItemSchema.safeParse(body);
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
    const url = new URL(request.url);
    const instanceId = data.instance_id ?? url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);

    const category = await adapter.get('category', data.categoryId, instanceId);
    if (!category || (category as Record<string, unknown>).deleted_at) {
      return new Response(JSON.stringify({ error: 'Category not found' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      await assertValidRecipe(data.recipe, adapter, instanceId);
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    const newRecord: DomainRecord = {
      id: genId(),
      instance_id: instanceId,
      name: data.name,
      price: data.price,
      categoryId: data.categoryId,
      description: data.description ?? null,
      recipe: data.recipe,
      created_at: now,
      updated_at: now,
    } as DomainRecord;

    const created = await adapter.create('menuItem', newRecord);

    return new Response(JSON.stringify(created), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err && typeof err === 'object' && (err as { status?: number }).status === 401) {
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
