// recommendations.ts — motor de recomendaciones Fi'ze (FASE 7).
// Construye contexto (stock bajo, top ventas, restaurante) y pide inferencia
// estructurada. La función infer es inyectable: en prod POST /api/ai/infer,
// en tests un mock. Sin llamadas de red en vitest.

import type { StorageAdapter, DomainRecord } from './domain';

type Rec = Record<string, unknown>;

export interface Recommendation {
  type: 'restock' | 'promo' | 'menu' | 'ops';
  title: string;
  detail: string;
}

export interface RestaurantContext {
  restaurantName: string;
  lowStock: Array<{ name: string; stock: number }>;
  topItems: Array<{ name: string; qty: number }>;
  pendingOrders: number;
}

function alive(r: DomainRecord): boolean {
  return !(r as unknown as Rec).deleted_at;
}

export async function buildContext(
  adapter: StorageAdapter,
  instanceId: string,
  lowThreshold = 5,
): Promise<RestaurantContext> {
  const restaurants = ((await adapter.list('restaurant', instanceId)) as DomainRecord[]).filter(alive);
  const first = restaurants[0] as Rec | undefined;

  const items = ((await adapter.list('inventoryItem', instanceId)) as DomainRecord[]).filter(alive);
  const lowStock = items
    .filter((i) => Number((i as unknown as Rec).stock ?? 0) < lowThreshold)
    .map((i) => ({ name: String((i as unknown as Rec).name ?? ''), stock: Number((i as unknown as Rec).stock ?? 0) }));

  const orders = ((await adapter.list('order', instanceId)) as DomainRecord[]).filter(alive);
  const sales = new Map<string, number>();
  for (const o of orders) {
    const raw = ((o as unknown as Rec).items as Rec[] | undefined) ?? [];
    for (const it of raw) {
      const key = String(it.menuItemId ?? it.id ?? '');
      sales.set(key, (sales.get(key) ?? 0) + Number(it.qty ?? it.quantity ?? 1));
    }
  }
  const menuItems = ((await adapter.list('menuItem', instanceId)) as DomainRecord[]).filter(alive);
  const names = new Map(menuItems.map((m) => [m.id, String((m as unknown as Rec).name ?? m.id)]));
  const topItems = [...sales.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, qty]) => ({ name: names.get(id) ?? id, qty }));

  const pendingOrders = orders.filter((o) => String((o as unknown as Rec).status) === 'pending').length;

  return {
    restaurantName: first ? String(first.name ?? '') : '',
    lowStock,
    topItems,
    pendingOrders,
  };
}

export function buildPrompt(ctx: RestaurantContext): string {
  const lines = [
    `Restaurante: ${ctx.restaurantName || 'sin nombre'}`,
    `Pedidos pendientes: ${ctx.pendingOrders}`,
    `Stock bajo: ${ctx.lowStock.length === 0 ? 'ninguno' : ctx.lowStock.map((s) => `${s.name} (${s.stock})`).join(', ')}`,
    `Top ventas: ${ctx.topItems.length === 0 ? 'sin datos' : ctx.topItems.map((t) => `${t.name} x${t.qty}`).join(', ')}`,
    'Devuelve JSON: array de {type: restock|promo|menu|ops, title, detail} (máx 5, español).',
  ];
  return lines.join('\n');
}

export type InferFn = (prompt: string) => Promise<string>;

export async function fetchInfer(prompt: string): Promise<string> {
  const res = await fetch('/api/ai/infer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`infer → ${res.status}`);
  const data = await res.json();
  return String((data as Rec).response ?? (data as Rec).text ?? '');
}

export function parseRecommendations(raw: string): Recommendation[] {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('expected array');
  return parsed.slice(0, 5).map((r) => {
    const v = r as Rec;
    const type = String(v.type ?? 'ops');
    return {
      type: type === 'restock' || type === 'promo' || type === 'menu' ? type : ('ops' as const),
      title: String(v.title ?? ''),
      detail: String(v.detail ?? ''),
    };
  });
}

export async function getRecommendations(
  adapter: StorageAdapter,
  instanceId: string,
  infer: InferFn = fetchInfer,
): Promise<Recommendation[]> {
  const ctx = await buildContext(adapter, instanceId);
  const raw = await infer(buildPrompt(ctx));
  try {
    return parseRecommendations(raw);
  } catch {
    return [{ type: 'ops', title: 'Sin recomendaciones', detail: 'La IA no devolvió un formato válido.' }];
  }
}
