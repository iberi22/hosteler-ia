import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listNotifications, POST as createNotification, PATCH as markAllRead } from '../pages/api/notifications/index';
import {
  GET as getNotification,
  PATCH as patchNotification,
  PUT as putNotification,
  DELETE as deleteNotification,
} from '../pages/api/notifications/[id]';
import { getMemoryAdapter } from './domain';
import {
  filterNotifications,
  unreadCount,
  visibleToUser,
  applyReadState,
  newNotificationDefaults,
  isNotificationType,
  isNotificationPriority,
  type Notification,
} from './notifications';

const OWNER = { id: 'u-owner', email: 'owner@fize.app', name: 'Owner', role: 'owner' };
const STAFF = { id: 'u-staff', email: 'staff@fize.app', name: 'Staff', role: 'staff' };

const ctx = (req: Request, params: Record<string, string> = {}, user: unknown = OWNER) =>
  ({ request: req, params, locals: { user } }) as any;

const jsonReq = (url: string, method: string, payload?: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

let seq = 0;
const seed = async (over: Partial<Notification> = {}) => {
  seq++;
  const now = new Date().toISOString();
  const record = {
    id: `n${seq}`,
    instance_id: 'default',
    title: `Aviso ${seq}`,
    message: 'Mensaje',
    type: 'info',
    priority: 'normal',
    userId: null,
    isRead: false,
    readAt: null,
    data: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
  await getMemoryAdapter().create('notification', record as never);
  return record as Notification;
};

// `created_at` por defecto es una fecha FIJA, no `new Date()`: el sort de
    // notificaciones es por fecha descendente, asi que si cada fila del test nace en
    // un milisegundo distinto el orden se invierte entre filas y el test pasa o falla
    // segun la carga de la maquina. Cada test que necesite orden explicito pasa su
    // propio `created_at` via el spread `...r`.
    const FIXED_TS = '2026-01-01T00:00:00.000Z';
const asNotification = (r: Partial<Notification>): Notification =>
  ({
    id: 'x',
    instance_id: 'default',
    title: 't',
    message: 'm',
    type: 'info',
    priority: 'normal',
    userId: null,
    isRead: false,
    readAt: null,
    data: null,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
    ...r,
  }) as Notification;

describe('notifications — reglas puras', () => {
  it('rechaza type y priority fuera del contrato', () => {
    expect(isNotificationType('error')).toBe(true);
    expect(isNotificationType('fatal')).toBe(false);
    expect(isNotificationPriority('critical')).toBe(true);
    expect(isNotificationPriority('urgent')).toBe(false);
  });

  it('un aviso sin userId es para todo el local; con userId, solo de esa persona', () => {
    const rows = [
      asNotification({ id: 'a' }),
      asNotification({ id: 'b', userId: 'u-staff' }),
    ];
    expect(visibleToUser(rows, 'u-owner').map((n) => n.id)).toEqual(['a']);
    expect(visibleToUser(rows, 'u-staff').map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('filtra por isRead, type y priority', () => {
    const rows = [
      asNotification({ id: 'a', isRead: false, type: 'error', priority: 'critical' }),
      asNotification({ id: 'b', isRead: true, type: 'info', priority: 'low' }),
    ];
    expect(filterNotifications(rows, { isRead: false }).map((n) => n.id)).toEqual(['a']);
    expect(filterNotifications(rows, { isRead: true }).map((n) => n.id)).toEqual(['b']);
    expect(filterNotifications(rows, { type: 'error' }).map((n) => n.id)).toEqual(['a']);
    expect(filterNotifications(rows, { priority: 'low' }).map((n) => n.id)).toEqual(['b']);
    // Sin isRead salen los dos: ausencia de filtro no es "solo no leidos".
    expect(filterNotifications(rows).length).toBe(2);
  });

  it('ordena por urgencia y, a igual urgencia, por fecha desc', () => {
    const rows = [
      asNotification({ id: 'low', priority: 'low', created_at: '2026-01-01T00:00:00.000Z' }),
      asNotification({ id: 'crit', priority: 'critical', created_at: '2025-01-01T00:00:00.000Z' }),
      asNotification({ id: 'old', priority: 'high', created_at: '2025-01-01T00:00:00.000Z' }),
      asNotification({ id: 'new', priority: 'high', created_at: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(filterNotifications(rows).map((n) => n.id)).toEqual(['crit', 'new', 'old', 'low']);
  });

  it('pagina desde 1 y corrige page/limit invalidos', () => {
    const rows = [
      asNotification({ id: 'a' }),
      asNotification({ id: 'b' }),
      asNotification({ id: 'c' }),
    ];
    expect(filterNotifications(rows, { page: 2, limit: 2 }).map((n) => n.id)).toEqual(['c']);
    expect(filterNotifications(rows, { page: 0, limit: 0 })).toHaveLength(1);
    // NaN usa el default (limit 50), no 1: `?limit=abc` no puede dejar al panel
    // viendo un solo aviso.
    expect(filterNotifications(rows, { page: Number.NaN, limit: Number.NaN })).toHaveLength(3);
  });

  // El badge dice cuantos LE QUEDAN, no cuantos caben en la pagina.
  it('unreadCount cuenta sobre todo lo visible, no sobre la pagina', () => {
    const rows = [
      asNotification({ id: 'a' }),
      asNotification({ id: 'b' }),
      asNotification({ id: 'c', isRead: true }),
      asNotification({ id: 'd', userId: 'u-staff' }),
    ];
    expect(unreadCount(rows, 'u-owner')).toBe(2);
    expect(unreadCount(rows, 'u-staff')).toBe(3);
  });

  it('nuevo nace sin leer; marcar y desmarcar mueve readAt', () => {
    expect(newNotificationDefaults()).toEqual({ isRead: false, readAt: null });
    const at = '2026-10-05T12:00:00.000Z';
    expect(applyReadState(true, at)).toEqual({ isRead: true, readAt: at });
    // Desmarcar limpia readAt: ya no hay momento en que se leyo.
    expect(applyReadState(false, at)).toEqual({
      isRead: false,
      readAt: null,
    });
  });
});

describe('notifications API', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    seq = 0;
  });

  it('GET y POST exigen sesion (401)', async () => {
    const list = await listNotifications(ctx(new Request('http://localhost/api/notifications'), {}, null));
    expect(list.status).toBe(401);

    const create = await createNotification(
      ctx(jsonReq('http://localhost/api/notifications', 'POST', { title: 'a', message: 'b', type: 'info' }), {}, null),
    );
    expect(create.status).toBe(401);
  });

  it('POST crea un aviso sin leer con priority por defecto', async () => {
    const res = await createNotification(
      ctx(jsonReq('http://localhost/api/notifications', 'POST', { title: 'Impresora caida', message: 'Sin papel', type: 'error' })),
    );
    expect(res.status).toBe(201);
    const { notification } = (await res.json()) as { notification: Notification };
    expect(notification.priority).toBe('normal');
    expect(notification.isRead).toBe(false);
    expect(notification.readAt).toBeNull();
  });

  it('POST 400 con type/priority invalidos', async () => {
    const bad = await createNotification(
      ctx(jsonReq('http://localhost/api/notifications', 'POST', { title: 'a', message: 'b', type: 'fatal' })),
    );
    expect(bad.status).toBe(400);
  });

  it('POST no acepta restaurantId: el aislamiento es instance_id', async () => {
    // Con el schema estricto de zod, `restaurantId` extra se ignora: el aviso
    // se escribe en el instance de la sesion, no en el que pidio el cliente.
    await seed();
    const res = await createNotification(
      ctx(
        jsonReq('http://localhost/api/notifications?instance_id=default', 'POST', {
          title: 'a',
          message: 'b',
          type: 'info',
          restaurantId: 'otro-restaurante',
        }),
      ),
    );
    const { notification } = (await res.json()) as { notification: Notification & Record<string, unknown> };
    expect(notification.instance_id).toBe('default');
    // La clave que el legacy usaba para el tenant no existe en el registro.
    expect(notification.restaurantId).toBeUndefined();
  });

  it('GET devuelve { notifications, unreadCount } y no filtra de mas', async () => {
    await seed({ title: 'uno' });
    await seed({ title: 'dos' });
    await seed({ title: 'tres', isRead: true });

    const res = await listNotifications(ctx(new Request('http://localhost/api/notifications')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: Notification[]; unreadCount: number };
    expect(body.notifications).toHaveLength(3);
    expect(body.unreadCount).toBe(2);
  });

  it('GET 400 con un filtro de type, priority o page invalido', async () => {
    for (const q of ['?type=fatal', '?priority=urgent', '?page=abc', '?limit=-1', '?isRead=maybe']) {
      const res = await listNotifications(ctx(new Request(`http://localhost/api/notifications${q}`)));
      expect(res.status).toBe(400);
    }
  });

  it('GET filtra por isRead y por type', async () => {
    await seed({ type: 'error', priority: 'critical' });
    await seed({ type: 'info', isRead: true });

    const unread = await listNotifications(ctx(new Request('http://localhost/api/notifications?isRead=false')));
    expect(((await unread.json()) as { notifications: Notification[] }).notifications).toHaveLength(1);

    const errors = await listNotifications(ctx(new Request('http://localhost/api/notifications?type=error')));
    expect(((await errors.json()) as { notifications: Notification[] }).notifications).toHaveLength(1);
  });

  // El userId del legacy era un query param sin validar. Aqui no existe: el
  // filtro lo hace el servidor contra la sesion real.
  it('GET ignora un userId en la query y usa el de la sesion', async () => {
    await seed({ title: 'para-owner', created_at: '2026-01-01T00:00:00.000Z' });
    await seed({ title: 'para-staff', userId: 'u-staff', created_at: '2026-02-01T00:00:00.000Z' });

    const asStaff = await listNotifications(
      ctx(new Request('http://localhost/api/notifications?userId=u-owner'), {}, STAFF),
    );
    const body = (await asStaff.json()) as { notifications: Notification[]; unreadCount: number };
    expect(body.notifications.map((n) => n.title)).toEqual(['para-staff', 'para-owner']);
    // El badge del staff cuenta el suyo y el general, no el del owner.
    expect(body.unreadCount).toBe(2);
  });

  it('GET no ve avisos de otro instance', async () => {
    await seed({ title: 'local' });
    await getMemoryAdapter().create('notification', {
      id: 'n-otro',
      instance_id: 'otro',
      title: 'ajeno',
      message: 'm',
      type: 'info',
      priority: 'normal',
      isRead: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);

    const res = await listNotifications(ctx(new Request('http://localhost/api/notifications')));
    const body = (await res.json()) as { notifications: Notification[] };
    expect(body.notifications.map((n) => n.title)).toEqual(['local']);
  });

  it('GET /api/notifications/:id devuelve 404 si no existe', async () => {
    const res = await getNotification(ctx(new Request('http://localhost/api/notifications/nope'), { id: 'nope' }));
    expect(res.status).toBe(404);
  });

  // Regresion del legacy: escribia `is_read: body.isRead || true`, que siempre
  // daba true. "Marcar como no leido" se guardaba como leido, con 200 al lado.
  it('PATCH /:id respeta isRead:false y limpia readAt', async () => {
    const n = await seed({ isRead: true, readAt: '2026-01-01T00:00:00.000Z' });
    const res = await patchNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PATCH', { isRead: false }), { id: n.id }),
    );
    expect(res.status).toBe(200);
    const { notification } = (await res.json()) as { notification: Notification };
    expect(notification.isRead).toBe(false);
    expect(notification.readAt).toBeNull();
  });

  it('PATCH /:id marca leido y pone readAt (y PUT hace lo mismo)', async () => {
    const n = await seed();
    const res = await patchNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PATCH', { isRead: true }), { id: n.id }),
    );
    const { notification } = (await res.json()) as { notification: Notification };
    expect(notification.isRead).toBe(true);
    expect(notification.readAt).not.toBeNull();

    const viaPut = await putNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PUT', { isRead: false }), { id: n.id }),
    );
    expect(((await viaPut.json()) as { notification: Notification }).notification.isRead).toBe(false);
  });

  it('PATCH /:id 400 si isRead no es booleano', async () => {
    const n = await seed();
    const res = await patchNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PATCH', { isRead: 'si' }), { id: n.id }),
    );
    expect(res.status).toBe(400);
  });

  it('PATCH /:id exige sesion', async () => {
    const n = await seed();
    const res = await patchNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PATCH', { isRead: true }), { id: n.id }, null),
    );
    expect(res.status).toBe(401);
  });

  // 404 y no 403: un 403 confirmaria que el aviso existe y es de otro.
  it('un aviso dirigido a otra persona responde 404, no 403', async () => {
    const n = await seed({ userId: 'u-staff' });
    const read = await getNotification(ctx(new Request(`http://localhost/api/notifications/${n.id}`), { id: n.id }, OWNER));
    expect(read.status).toBe(404);

    const patch = await patchNotification(
      ctx(jsonReq(`http://localhost/api/notifications/${n.id}`, 'PATCH', { isRead: true }), { id: n.id }, OWNER),
    );
    expect(patch.status).toBe(404);

    const del = await deleteNotification(
      ctx(new Request(`http://localhost/api/notifications/${n.id}`, { method: 'DELETE' }), { id: n.id }, OWNER),
    );
    expect(del.status).toBe(404);
  });

  it('DELETE descarta el aviso y desaparece de la lista', async () => {
    const n = await seed();
    const res = await deleteNotification(
      ctx(new Request(`http://localhost/api/notifications/${n.id}`, { method: 'DELETE' }), { id: n.id }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const after = await listNotifications(ctx(new Request('http://localhost/api/notifications')));
    expect(((await after.json()) as { notifications: Notification[] }).notifications).toHaveLength(0);
  });

  it('PATCH ?all=true marca los del usuario y baja el badge', async () => {
    await seed({ title: 'a' });
    await seed({ title: 'b' });
    await seed({ title: 'c', userId: 'u-staff' });

    const res = await markAllRead(ctx(new Request('http://localhost/api/notifications?all=true', { method: 'PATCH' })));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);

    const after = await listNotifications(ctx(new Request('http://localhost/api/notifications')));
    expect(((await after.json()) as { unreadCount: number }).unreadCount).toBe(0);

    // El aviso del staff sigue intacto: no se toca lo de otro usuario.
    const asStaff = await listNotifications(ctx(new Request('http://localhost/api/notifications'), {}, STAFF));
    expect(((await asStaff.json()) as { unreadCount: number }).unreadCount).toBe(1);
  });
});