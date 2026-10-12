// orderStateMachine.ts — máquina de estados de pedidos (fuente de verdad: UI H1)
// pending → preparing → ready → served → paid · cancelled desde pending/preparing
// Terminales: paid, cancelled. served solo avanza a paid.

export const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'served', 'paid', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Etiquetas humanas (es) para chips y carriles. Los slugs en ingles solo salen
 * en la URL (`?status=`), los botones de transicion (`→ served`) y la insignia
 * tecnica de la tarjeta (`order.status.toUpperCase()`): son la jerga del
 * personal y del E2E offline-local-first, que localiza el pedido por `PAID`.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendientes',
  preparing: 'En cocina',
  ready: 'Listos',
  served: 'Por cobrar',
  paid: 'Cobrados',
  cancelled: 'Cancelados',
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
