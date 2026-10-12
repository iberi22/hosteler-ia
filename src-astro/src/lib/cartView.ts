// cartView.ts — helpers puros del carrito cliente (testeables).
export interface CartLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export function cartTotals(lines: CartLine[]): { count: number; subtotal: number } {
  return {
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((sum, l) => sum + l.totalPrice, 0),
  };
}

export interface OrderPayload {
  tableId: string;
  items: Array<{ menuItemId: string; qty: number }>;
}

export function buildOrderPayload(tableId: string, lines: CartLine[]): OrderPayload {
  return {
    tableId,
    items: lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.quantity })),
  };
}
