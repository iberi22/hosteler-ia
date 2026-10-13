// tableNumbers.ts — del id interno de una mesa a su numero visible.
//
// QA pre-entrega 2026-10-13 #3: la tarjeta del KDS mostraba «Mesa mv6j956n-5ct119»
// (el id crudo) y el personal de cocina no podia saber a que mesa llevar el plato.
// El mapeo id -> numero ya existia en TableMap/TakeOrderForm; aqui queda en un solo
// sitio para que cocina, pedidos y el acuse usen el mismo.

export interface TableRef {
  id: string;
  number: number | string;
}

/**
 * Numero de mesa para un `tableId`, o `null` si no se puede resolver.
 *
 * Los pedidos demo del dashboard llevan el numero como id (`'3'`), asi que un id
 * puramente numerico se usa tal cual. Un id desconocido devuelve `null` y la
 * tarjeta pinta «—» en vez de un identificador ilegible.
 */
export function tableNumberById(tableId: string | null | undefined, tables: readonly TableRef[]): number | null {
  if (!tableId) return null;
  const found = tables.find((t) => t.id === tableId);
  if (found) {
    const n = Number(found.number);
    return Number.isFinite(n) ? n : null;
  }
  return /^\d+$/.test(tableId) ? Number(tableId) : null;
}
