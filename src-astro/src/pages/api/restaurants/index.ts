import type { APIRoute } from "astro";
import { z } from "zod";
import { requireSession } from "../../../lib/auth/session";
import { resolvePublicTenant, resolveRequestTenant, authErrorResponse } from "../../../lib/auth/tenant";
import type { DomainRecord } from "../../../lib/domain";
import { createStorageAdapter } from "../../../lib/storageAdapter";
import {
  isSlugTaken,
  SLUG_TAKEN_MESSAGE,
  validateSlug,
  validateWhatsapp,
} from "../../../lib/restaurantRules";
import { requireRole } from "../../../lib/auth/requireRole";

const createRestaurantSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  slug: z.string().min(1, { message: "Slug is required" }),
  address: z.string().min(1, { message: "Address is required" }),
  phone: z.string().optional(),
  instance_id: z.string().optional(),
});

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    // Ruta publica: la lista sale de la instancia del despliegue. El `?instance_id=` del cliente se IGNORA
    // (no elige datos ni provoca 403): ver resolvePublicTenant en lib/auth/tenant.ts.
    const instanceId = resolvePublicTenant(locals);

    const adapter = createStorageAdapter(locals);
    const list = await adapter.list("restaurant", instanceId);

    // Filter out soft-deleted records
    const active = list.filter((item) => !(item as Record<string, unknown>).deleted_at);

    return new Response(JSON.stringify(active), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireRole(locals, ['owner']);
    requireSession(locals);
    // Query o body (`instance_id`) con otra instancia -> 403 antes de leer el cuerpo.
    const instanceId = await resolveRequestTenant(locals, request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const validation = createRestaurantSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          details: z.treeifyError(validation.error),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = validation.data;

    // WhatsApp opcional; si viene, se guarda normalizado (digitos con indicativo).
    const whatsapp = validateWhatsapp(data.phone ?? "");
    if (!whatsapp.ok) {
      return new Response(JSON.stringify({ error: whatsapp.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const slugError = validateSlug(data.slug);
    if (slugError) {
      return new Response(JSON.stringify({ error: slugError }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const adapter = createStorageAdapter(locals);
    if (await isSlugTaken(adapter, instanceId, data.slug.trim())) {
      return new Response(JSON.stringify({ error: SLUG_TAKEN_MESSAGE }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const newRecord: DomainRecord = {
      id: genId(),
      instance_id: instanceId,
      name: data.name,
      slug: data.slug.trim(),
      address: data.address,
      ...(whatsapp.phone ? { phone: whatsapp.phone } : {}),
      created_at: now,
      updated_at: now,
    };

    const created = await adapter.create("restaurant", newRecord);

    return new Response(JSON.stringify(created), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
