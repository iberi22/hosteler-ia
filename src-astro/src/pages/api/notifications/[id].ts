import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { requireSession, AuthError } from '../../../lib/auth/session';
import { applyReadState, toNotificationOrNull, visibleToUser } from '../../../lib/notifications';

// Contrato heredado (legacy/app/api/notifications/[id]/route.ts):
//
//   PUT    /api/notifications/:id { isRead }  -> 200 { notification }
//   DELETE /api/notifications/:id             -> 200 { success: true }
//
// La diferencia importante es el `isRead`. El legacy escribia:
//
//     update({ is_read: body.isRead || true, updated_at: ... })
//
// `false || true === true`: SIEMPRE se guardaba como leido. El cliente podia
// pedir "marcar como no leido" y el servidor contestaba 200 con is_read: true.
// Aqui se respeta el booleano en las dos direcciones y `readAt` se llena al
// pasar a leido, o se limpia al desmarcar.
//
// DELETE es BORRADO DURO (adapter.del), no soft delete. Es lo que hacia el
// legacy, y tiene sentido: descartar un aviso es la semantica de lo que el
// usuario ya leyo y quiere que desaparezca de su bandeja, no un registro que se
// conserve para auditoria. El GET de la coleccion filtra `deleted_at` de todas
// formas, para que un futuro cambio a soft delete no rompa nada.

const updateNotificationSchema = z.object({
  isRead: z.boolean({ message: 'isRead must be a boolean' }),
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function resolveInstance(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';
}

function notFound() {
  return json({ error: 'Notification not found' }, 404);
}

/** Un AuthError es 401; cualquier otra cosa, 500. Un solo lugar que lo decide. */
function handleError(err: unknown): Response {
  if (err instanceof AuthError || (err && typeof err === 'object' && (err as { status?: number }).status === 401)) {
    return json({ error: (err as { message?: string }).message ?? 'Authentication required' }, 401);
  }
  return json({ error: 'Internal Server Error' }, 500);
}

/**
 * Un aviso dirigido a otra persona responde 404, no 403.
 *
 * Que exista o no es informacion: con un 403, un usuario podria confirmar que
 * hay un aviso ajeno y recorrer ids. El 404 no dice nada.
 */
async function loadOwn(locals: unknown, id: string, instanceId: string) {
  const user = requireSession(locals as App.Locals);
  const adapter = createStorageAdapter(locals);
  const record = (await adapter.get('notification', id, instanceId)) as Record<string, unknown> | null;
  const [own] = visibleToUser([toNotificationOrNull(record)].filter(isPresent), user.id);
  return { adapter, notification: own ?? null };
}

const isPresent = <T,>(v: T | null): v is T => v !== null;

export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) return json({ error: 'Notification ID required' }, 400);

    const { notification } = await loadOwn(locals, id, resolveInstance(request));
    if (!notification) return notFound();

    return json({ notification }, 200);
  } catch (err) {
    return handleError(err);
  }
};

/** Marca leido / no leido. El unico campo mutable del aviso. */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) return json({ error: 'Notification ID required' }, 400);

    const instanceId = resolveInstance(request);
    const { adapter, notification } = await loadOwn(locals, id, instanceId);
    if (!notification) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const validation = updateNotificationSchema.safeParse(body);
    if (!validation.success) {
      return json({ error: 'Validation failed', details: z.treeifyError(validation.error) }, 400);
    }

    const now = new Date().toISOString();
    const updated = await adapter.update(
      'notification',
      id,
      applyReadState(validation.data.isRead, now) as Record<string, unknown>,
      instanceId,
    );

    return json({ notification: updated }, 200);
  } catch (err) {
    return handleError(err);
  }
};

/**
 * PUT se mantiene como alias de PATCH porque el legacy exponia PUT y hay
 * consumidores que lo usan. No duplica logica: llama al mismo applyReadState.
 */
export const PUT: APIRoute = PATCH;

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  try {
    const { id } = params;
    if (!id) return json({ error: 'Notification ID required' }, 400);

    const instanceId = resolveInstance(request);
    const { adapter, notification } = await loadOwn(locals, id, instanceId);
    if (!notification) return notFound();

    const removed = await adapter.del('notification', id, instanceId);
    if (!removed) return notFound();

    return json({ success: true }, 200);
  } catch (err) {
    return handleError(err);
  }
};