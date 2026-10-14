import { ORDER_STATUS_LABELS, isOrderStatus, type OrderStatus } from './orderStateMachine';

/** What a customer may see about an order: its status and label, nothing else. */
export interface PublicOrderStatus {
  status: OrderStatus;
  label: string;
}

/**
 * Projects a stored order to the public shape. Items, totals, table and customer data are
 * never included. Returns null for missing, deleted or malformed orders.
 */
export function publicOrderStatus(record: Record<string, unknown> | null | undefined): PublicOrderStatus | null {
  if (!record || record.deleted_at) return null;
  if (!isOrderStatus(record.status)) return null;
  return { status: record.status, label: ORDER_STATUS_LABELS[record.status] };
}
