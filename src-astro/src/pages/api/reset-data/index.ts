import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';
import {
  canReset,
  resetDenial,
  planReset,
  executeReset,
  resolveRequestedEntities,
} from '../../../lib/resetData';

// Ver src/lib/resetData.ts para el por que de cada regla. Resumen:
//
//   POST /api/reset-data                     -> 200 plan (dry-run, NO borra)
//   POST /api/reset-data { confirm: true }   -> borra lo del instance de la sesion
//
// Lo que cambia frente al legacy (que era un stub que no borraba nada y
// contestaba success: true):
//
//   - Sin sesion -> 401. Antes no hacia falta sesion para nada.
//   - Sin rol owner -> 403. Un staff no borra el historial del negocio.
//   - Sin `confirm: true` -> NO borra. Un POST vacio no destruye datos.
//   - `user` y `session` quedan intactos siempre. Si se borraran, el token que
//     autoriza el reset dejaria de existir a mitad de la peticion y el
//     restaurante se quedaria sin admins.
//   - Solo el instance de la sesion.

const resetBodySchema = z.object({
  /** Sin esto el handler solo informa. Ver regla 3 de resetData.ts. */
  confirm: z.boolean().optional().default(false),
  /** Que entidades tocar. Ausente = todas las reseteables. */
  entities: z.array(z.string()).optional(),
  instance_id: z.string().optional(),
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Un AuthError es 401; cualquier otra cosa, 500. Un solo lugar que lo decide. */
function handleError(err: unknown): Response {
  if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
    return json({ error: (err as { message?: string }).message ?? 'Authentication required' }, 401);
  }
  return json({ error: 'Internal Server Error' }, 500);
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const user = requireSession(locals);

    if (!canReset(user.role)) {
      return json({ error: resetDenial(user.role) }, 403);
    }

    let body: unknown = {};
    const raw = await request.text();
    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
    }

    const validation = resetBodySchema.safeParse(body);
    if (!validation.success) {
      return json({ error: 'Validation failed', details: z.treeifyError(validation.error) }, 400);
    }

    // El instance sale de la sesion (locals), con query como red de seguridad.
    // NUNCA del body: pedir el reset del instance de otro restaurante no es una
    // operacion que este endpoint pueda hacer.
    const localsInstance = typeof locals?.instanceId === 'string' ? locals.instanceId : undefined;
    const url = new URL(request.url);
    const instanceId =
      localsInstance ?? validation.data.instance_id ?? url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const { known, unknown } = resolveRequestedEntities(validation.data.entities);
    if (known.length === 0) {
      return json(
        { error: 'No resettable entities requested', skipped: unknown },
        400,
      );
    }

    const adapter = createStorageAdapter(locals);

    if (!validation.data.confirm) {
      const plan = await planReset(adapter, instanceId, known);
      return json(
        {
          dryRun: true,
          ...plan,
          skipped: unknown,
          message: `Dry run: ${plan.totalInInstance} records would be deleted. Re-send with { "confirm": true } to delete.`,
        },
        200,
      );
    }

    const outcome = await executeReset(adapter, instanceId, known, unknown);

    return json(
      {
        dryRun: false,
        ...outcome,
        message: `Deleted ${outcome.deleted} records from instance "${instanceId}". Users and sessions were kept.`,
      },
      200,
    );
  } catch (err) {
    return handleError(err);
  }
};

/**
 * GET responde el mismo dry-run que un POST sin confirm. Sirve para que el
 * panel muestre "esto es lo que se va a borrar" antes de pedir confirmacion,
 * sin que el cliente tenga que imaginar un POST con un body vacio.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const user = requireSession(locals);

    if (!canReset(user.role)) {
      return json({ error: resetDenial(user.role) }, 403);
    }

    const localsInstance = typeof locals?.instanceId === 'string' ? locals.instanceId : undefined;
    const url = new URL(request.url);
    const instanceId =
      localsInstance ?? url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const { known, unknown } = resolveRequestedEntities(undefined);
    const adapter = createStorageAdapter(locals);
    const plan = await planReset(adapter, instanceId, known);

    return json({ dryRun: true, ...plan, skipped: unknown }, 200);
  } catch (err) {
    return handleError(err);
  }
};