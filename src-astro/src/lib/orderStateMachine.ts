// orderStateMachine.ts — máquina de estados de pedidos (fuente de verdad: UI H1)
// pending → preparing → ready → served → paid · cancelled desde pending/preparing
// Terminales: paid, cancelled. served solo avanza a paid.

export const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'served', 'paid', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Etiquetas humanas (es) para chips y carriles.
 *
 * Los slugs en ingles solo existen en la URL (`?status=`) y en la API: nunca se
 * pintan. La insignia de la tarjeta y los botones de transicion usaban
 * `status.toUpperCase()` (`PENDING`, `→ paid`) y el personal del restaurante no
 * habla ingles (QA pre-entrega 2026-10-13 #7).
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendientes',
  preparing: 'En cocina',
  ready: 'Listos',
  served: 'Por cobrar',
  paid: 'Cobrados',
  cancelled: 'Cancelados',
};

/** Singular para la insignia de una tarjeta y los botones «→ …» (Pendiente, En preparación...). */
export const ORDER_STATUS_BADGE_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  served: 'Servido',
  paid: 'Cobrado',
  cancelled: 'Cancelado',
};

const TRANSITIONS: Record<Exclude<OrderStatus, 'paid' | 'cancelled'>, OrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served'],
  served: ['paid'],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === 'paid' || from === 'cancelled') return false;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isOrderStatus(to)) {
    throw new Error(`Invalid status: ${String(to)}`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
