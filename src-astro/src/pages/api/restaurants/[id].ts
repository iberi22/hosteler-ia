import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';
import { isSlugTaken, SLUG_TAKEN_MESSAGE, validateSlug, validateWhatsapp } from '../../../lib/restaurantRules';

const updateRestaurantSchema = z.object({
  name: z.string().min(1, { message: 'Name cannot be empty' }).optional(),
  slug: z.string().min(1, { message: 'Slug cannot be empty' }).optional(),
  address: z.string().min(1, { message: 'Address cannot be empty' }).optional(),
  // Telefono = WhatsApp de la tienda. Sin este campo el PATCH respondia 200 y
  // descartaba el valor en silencio (Zod strip unknown keys), y la carta
  // publica se quedaba sin boton de "Pedir por WhatsApp" sin explicar por que.
  // Vacio = quitar el WhatsApp (la carta publica oculta el boton). El formato
  // se valida y normaliza con validateWhatsapp en el handler.
  phone: z.string().optional(),
  // z.email() es la API actual de Zod 4; z.string().email() quedo deprecada.
  email: z.email({ message: 'Invalid email' }).optional(),
});

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Restaurant ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const record: any = await adapter.get('restaurant', id, instanceId);

    if (!record || record.deleted_at) {
      return new Response(JSON.stringify({ error: 'Restaurant not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(record), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
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
      return new Response(JSON.stringify({ error: 'Restaurant ID required' }), {
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

    const validation = updateRestaurantSchema.safeParse(body);
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

    const patch: Record<string, unknown> = { ...validation.data };
    if (validation.data.phone !== undefined) {
      const whatsapp = validateWhatsapp(validation.data.phone);
      if (!whatsapp.ok) {
        return new Response(JSON.stringify({ error: whatsapp.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      patch.phone = whatsapp.phone;
    }

    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const existing: any = await adapter.get('restaurant', id, instanceId);

    if (!existing || existing.deleted_at) {
      return new Response(JSON.stringify({ error: 'Restaurant not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Un slug heredado (anterior a estas reglas) se deja pasar mientras no cambie.
    if (validation.data.slug !== undefined && validation.data.slug !== existing.slug) {
      const slug = validation.data.slug.trim();
      const slugError = validateSlug(slug);
      if (slugError) {
        return new Response(JSON.stringify({ error: slugError }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (await isSlugTaken(adapter, instanceId, slug, id)) {
        return new Response(JSON.stringify({ error: SLUG_TAKEN_MESSAGE }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      patch.slug = slug;
    }

    const updated = await adapter.update('restaurant', id, patch, instanceId);

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof AuthError || (error && typeof error === 'object' && (error as { status?: number }).status === 401)) {
      return new Response(JSON.stringify({ error: (error as { message?: string }).message ?? 'Authentication required' }), {
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
      return new Response(JSON.stringify({ error: 'Restaurant ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const existing: any = await adapter.get('restaurant', id, instanceId);

    if (!existing || existing.deleted_at) {
      return new Response(JSON.stringify({ error: 'Restaurant not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const deletedAt = new Date().toISOString();
    const updated = await adapter.update('restaurant', id, { deleted_at: deletedAt }, instanceId);

    return new Response(
      JSON.stringify({
        message: 'Restaurant soft deleted',
        record: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    if (error instanceof AuthError || (error && typeof error === 'object' && (error as { status?: number }).status === 401)) {
      return new Response(JSON.stringify({ error: (error as { message?: string }).message ?? 'Authentication required' }), {
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
