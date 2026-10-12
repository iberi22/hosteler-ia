// takeOrder.ts — logica pura del flujo "Nuevo pedido" del personal.
//
// La toma de pedidos (mesa + platos con cantidades + nota opcional) se arma aqui, sin Svelte ni red,
// para que la unidad sea testeable y la reutilicen el modo local (/local/nuevo-pedido) y el dashboard.
// El envio usa el cliente API existente (`api.post('/api/orders', payload)`): en modo local `apiFetch`
// lo despacha a los mismos handlers sobre IndexedDB, en el panel servido llega al servidor.
export interface TakeOrderDish {
  id: string;
  name: string;
  price: number;
  isAvailable?: boolean | null;
  /** Borrado logico: los borrados nunca se ofrecen en la toma. */
  deleted_at?: string | null;
}

export interface TakeOrderLine {
  menuItemId: string;
  qty: number;
}

export interface TakeOrderPayload {
  tableId: string;
  items: TakeOrderLine[];
  note?: string;
}

/** Un plato se ofrece solo si no esta borrado ni marcado como no disponible. */
export function isDishOrderable(dish: TakeOrderDish): boolean {
  if (!dish || typeof dish.id !== 'string' || dish.id === '') return false;
  if (dish.deleted_at != null) return false;
  if (dish.isAvailable === false) return false;
  return true;
}

/** La carta que ve el personal: borrados y no disponibles fuera. */
export function orderableDishes(dishes: TakeOrderDish[]): TakeOrderDish[] {
  return (dishes ?? []).filter(isDishOrderable);
}

/** Total del pedido: suma qty x precio de la carta. Cantidades invalidas cuentan 0. */
export function takeOrderTotal(
  quantities: Record<string, number>,
  dishes: TakeOrderDish[],
): number {
  const priceById = new Map((dishes ?? []).map((d) => [d.id, Number(d.price) || 0]));
  let total = 0;
  for (const [id, qty] of Object.entries(quantities ?? {})) {
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    total += (priceById.get(id) ?? 0) * q;
  }
  return total;
}

/**
 * Cuerpo de POST /api/orders. Null cuando la mesa falta o no hay ningun plato con cantidad >= 1.
 * Los items salen ordenados por plato: mismo pedido, mismo cuerpo.
 */
export function buildTakeOrderPayload(
  tableId: string,
  quantities: Record<string, number>,
  note?: string,
): TakeOrderPayload | null {
  const tid = (tableId ?? '').trim();
  if (!tid) return null;
  const items: TakeOrderLine[] = [];
  for (const [menuItemId, qty] of Object.entries(quantities ?? {})) {
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) continue;
    items.push({ menuItemId, qty: q });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => (a.menuItemId < b.menuItemId ? -1 : a.menuItemId > b.menuItemId ? 1 : 0));
  const trimmedNote = (note ?? '').trim();
  return trimmedNote ? { tableId: tid, items, note: trimmedNote } : { tableId: tid, items };
}
