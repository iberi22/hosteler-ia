// orderTotal.ts — total de un pedido a partir de sus items.
//
// Vivia en payments.ts. Se separo porque el tablero (ventas del dia) lo necesita aunque el modulo de cobro
// no este: el registro de pagos es parte del modulo cloud opcional (src/cloud), el total no.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula el total de un pedido a partir de sus items.
 * El precio se congelo al crear el pedido, asi que esto es lo que el
 * cliente debe: no se recalcula contra el menu.
 */
export function orderTotal(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return round2(
    items.reduce((sum, raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      return sum + Number(it.unitPrice ?? 0) * Number(it.qty ?? it.quantity ?? 1);
    }, 0),
  );
}
