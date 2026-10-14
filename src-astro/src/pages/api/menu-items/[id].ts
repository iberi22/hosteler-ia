import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { assertValidRecipe } from '../../../lib/recipes';
import { requireSession, AuthError } from '../../../lib/auth/session';
import { requireRole } from '../../../lib/auth/requireRole';

const recipeLineSchema = z.object({
  inventoryId: z.string().min(1, { message: 'inventoryId is required' }),
  qty: z.number().positive({ message: 'qty must be greater than 0' }),
});

const updateMenuItemSchema = z.object({
  name: z.string().min(1, { message: 'Name cannot be empty' }).optional(),
  price: z.number().positive({ message: 'Price must be greater than 0' }).optional(),
  categoryId: z.string().min(1, { message: 'categoryId cannot be empty' }).optional(),
  description: z.string().optional(),
  recipe: z.array(recipeLineSchema).optional(),
  // Sin estos dos, zod los descartaba en silencio: "agotado" u "oculto" respondia 200 pero no se guardaba,
  // y el plato seguia en la carta publica (loadMenuBySlug filtra por isAvailable e isPublic).
  isAvailable: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

function resolveInstance(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';
}

function isGone(record: Record<string, unknown> | null): boolean {
  return !record || Boolean(record.deleted_at);
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Menu item ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const record = (await adapter.get('menuItem', id, resolveInstance(request))) as Record<string, unknown> | null;

    if (isGone(record)) {
      return new Response(JSON.stringify({ error: 'Menu item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
    requireRole(locals, ['owner']);
    requireSession(locals);

    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Menu item ID required' }), {
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

    const validation = updateMenuItemSchema.safeParse(body);
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
    const existing = (await adapter.get('menuItem', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) {
      return new Response(JSON.stringify({ error: 'Menu item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (validation.data.categoryId) {
      const category = await adapter.get('category', validation.data.categoryId, instanceId);
      if (!category || (category as Record<string, unknown>).deleted_at) {
        return new Response(JSON.stringify({ error: 'Category not found' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (validation.data.recipe !== undefined) {
      try {
        await assertValidRecipe(validation.data.recipe, adapter, instanceId);
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const updated = await adapter.update('menuItem', id, validation.data, instanceId);

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
    requireRole(locals, ['owner']);
    requireSession(locals);

    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Menu item ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const instanceId = resolveInstance(request);
    const adapter = createStorageAdapter(locals);
    const existing = (await adapter.get('menuItem', id, instanceId)) as Record<string, unknown> | null;

    if (isGone(existing)) {
      return new Response(JSON.stringify({ error: 'Menu item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updated = await adapter.update('menuItem', id, { deleted_at: new Date().toISOString() }, instanceId);

    return new Response(
      JSON.stringify({
        message: 'Menu item soft deleted',
        record: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
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
