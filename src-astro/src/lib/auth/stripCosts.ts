// 'Ver costos' es solo del owner (ALCANCE §6.2). Helper puro: quita los campos de costo
// de cualquier respuesta (anidados incluidos) para todo rol distinto de owner.
const COST_KEYS = new Set(['unitCost', 'costPerServing', 'costTotal', 'margin', 'lossMaking', 'lineTotal']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!COST_KEYS.has(k)) out[k] = strip(v);
    }
    return out;
  }
  return value;
}

export function stripCosts<T>(role: string | undefined, data: T): T {
  return role === 'owner' ? data : (strip(data) as T);
}
