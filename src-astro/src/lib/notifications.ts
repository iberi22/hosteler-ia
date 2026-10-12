// notifications.ts — reglas puras de los avisos del panel.
//
// El legacy (Next.js + Supabase) hacia todo el filtro dentro del handler, en el
// query builder de PostgREST. Aqui la consulta es un `list()` + filtro en
// memoria (el StorageAdapter no tiene indexes compuestos), asi que las reglas
// van en funciones puras testeables sin DB.
//
// Un aviso NO tiene `restaurantId` como lo tenia el legacy: en esta arquitectura
// el aislamiento ya lo da `instance_id`, que pone createStorageAdapter. Por eso
// el endpoint NO acepta restaurantId — aceptarlo dejaria al cliente creer que
// puede leer los avisos de otro restaurante.

// Severidad del aviso. Solo cuatro: lo que el panel sabe pintar.
export const NOTIFICATION_TYPES = ['info', 'warning', 'error', 'success'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Urgencia. `critical` existe para lo que bloquea el servicio (elapsed de
// impresora caido, cobro sin confirmar); se ordena por debajo de `error`.
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export interface Notification {
  id: string;
  instance_id: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  /** A quien va dirigido. Ausente = aviso para todo el restaurante. */
  userId?: string | null;
  isRead: boolean;
  /** ISO. Solo cuando isRead pasa a true. */
  readAt?: string | null;
  /** Contexto libre (id de pedido, id de insumo...). No se renderiza crudo. */
  data?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Orden de urgencia para desempatar: critical > high > normal > low. */
const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function isNotificationPriority(value: string): value is NotificationPriority {
  return (NOTIFICATION_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Avisos que le corresponden a este usuario.
 *
 * Un aviso SIN userId es para todo el local y se ve; uno con userId solo lo ve
 * esa persona. Es la misma idea del legacy (filtraba por user_id cuando venia),
 * pero aqui el que filtra es el servidor contra la sesion real, no un query
 * param: el cliente no puede pedir los avisos de otro usuario.
 */
export function visibleToUser(records: Notification[], userId: string): Notification[] {
  return records.filter((n) => !n.userId || n.userId === userId);
}

export interface NotificationFilters {
  /** 'true'/'false' → solo leidos / solo no leidos. Ausente = ambos. */
  isRead?: boolean;
  type?: NotificationType;
  priority?: NotificationPriority;
  page?: number;
  limit?: number;
}

export const DEFAULT_LIMIT = 50;

/**
 * Filtra, ordena y pagina.
 *
 * El orden es por urgencia y no solo por fecha porque un aviso `critical` de
 * hace una hora importa mas que cinco `info` de hace diez minutos. Dentro de la
 * misma urgencia gana el mas reciente (created_at descendente), que es lo que
 * espera el panel.
 */
export function filterNotifications(
  records: Notification[],
  filters: NotificationFilters = {},
): Notification[] {
  const { isRead, type, priority } = filters;
  // Un page/limit que no es un numero (NaN de `Number('abc')`) no debe
  // degradar a 1: se usa el default. Un 0 o negativo si se corrige a 1, que es
  // lo que evita un slice() vacio o un rango imposible.
  const limit = sanitizeInt(filters.limit, DEFAULT_LIMIT);
  const page = sanitizeInt(filters.page, 1);

  const filtered = records.filter((n) => {
    if (isRead !== undefined && n.isRead !== isRead) return false;
    if (type && n.type !== type) return false;
    if (priority && n.priority !== priority) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  const from = (page - 1) * limit;
  return sorted.slice(from, from + limit);
}

/** Sin filtros, el orden es el mismo: el panel pinta "lo importante arriba". */
export function sortNotifications(records: Notification[]): Notification[] {
  return filterNotifications(records);
}

/**
 * Cuantos SIN leer ve este usuario.
 *
 * Se cuenta sobre `visibleToUser`, no sobre la lista paginada: el badge tiene que
 * decir cuantos le quedan, no cuantos caben en esta pagina.
 */
export function unreadCount(records: Notification[], userId: string): number {
  return visibleToUser(records, userId).filter((n) => !n.isRead).length;
}

/**
 * Marca leido o no leido.
 *
 * El legacy escribia `is_read: body.isRead || true`, que es SIEMPRE true:
 * `isRead: false` se guardaba como `true`. Cualquier "¿marcar como no leido?"
 * quedaba guardado como leido. Aqui el booleano se respeta en las dos
 * direcciones y `readAt` solo se llena al pasar a leido (desmarcar lo borra,
 * porque ya no hay momento en que se leyo).
 */
/**
 * El estado leido/no leido, listo para meter en un patch.
 *
 * No recibe el aviso: cambiar si algo esta leido no depende de lo que hubiera
 * antes. Lo que SI importa es que `readAt` se limpie al desmarcar — si no, un
 * aviso volveria a "leido" al siguiente toggle mostrando una fecha vieja.
 */
export function applyReadState(
  isRead: boolean,
  now = new Date().toISOString(),
): Pick<Notification, 'isRead' | 'readAt'> {
  return { isRead, readAt: isRead ? now : null };
}

/** Un aviso nuevo nace sin leer: no hay de donde vino un "leido". */
export function newNotificationDefaults(): Pick<Notification, 'isRead' | 'readAt'> {
  return { isRead: false, readAt: null };
}

// Un aviso de otro restaurante o ya borrado se trata como inexistente.
export function toNotificationOrNull(record: Record<string, unknown> | null): Notification | null {
  if (!record || record.deleted_at) return null;
  return record as unknown as Notification;
}

/** page/limit: NaN usa el default; 0 o negativo se corrige a 1. */
function sanitizeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  return Math.floor(value);
}