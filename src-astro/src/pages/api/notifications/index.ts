import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import type { DomainRecord } from '../../../lib/domain';
import { requireSession, type SessionUser } from '../../../lib/auth/session';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  isNotificationType,
  isNotificationPriority,
  visibleToUser,
  filterNotifications,
  unreadCount,
  newNotificationDefaults,
  type Notification,
} from '../../../lib/notifications';
import { resolveTenant, authErrorResponse } from '../../../lib/auth/tenant';

// Contrato heredado del legacy (legacy/app/api/notifications/route.ts):
//
//   GET /api/notifications?restaurantId=..&userId=..&isRead=..&type=..&priority=..&page=..&limit=..
//     -> 400 { error: 'Restaurant ID is required' } sin restaurantId
//     -> 200 { notifications, unreadCount }
//
//   POST /api/notifications { title, message, type, priority?, restaurantId, userId?, data? }
//     -> 201 { notification }
//
// Dos cosas cambian al portarlo, y las dos son deliberadas:
//
//  1. `restaurantId` desaparece. En legacy-era el tenant era una columna
//     (`restaurant_id`) y por eso tenia que venir en el body. Aqui el aislamiento
//     lo impone `instance_id` y sale de la sesion: si se aceptara el parametro,
//     un cliente Podria pedir los avisos de otro restaurante escribiendolo a mano.
//
//  2. `userId` en el GET tambien desaparece. En legacy-era era un query param
//     sin validar, o sea que cualquiera podia listar los avisos de otro usuario.
//     Aqui el filtro lo hace el servidor contra `locals.user`.

const createNotificationSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  message: z.string().min(1, { message: 'Message is required' }),
  type: z.enum(NOTIFICATION_TYPES),
  priority: z.enum(NOTIFICATION_PRIORITIES).default('normal'),
  userId: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  instance_id: z.string().optional(),
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Un AuthError es 401 o 403; cualquier otra cosa, 500. Un solo lugar que lo decide. */
function handleError(err: unknown): Response {
  return authErrorResponse(err) ?? json({ error: 'Internal Server Error' }, 500);
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNotification(record: DomainRecord): Notification {
  return record as unknown as Notification;
}

/** Parametros del GET. Devuelve el motivo del 400 en vez de tragarselo. */
function parseListQuery(url: URL): {
  ok: true;
  filters: Parameters<typeof filterNotifications>[1];
} | { ok: false; error: string } {
  const isReadRaw = url.searchParams.get('isRead');
  const typeRaw = url.searchParams.get('type');
  const priorityRaw = url.searchParams.get('priority');
  const pageRaw = url.searchParams.get('page');
  const limitRaw = url.searchParams.get('limit');

  if (isReadRaw !== null && isReadRaw !== 'true' && isReadRaw !== 'false') {
    return { ok: false, error: `Invalid isRead filter: ${isReadRaw}` };
  }
  if (typeRaw !== null && !isNotificationType(typeRaw)) {
    return { ok: false, error: `Invalid type filter: ${typeRaw}` };
  }
  if (priorityRaw !== null && !isNotificationPriority(priorityRaw)) {
    return { ok: false, error: `Invalid priority filter: ${priorityRaw}` };
  }

  const page = pageRaw !== null ? Number(pageRaw) : undefined;
  const limit = limitRaw !== null ? Number(limitRaw) : undefined;
  if (pageRaw !== null && (page === undefined || !Number.isFinite(page) || page < 1)) {
    return { ok: false, error: `Invalid page: ${pageRaw}` };
  }
  if (limitRaw !== null && (limit === undefined || !Number.isFinite(limit) || limit < 1)) {
    return { ok: false, error: `Invalid limit: ${limitRaw}` };
  }

  return {
    ok: true,
    filters: {
      ...(isReadRaw !== null ? { isRead: isReadRaw === 'true' } : {}),
      ...(typeRaw !== null && isNotificationType(typeRaw) ? { type: typeRaw } : {}),
      ...(priorityRaw !== null && isNotificationPriority(priorityRaw)
        ? { priority: priorityRaw }
        : {}),
      ...(page !== undefined ? { page } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const user = requireSession(locals);
    const url = new URL(request.url);
    const query = parseListQuery(url);
    if (!query.ok) return json({ error: query.error }, 400);

    const adapter = createStorageAdapter(locals);
    const all = (await adapter.list('notification', resolveTenant(locals, request))).map(toNotification);

    // visibleToUser va ANTES del filtro y del contador: el usuario solo puede
    // ver lo suyo, y el badge no puede contar avisos de otra persona.
    const mine = visibleToUser(all, user.id);
    const notifications = filterNotifications(mine, query.filters);

    return json({ notifications, unreadCount: unreadCount(all, user.id) }, 200);
  } catch (err) {
    return handleError(err);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSession(locals);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const validation = createNotificationSchema.safeParse(body);
    if (!validation.success) {
      return json({ error: 'Validation failed', details: z.treeifyError(validation.error) }, 400);
    }

    const data = validation.data;
    // El tenant se resuelve IGUAL que en el resto de endpoints (session/
    // query/default) y no sale del body: un POST no puede escribir en el
    // instance de otro restaurante.
    const instanceId = resolveTenant(locals, request, data.instance_id);

    const adapter = createStorageAdapter(locals);
    const now = new Date().toISOString();
    const record: DomainRecord = {
      id: genId(),
      instance_id: instanceId,
      title: data.title,
      message: data.message,
      type: data.type,
      priority: data.priority,
      userId: data.userId ?? null,
      data: data.data ?? null,
      ...newNotificationDefaults(),
      created_at: now,
      updated_at: now,
    } as DomainRecord;

    const created = await adapter.create('notification', record);

    return json({ notification: created }, 201);
  } catch (err) {
    return handleError(err);
  }
};

/** `markAllAsRead` marca los del usuario actual. No acepta userId. */
export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const user: SessionUser = requireSession(locals);
    const url = new URL(request.url);
    const all = url.searchParams.get('all') === 'true';

    if (!all) return json({ error: 'Only ?all=true is supported on the collection' }, 400);

    const adapter = createStorageAdapter(locals);
    const mine = visibleToUser(
      (await adapter.list('notification', resolveTenant(locals, request))).map(toNotification),
      user.id,
    );

    const now = new Date().toISOString();
    let updated = 0;
    for (const n of mine) {
      if (n.isRead) continue;
      await adapter.update('notification', n.id, { isRead: true, readAt: now }, resolveTenant(locals, request));
      updated++;
    }

    return json({ updated, unreadCount: 0 }, 200);
  } catch (err) {
    return handleError(err);
  }
};